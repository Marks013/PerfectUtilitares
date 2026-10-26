"""Integer-minute CP-SAT model; approval additionally requires the independent TS verifier."""
import hashlib
import time
from datetime import date, datetime, time as civil_time, timedelta
from zoneinfo import ZoneInfo

from ortools.sat.python import cp_model

ZONE = ZoneInfo("America/Sao_Paulo")
MAX_SECONDS = 12


def days_between(start, end):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    return [(first + timedelta(days=n)).isoformat()
            for n in range((last - first).days + 1)]


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


def admissible(shift, policy):
    paid, _start, _end = shift_metrics(shift)
    if paid > min(policy["dailyLimitMinutes"], 600):
        return False
    if paid > 480 and not policy["compensationAuthorized"]:
        return False
    first, last = shift["segments"][0]["start"], shift["segments"][-1]["end"]
    meals = [s["end"] - s["start"] for s in shift["segments"]
             if s["kind"] == "BREAK" and s["start"] > first and s["end"] < last]
    required = policy["minMealMinutes"] if paid > 360 else (15 if paid > 240 else 0)
    return required == 0 or max(meals, default=0) >= required


def solve(data, force=None):
    started = time.monotonic()
    force = force or {}
    dates = days_between(data["startDate"], data["endDate"])
    employees = sorted(data["employees"], key=lambda e: e["id"])
    if not 1 <= len(employees) <= 150 or not 7 <= len(dates) <= 42 or len(dates) % 7:
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
        prior = {a["date"]: a for a in person["history"]}
        history[pid] = prior
        options = [s for s in person["shiftIds"] if admissible(shifts[s], policy)]
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
            for sid in options:
                current[sid] = model.new_bool_var(f"s:{pid}:{day}:{sid}")
                occupied = occupied_dates(day, shifts[sid])
                forbidden = any(d in policy["closedDates"] or (d in policy["holidayDates"] and d not in policy["authorizedHolidayDates"]) for d in occupied)
                if closed or forbidden:
                    model.add(current[sid] == 0)
            choices[key] = current
            model.add(work[key] == sum(current.values()))
            model.add(work[key] + off[key] == (0 if absent else 1))
            weekday = date.fromisoformat(day).weekday()
            if weekday in person["fixedOffDays"] and not absent:
                model.add(off[key] == 1)
            if day in policy["holidayDates"] and not policy["holidayRestAllowed"]:
                model.add(off[key] == 0)
            if old and old.get("locked") and not absent:
                if old["kind"] == "OFF":
                    model.add(off[key] == 1)
                elif old.get("shiftId") in current:
                    model.add(current[old["shiftId"]] == 1)
                else:
                    model.add(work[key] == 2)  # explicitly infeasible, never replace a locked shift
            if force.get("employeeId") == pid and day in force.get("offDates", []):
                model.add(off[key] == 1)
            if old and not absent:
                same = off[key] if old["kind"] == "OFF" else current.get(old.get("shiftId"), 0)
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
        if force.get("employeeId") == pid:
            for pair in force.get("excludedOffPairs", []):
                if len(pair) != 2 or any((pid, day) not in off for day in pair):
                    raise ValueError("invalid excluded pair")
                model.add(sum(off[pid, day] for day in pair) <= 1)
        for week in range(0, len(dates), 7):
            group = [d for d in dates[week:week + 7] if d in active[pid]]
            absences = [d for d in group if baseline.get((pid, d), {}).get("kind") == "ABSENCE"]
            if len(group) == 7 and not absences:
                model.add(sum(work[pid, d] for d in group) == 5)
                model.add(sum(off[pid, d] for d in group) == 2)
                model.add(sum(metrics[s][0] * v for d in group for s, v in choices[pid, d].items())
                          == person["weeklyHours"] * 60)
            else:
                model.add(sum(work[pid, d] for d in group) <= 5)
            model.add(sum(metrics[s][0] * v for d in group for s, v in choices[pid, d].items())
                      <= min(person["weeklyHours"], policy["weeklyLimit"]) * 60)
        _streaks(model, person, dates, work, off, prior, active[pid], policy)
        _rest(model, person, dates, choices, off, prior, shifts, policy)
        _civil_rest(model, person, dates, choices, off, prior, shifts)
        for day in active[pid]:
            if person["offPattern"] == "CONSECUTIVE":
                neighbors = []
                for delta in (-1, 1):
                    adjacent = (date.fromisoformat(day) + timedelta(days=delta)).isoformat()
                    fixed_boundary = (day == dates[-1] and delta == 1 and date.fromisoformat(day).weekday() == 6
                                      and person["offMode"] in ("FIXED", "MIXED")
                                      and 0 in person["fixedOffDays"]
                                      and (not person.get("activeUntil") or adjacent <= person["activeUntil"])
                                      and not (adjacent in policy["holidayDates"] and not policy["holidayRestAllowed"]))
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
        historical = sum(a["kind"] == "WORK" for d, a in prior.items() if date.fromisoformat(d).weekday() == 6)
        opportunities = max(1, sum(baseline.get((pid, d), {}).get("kind") != "ABSENCE" for d in sundays)
                            + sum(date.fromisoformat(d).weekday() == 6 and a["kind"] in ("WORK", "OFF") for d, a in prior.items()))
        sunday_totals[pid] = (sum(work[pid, d] for d in sundays) + historical, opportunities)
    if not _coverage(model, data, employees, choices, shifts, started):
        return _response("UNKNOWN", [], started)
    fairness = []
    groups = {}
    for person in employees:
        # Comparable opportunities only; absence/new-hire histories are not a debt.
        key = (person["sector"], person["role"], person["maxConsecutiveSundays"],
               person["weeklyHours"])
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
    objectives = [sum(fairness), sum(people_changed), sum(stability_terms), sum(preference_terms), sum(tie_terms)]
    result, status_name, proven = None, "UNKNOWN", True
    for index, objective in enumerate(objectives):
        remaining = MAX_SECONDS - (time.monotonic() - started)
        if remaining < 0.1:
            proven = False
            break
        model.minimize(objective)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = remaining if index == 0 else min(remaining, 3)
        solver.parameters.num_search_workers = 2
        solver.parameters.random_seed = 37
        status = solver.solve(model)
        status_name = solver.status_name(status)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
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
                else:
                    for sid, variable in choices[key].items():
                        if solver.value(variable):
                            item.update(kind="WORK", shiftId=sid)
                            break
                if old.get("locked"):
                    item["locked"] = True
                result.append(item)
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
        terms = [work.get((pid, d), int(prior.get(d, {}).get("kind") == "WORK")) for d in window]
        model.add(sum(terms) <= maximum)
    sundays = [d for d in timeline if date.fromisoformat(d).weekday() == 6]
    maximum = person["maxConsecutiveSundays"]
    for end in range(maximum, len(sundays)):
        window = sundays[end - maximum:end + 1]
        if any(d in active for d in window):
            model.add(sum(work.get((pid, d), int(prior.get(d, {}).get("kind") == "WORK"))
                          for d in window) <= maximum)


def _rest(model, person, dates, choices, off, prior, shifts, policy):
    pid = person["id"]
    occupied = []
    for day, entry in prior.items():
        if entry["kind"] == "WORK":
            occupied.append((day, entry["shiftId"], 1))
    for (employee, day), options in choices.items():
        if employee == pid:
            occupied.extend((day, sid, variable) for sid, variable in options.items())
    occupied.sort(key=lambda item: (item[0], item[1]))
    for i, (day, sid, variable) in enumerate(occupied):
        finish = instant(day, shift_metrics(shifts[sid])[2])
        for next_day, next_sid, next_variable in occupied[i + 1:]:
            delta = (date.fromisoformat(next_day) - date.fromisoformat(day)).days
            if delta > 5:
                break
            if delta == 0 or next_day < dates[0]:
                continue
            gap = instant(next_day, shift_metrics(shifts[next_sid])[1]) - finish
            if gap < policy["minInterShiftMinutes"]:
                model.add(variable + next_variable <= 1)
            elif gap < policy["minWeeklyRestMinutes"] and delta > 1:
                for middle in days_between(day, next_day)[1:-1]:
                    resting = off.get((pid, middle), int(prior.get(middle, {}).get("kind") == "OFF"))
                    model.add(variable + next_variable + resting <= 2)


def _civil_rest(model, person, dates, choices, off, prior, shifts):
    pid = person["id"]
    sunday_terms = {}
    for (employee, day), options in choices.items():
        if employee != pid:
            continue
        for sid, variable in options.items():
            for occupied in occupied_dates(day, shifts[sid]):
                if occupied != day and (pid, occupied) in off:
                    model.add(variable + off[pid, occupied] <= 1)
                if date.fromisoformat(occupied).weekday() == 6:
                    sunday_terms.setdefault(occupied, []).append(variable)
    for day, assignment in prior.items():
        if assignment["kind"] != "WORK":
            continue
        for occupied in occupied_dates(day, shifts[assignment["shiftId"]]):
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
    cap = person["maxConsecutiveSundays"]
    for end in range(cap, len(sundays)):
        group = sundays[end - cap:end + 1]
        if group[-1] >= dates[0]:
            model.add(sum(occupied_sundays[d] for d in group) <= cap)


def _coverage(model, data, employees, choices, shifts, started):
    by_id = {p["id"]: p for p in employees}
    index = {}

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
        for assignment in person["history"]:
            if assignment["kind"] == "WORK":
                register(person["id"], assignment["date"], assignment["shiftId"], 1)
    for demand in data["demands"]:
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
        for left, right in zip(ordered, ordered[1:]):
            model.add(sum(v for start, end, v in intervals if start <= left and end >= right) >= demand["minimum"])
    return True


def _response(status, assignments, started):
    messages = {
        "OPTIMAL": "Proposta calculada; objetivos configurados concluídos. Confira a validação independente.",
        "FEASIBLE": "Proposta viável encontrada no prazo; melhor distribuição não comprovada.",
        "INFEASIBLE": "Não existe combinação com os turnos, folgas, bloqueios e cobertura informados. Revise os conflitos.",
        "UNKNOWN": "Prazo encerrado sem proposta. Isso não comprova impossibilidade.",
        "MODEL_INVALID": "O modelo não pôde ser processado. Revise os dados e tente novamente.",
    }
    return {"status": status, "assignments": assignments,
            "message": messages.get(status, messages["MODEL_INVALID"]),
            "wallTimeSeconds": round(time.monotonic() - started, 3)}
