"""Integer-minute CP-SAT model; approval additionally requires the independent TS verifier."""
import hashlib
import time
from functools import lru_cache
from datetime import date, datetime, time as civil_time, timedelta
from zoneinfo import ZoneInfo

from ortools.sat.python import cp_model

ZONE = ZoneInfo("America/Sao_Paulo")
MAX_SECONDS = 12
TRANSITION_42_DATE = "2026-12-16"
TRANSITION_40_DATE = "2027-12-16"
CCT_PROFILE = "SINDECOMU_SUPERMARKETS_2026_2027"
CCT_FROM = "2026-06-01"
CCT_UNTIL = "2027-05-31"


def days_between(start, end):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    return [(first + timedelta(days=n)).isoformat()
            for n in range((last - first).days + 1)]


@lru_cache(maxsize=16384)
def instant(day, minute):
    value = datetime.combine(date.fromisoformat(day), civil_time(), ZONE)
    return (value + timedelta(minutes=minute)).timestamp() / 60


def shift_metrics(shift):
    segments = shift["segments"]
    paid = [s for s in segments if s["kind"] != "BREAK"]
    return (sum(s["end"] - s["start"] for s in paid), paid[0]["start"], paid[-1]["end"])


def occupied_dates(day, shift):
    occupied = set()
    for segment in shift["segments"]:
        if segment["kind"] != "BREAK":
            for offset in range(segment["start"] // 1440, (segment["end"] - 1) // 1440 + 1):
                occupied.add((date.fromisoformat(day) + timedelta(days=offset)).isoformat())
    return occupied


def legal_weekly_hours(day):
    return 40 if day >= TRANSITION_40_DATE else 42 if day >= TRANSITION_42_DATE else 44


def effective_weekly_hours(person, week_end):
    # The lower target applies to the whole transition week; TS requires explicit acceptance.
    return min(person["weeklyHours"], legal_weekly_hours(week_end))


def sunday_limit(person):
    protected = 2 if person.get("sundayRestRule") == "COMMERCE" else 1
    return min(person["maxConsecutiveSundays"], protected)


def reviewed_document(document, day, identifier):
    return (isinstance(document, dict) and document.get("reviewed") is True
            and isinstance(document.get(identifier), str) and bool(document[identifier].strip())
            and isinstance(document.get("reviewedBy"), str) and bool(document["reviewedBy"].strip())
            and isinstance(document.get("validFrom"), str) and isinstance(document.get("validUntil"), str)
            and len(document["validFrom"]) == 10 and len(document["validUntil"]) == 10
            and document["validFrom"] <= day <= document["validUntil"])


def certificate_authorizes(policy, day, scope):
    document = policy.get("operationalCertificate")
    return (CCT_FROM <= day <= CCT_UNTIL and reviewed_document(document, day, "identifier")
            and document.get(scope) is True)


def cct_admissible(shift, policy, day):
    if policy.get("normativeProfile") != CCT_PROFILE:
        return True
    if not CCT_FROM <= day <= CCT_UNTIL:
        return False
    for civil in occupied_dates(day, shift):
        if date.fromisoformat(civil).weekday() == 6 and not certificate_authorizes(policy, civil, "sundays"):
            return False
        if civil in policy["holidayDates"] and not certificate_authorizes(policy, civil, "holidays"):
            return False
    paid, _start, _end = shift_metrics(shift)
    extension_or_night = paid > 480 or any(s["kind"] != "BREAK" and (s["start"] < 300 or s["end"] > 1320)
                                          for s in shift["segments"])
    for segment in shift["segments"]:
        if segment["kind"] == "BREAK":
            continue
        for offset in range(segment["start"] // 1440, (segment["end"] - 1) // 1440 + 1):
            if extension_or_night and max(segment["start"], offset * 1440 + 1200) < min(segment["end"], (offset + 1) * 1440):
                civil = (date.fromisoformat(day) + timedelta(days=offset)).isoformat()
                if not certificate_authorizes(policy, civil, "after20"):
                    return False
    return True


def admissible(shift, policy, day):
    paid, _start, _end = shift_metrics(shift)
    ceiling = 480 if day >= TRANSITION_40_DATE else 504 if day >= TRANSITION_42_DATE else 600
    if paid > min(policy["dailyLimitMinutes"], ceiling):
        return False
    if paid > 480 and not policy["compensationAuthorized"]:
        return False
    if paid > 480 and TRANSITION_42_DATE <= day < TRANSITION_40_DATE:
        if not reviewed_document(policy.get("collectiveAgreement"), day, "source"):
            return False
    if not cct_admissible(shift, policy, day):
        return False
    first, last = shift["segments"][0]["start"], shift["segments"][-1]["end"]
    meals = [s["end"] - s["start"] for s in shift["segments"]
             if s["kind"] == "BREAK" and s["start"] > first and s["end"] < last]
    required = policy["minMealMinutes"] if paid > 360 else (15 if paid > 240 else 0)
    return required == 0 or max(meals, default=0) >= required


def untimed_admissible(policy, day):
    if policy.get("normativeProfile") != CCT_PROFILE:
        return True
    return (CCT_FROM <= day <= CCT_UNTIL
            and (date.fromisoformat(day).weekday() != 6 or certificate_authorizes(policy, day, "sundays"))
            and (day not in policy["holidayDates"] or certificate_authorizes(policy, day, "holidays")))


def solve(data):
    started = time.monotonic()
    dates = days_between(data["startDate"], data["endDate"])
    employees = sorted((p for p in data["employees"] if p.get("planningEnabled") is not False), key=lambda e: e["id"])
    if not 1 <= len(employees) <= 250 or not 7 <= len(dates) <= 42 or len(dates) % 7:
        raise ValueError("model bounds")
    policy, shifts = data["policy"], {s["id"]: s for s in data["shifts"]}
    metrics = {key: shift_metrics(value) for key, value in shifts.items()}
    baseline = {(a["employeeId"], a["date"]): a for a in data["assignments"]}
    model = cp_model.CpModel()
    work, off, choices, history, active = {}, {}, {}, {}, {}
    preference_terms, stability_terms, people_changed, tie_terms = [], [], [], []
    sunday_totals = {}
    for person in employees:
        if time.monotonic() - started > MAX_SECONDS - 1:
            return _response("UNKNOWN", [], started)
        pid = person["id"]
        untimed = person.get("scheduleMode", "TIMED") == "UNTIMED"
        prior = {a["date"]: a for a in person.get("planningHistory", []) + person["history"]}
        history[pid] = prior
        changed = []
        active[pid] = [d for d in dates if person["activeFrom"] <= d
                       and (not person.get("activeUntil") or d <= person["activeUntil"])]
        for day in active[pid]:
            key, old = (pid, day), baseline.get((pid, day))
            absent = old is not None and old["kind"] == "ABSENCE"
            off[key] = model.new_bool_var(f"o:{pid}:{day}")
            work[key] = model.new_bool_var(f"w:{pid}:{day}")
            current = {}
            closed = day in policy["closedDates"] or (
                day in policy["holidayDates"] and day not in policy["authorizedHolidayDates"])
            for sid in ([] if untimed else person["shiftIds"]):
                if not admissible(shifts[sid], policy, day):
                    continue
                current[sid] = model.new_bool_var(f"s:{pid}:{day}:{sid}")
                occupied = occupied_dates(day, shifts[sid])
                forbidden = any(d in policy["closedDates"] or (d in policy["holidayDates"] and d not in policy["authorizedHolidayDates"]) for d in occupied)
                if closed or forbidden:
                    model.add(current[sid] == 0)
            choices[key] = current
            if untimed:
                if closed or not untimed_admissible(policy, day):
                    model.add(work[key] == 0)
            else:
                model.add(work[key] == sum(current.values()))
            model.add(work[key] + off[key] == (0 if absent else 1))
            weekday = date.fromisoformat(day).weekday()
            if weekday in person["fixedOffDays"] and not absent:
                model.add(off[key] == 1)
            if day in policy["holidayDates"] and (not policy["holidayRestAllowed"] or policy.get("normativeProfile") == CCT_PROFILE):
                model.add(off[key] == 0)
            if old and old.get("locked") and not absent:
                if old["kind"] == "OFF":
                    model.add(off[key] == 1)
                elif old["kind"] == "DUTY" and untimed:
                    model.add(work[key] == 1)
                elif old.get("shiftId") in current:
                    model.add(current[old["shiftId"]] == 1)
                else:
                    model.add(work[key] == 2)  # explicitly infeasible, never replace a locked shift
            if old and not absent:
                same = (off[key] if old["kind"] == "OFF" else work[key]
                        if old["kind"] == "DUTY" and untimed else current.get(old.get("shiftId"), 0))
                changed.append(1 - same)
                stability_terms.append(1 - same)
            if weekday in person["preferredOffDays"]:
                preference_terms.append(work[key])
            rank = int(hashlib.sha256(f"{pid}:{day}".encode()).hexdigest()[:6], 16) % 97
            tie_terms.append(rank * off[key])
        if changed:
            changed_person = model.new_bool_var(f"changed:{pid}")
            for term in changed:
                model.add(changed_person >= term)
            people_changed.append(changed_person)
        for week in range(0, len(dates), 7):
            group = [d for d in dates[week:week + 7] if d in active[pid]]
            absences = [d for d in group if baseline.get((pid, d), {}).get("kind") == "ABSENCE"]
            if len(group) == 7 and not absences:
                model.add(sum(work[pid, d] for d in group) == 5)
                model.add(sum(off[pid, d] for d in group) == 2)
                if not untimed:
                    model.add(sum(metrics[s][0] * v for d in group for s, v in choices[pid, d].items())
                              == effective_weekly_hours(person, dates[week + 6]) * 60)
            else:
                model.add(sum(work[pid, d] for d in group) <= 5)
            if not untimed:
                model.add(sum(metrics[s][0] * v for d in group for s, v in choices[pid, d].items())
                          <= min(effective_weekly_hours(person, dates[week + 6]), policy["weeklyLimit"]) * 60)
        _streaks(model, person, dates, work, off, prior, active[pid], policy)
        _rest(model, person, dates, choices, off, prior, shifts, metrics, policy)
        civil_sundays = _civil_rest(model, person, dates, choices, work, off, prior, shifts)
        for day in active[pid]:
            if person["offPattern"] == "CONSECUTIVE":
                neighbors = []
                for delta in (-1, 1):
                    adjacent = (date.fromisoformat(day) + timedelta(days=delta)).isoformat()
                    fixed_boundary = (day == dates[-1] and delta == 1 and date.fromisoformat(day).weekday() == 6
                                      and person["offMode"] in ("FIXED", "MIXED")
                                      and 0 in person["fixedOffDays"]
                                      and (not person.get("activeUntil") or adjacent <= person["activeUntil"])
                                      and not (adjacent in policy["holidayDates"] and (not policy["holidayRestAllowed"] or policy.get("normativeProfile") == CCT_PROFILE)))
                    neighbors.append(off.get((pid, adjacent), int(prior.get(adjacent, {}).get("kind") == "OFF" or fixed_boundary)))
                model.add(off[pid, day] <= sum(neighbors))
        if person["offPattern"] == "PREFER_CONSECUTIVE":
            for day in active[pid]:
                tomorrow = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
                if (pid, tomorrow) in off:
                    pair = model.new_bool_var(f"pair:{pid}:{day}")
                    model.add_min_equality(pair, [off[pid, day], off[pid, tomorrow]])
                    preference_terms.append(-pair)
        sundays = [d for d in dates if date.fromisoformat(d).weekday() == 6 and d in active[pid]]
        historical, known_sundays = _historical_sundays(prior, shifts, dates[0])
        opportunities = max(1, sum(baseline.get((pid, d), {}).get("kind") != "ABSENCE" for d in sundays)
                            + known_sundays)
        sunday_totals[pid] = (sum(civil_sundays[d] for d in sundays) + historical, opportunities)
    coverage = _coverage(model, data, employees, choices, shifts, started)
    if coverage is False:
        return _response("UNKNOWN", [], started)
    if isinstance(coverage, str):
        return _response("INFEASIBLE", [], started, coverage)
    fairness = []
    groups = {}
    for person in employees:
        # Comparable opportunities only; absence/new-hire histories are not a debt.
        key = (person.get("scheduleMode", "TIMED"), person["sector"], person["role"], sunday_limit(person),
               () if person.get("scheduleMode") == "UNTIMED" else
               tuple(effective_weekly_hours(person, dates[index + 6]) for index in range(0, len(dates), 7)))
        groups.setdefault(key, []).append(person["id"])
    for index, members in enumerate(groups.values()):
        if len(members) < 2:
            continue
        maximum = model.new_int_var(0, 10000, f"max-sunday:{index}")
        minimum = model.new_int_var(0, 10000, f"min-sunday:{index}")
        totals = []
        for pid in members:
            score = model.new_int_var(0, 10000, f"sunday-rate:{pid}")
            total, opportunities = sunday_totals[pid]
            model.add_division_equality(score, total * 10000, opportunities)
            totals.append(score)
        model.add_max_equality(maximum, totals)
        model.add_min_equality(minimum, totals)
        fairness.append(maximum - minimum)
    # Unconfirmed staffing estimates are planning goals, never approved minima.
    # Prioritize their person-minute shortages before rotation and preferences.
    objectives = [sum(coverage), sum(fairness), sum(people_changed), sum(stability_terms), sum(preference_terms), sum(tie_terms)]
    result, status_name, proven = None, "UNKNOWN", True
    # Establish a legal incumbent before spending the bounded budget on estimates.
    # This seed does not lock a staffing objective or relax a mandatory condition.
    phases = ([None] if coverage else []) + objectives
    hint_variables = [model.get_int_var_from_proto_index(index) for index in range(len(model.proto.variables))]
    for index, objective in enumerate(phases):
        remaining = MAX_SECONDS - (time.monotonic() - started)
        if remaining < 0.1:
            proven = False
            break
        if objective is None:
            model.clear_objective()
        else:
            model.minimize(objective)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = (min(4, remaining / 2) if objective is None else remaining
                                                if index == int(bool(coverage)) else min(remaining, 3))
        solver.parameters.stop_after_first_solution = objective is None
        solver.parameters.num_search_workers = 2
        solver.parameters.random_seed = 37
        status = solver.solve(model)
        status_name = solver.status_name(status)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            if objective is None and status == cp_model.UNKNOWN:
                continue
            if result is None:
                return _response(status_name, [], started)
            proven = False
            break
        result = []
        for person in employees:
            for day in active[person["id"]]:
                key = person["id"], day
                old = baseline.get(key, {})
                item = {"employeeId": key[0], "date": day, "kind": "OFF"}
                if old.get("kind") == "ABSENCE":
                    item["kind"] = "ABSENCE"
                elif person.get("scheduleMode") == "UNTIMED" and solver.value(work[key]):
                    item["kind"] = "DUTY"
                else:
                    for sid, variable in choices[key].items():
                        if solver.value(variable):
                            item.update(kind="WORK", shiftId=sid)
                            break
                if old.get("locked"):
                    item["locked"] = True
                result.append(item)
        model.clear_hints()
        for variable in hint_variables:
            model.add_hint(variable, solver.value(variable))
        if objective is None:
            continue
        if status == cp_model.FEASIBLE:
            proven = False
            break  # Never trade away a higher-priority objective not proved optimal.
        model.add(objective == solver.value(objective))
    if result is None:
        return _response("UNKNOWN", [], started)
    return _response("OPTIMAL" if proven else "FEASIBLE", result, started)


def _streaks(model, person, dates, work, off, prior, active, policy):
    pid = person["id"]
    first = (date.fromisoformat(dates[0]) - timedelta(days=21)).isoformat()
    timeline = days_between(first, dates[-1])
    maximum = min(6, policy["maxConsecutiveWorkDays"])
    for end in range(maximum, len(timeline)):
        window = timeline[end - maximum:end + 1]
        if not any(d in active for d in window):
            continue
        terms = [work.get((pid, d), int(prior.get(d, {}).get("kind") in ("WORK", "DUTY"))) for d in window]
        model.add(sum(terms) <= maximum)
    sundays = [d for d in timeline if date.fromisoformat(d).weekday() == 6]
    maximum = sunday_limit(person)
    for end in range(maximum, len(sundays)):
        window = sundays[end - maximum:end + 1]
        if any(d in active for d in window):
            model.add(sum(work.get((pid, d), int(prior.get(d, {}).get("kind") in ("WORK", "DUTY")))
                          for d in window) <= maximum)


def _historical_sundays(prior, shifts, start):
    first = (date.fromisoformat(start) - timedelta(days=21)).isoformat()
    occupied = set()
    known = {day for day, entry in prior.items() if first <= day < start
             and date.fromisoformat(day).weekday() == 6 and entry["kind"] in ("WORK", "DUTY", "OFF")}
    for day, entry in prior.items():
        if entry["kind"] not in ("WORK", "DUTY"):
            continue
        civil_days = {day} if entry["kind"] == "DUTY" else occupied_dates(day, shifts[entry["shiftId"]])
        occupied.update(civil for civil in civil_days if first <= civil < start and date.fromisoformat(civil).weekday() == 6)
    return len(occupied), len(known | occupied)


def _rest(model, person, dates, choices, off, prior, shifts, metrics, policy):
    if person.get("scheduleMode") == "UNTIMED":
        return  # No timestamps exist to establish an hourly rest interval.
    pid = person["id"]
    occupied = []
    first_relevant = (date.fromisoformat(dates[0]) - timedelta(days=5)).isoformat()
    for day, entry in prior.items():
        if entry["kind"] == "WORK" and day >= first_relevant:
            occupied.append((day, entry["shiftId"], 1))
    for (employee, day), options in choices.items():
        if employee == pid:
            occupied.extend((day, sid, variable) for sid, variable in options.items())
    occupied.sort(key=lambda item: (item[0], item[1]))
    for i, (day, sid, variable) in enumerate(occupied):
        finish = instant(day, metrics[sid][2])
        for next_day, next_sid, next_variable in occupied[i + 1:]:
            delta = (date.fromisoformat(next_day) - date.fromisoformat(day)).days
            if delta > 5:
                break
            if delta == 0 or next_day < dates[0]:
                continue
            gap = instant(next_day, metrics[next_sid][1]) - finish
            if gap < policy["minInterShiftMinutes"]:
                model.add(variable + next_variable <= 1)
            elif gap < policy["minWeeklyRestMinutes"] and delta > 1:
                for middle in days_between(day, next_day)[1:-1]:
                    resting = off.get((pid, middle), int(prior.get(middle, {}).get("kind") == "OFF"))
                    model.add(variable + next_variable + resting <= 2)


def _civil_rest(model, person, dates, choices, work, off, prior, shifts):
    pid = person["id"]
    sunday_terms = {}
    for (employee, day), options in choices.items():
        if employee != pid:
            continue
        if person.get("scheduleMode") == "UNTIMED" and date.fromisoformat(day).weekday() == 6:
            sunday_terms.setdefault(day, []).append(work[pid, day])
        for sid, variable in options.items():
            for occupied in occupied_dates(day, shifts[sid]):
                if occupied != day and (pid, occupied) in off:
                    model.add(variable + off[pid, occupied] <= 1)
                if date.fromisoformat(occupied).weekday() == 6:
                    sunday_terms.setdefault(occupied, []).append(variable)
    for day, assignment in prior.items():
        if assignment["kind"] not in ("WORK", "DUTY"):
            continue
        occupied_days = {day} if assignment["kind"] == "DUTY" else occupied_dates(day, shifts[assignment["shiftId"]])
        for occupied in occupied_days:
            if (pid, occupied) in off:
                model.add(off[pid, occupied] == 0)
            if date.fromisoformat(occupied).weekday() == 6:
                sunday_terms.setdefault(occupied, []).append(1)
    first = (date.fromisoformat(dates[0]) - timedelta(days=21)).isoformat()
    sundays = [d for d in days_between(first, dates[-1]) if date.fromisoformat(d).weekday() == 6]
    occupied_sundays = {}
    for day in sundays:
        present = model.new_bool_var(f"sunday-occupied:{pid}:{day}")
        terms = sunday_terms.get(day, [])
        if terms:
            model.add_max_equality(present, terms)
        else:
            model.add(present == 0)
        occupied_sundays[day] = present
    cap = sunday_limit(person)
    for end in range(cap, len(sundays)):
        group = sundays[end - cap:end + 1]
        if group[-1] >= dates[0]:
            model.add(sum(occupied_sundays[d] for d in group) <= cap)
    return occupied_sundays


def _coverage(model, data, employees, choices, shifts, started):
    by_id = {p["id"]: p for p in employees}
    index = {}
    shortages = []

    def register(pid, day, sid, variable):
        person = by_id[pid]
        for segment in shifts[sid]["segments"]:
            if segment["kind"] != "WORK":
                continue
            start, end = instant(day, segment["start"]), instant(day, segment["end"])
            for offset in range(segment["start"] // 1440, (segment["end"] - 1) // 1440 + 1):
                civil = (date.fromisoformat(day) + timedelta(days=offset)).isoformat()
                index.setdefault((person["sector"], civil), []).append((start, end, variable, person["role"]))

    for (pid, day), options in choices.items():
        for sid, variable in options.items():
            register(pid, day, sid, variable)
    for person in employees:
        if person.get("scheduleMode") == "UNTIMED":
            continue
        for assignment in {a["date"]: a for a in person.get("planningHistory", []) + person["history"]}.values():
            if assignment["kind"] == "WORK" and assignment["date"] >= (date.fromisoformat(data["startDate"]) - timedelta(days=1)).isoformat():
                register(person["id"], assignment["date"], assignment["shiftId"], 1)
    for demand_index, demand in enumerate(data["demands"]):
        if time.monotonic() - started > MAX_SECONDS - 1:
            return False
        begin, finish = instant(demand["date"], demand["start"]), instant(demand["date"], demand["end"])
        intervals, points = [], {begin, finish}
        for start, end, variable, role in index.get((demand["sector"], demand["date"]), []):
            if demand.get("role") and role != demand["role"]:
                continue
            if end > begin and start < finish:
                left, right = max(begin, start), min(finish, end)
                intervals.append((left, right, variable))
                points.update((left, right))
        ordered = sorted(points)
        estimated = demand.get("estimated") is True and data["policy"].get("coverageReview") == "SUGGESTED"
        for interval_index, (left, right) in enumerate(zip(ordered, ordered[1:])):
            available = [v for start, end, v in intervals if start <= left and end >= right]
            if estimated:
                if demand["minimum"] > 0:
                    shortage = model.new_int_var(0, demand["minimum"], f"coverage-gap:{demand_index}:{interval_index}")
                    model.add(sum(available) + shortage >= demand["minimum"])
                    shortages.append(int(right - left) * shortage)
                continue
            if not available and demand["minimum"] > 0:
                minute = int(left - instant(demand["date"], 0))
                return (f"Cobertura sem horário disponível em {demand['date']} às {minute // 60:02d}:{minute % 60:02d}. "
                        "Confira os turnos permitidos, intervalos de refeição, setor e cargo da faixa antes de alterar o efetivo.")
            model.add(sum(available) >= demand["minimum"])
    return shortages


def _response(status, assignments, started, message=None):
    messages = {
        "OPTIMAL": "Proposta calculada; objetivos configurados concluídos. Confira a validação independente.",
        "FEASIBLE": "Proposta viável encontrada no prazo; melhor distribuição não comprovada.",
        "INFEASIBLE": "Não existe combinação com os turnos, folgas, bloqueios e cobertura informados. Revise os conflitos.",
        "UNKNOWN": "Prazo encerrado sem proposta. Isso não comprova impossibilidade.",
        "MODEL_INVALID": "O modelo não pôde ser processado. Revise os dados e tente novamente.",
    }
    return {"status": status, "assignments": assignments,
            "message": message or messages.get(status, messages["MODEL_INVALID"]),
            "wallTimeSeconds": round(time.monotonic() - started, 3)}
