"""Integer-minute CP-SAT model; approval additionally requires the independent TS verifier."""
import hashlib
import unicodedata
import re
import time
from functools import lru_cache
from datetime import date, datetime, time as civil_time, timedelta
from zoneinfo import ZoneInfo

from ortools.sat.python import cp_model

from hints import balanced_rest_hints
from optimization import Snapshot, improve, remember

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


def effective_weekly_minutes(person, week_end, simulation=False):
    target = effective_weekly_hours(person, week_end) * 60
    if simulation and person.get("simulationDailyMinutes") is not None:
        target = min(target, person["simulationDailyMinutes"] * 5)
    return target


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
    if policy.get("_simulation") or policy.get("normativeProfile") != CCT_PROFILE:
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


def maximum_meal_minutes(policy, day):
    document = policy.get('mealIntervalAgreement')
    if not reviewed_document(document, day, 'source'):
        return 120
    try:
        date.fromisoformat(document['validFrom'])
        date.fromisoformat(document['validUntil'])
    except (ValueError, TypeError):
        return 120
    maximum = document.get('maximumMinutes')
    return maximum if type(maximum) is int and 121 <= maximum <= 360 else 120


def admissible(shift, policy, day):
    paid, _start, _end = shift_metrics(shift)
    ceiling = 480 if day >= TRANSITION_40_DATE else 504 if day >= TRANSITION_42_DATE else 600
    if paid > min(policy["dailyLimitMinutes"], ceiling):
        return False
    if paid > 480 and not policy["compensationAuthorized"] and not policy.get("_simulation"):
        return False
    if paid > 480 and TRANSITION_42_DATE <= day < TRANSITION_40_DATE and not policy.get("_simulation"):
        if not reviewed_document(policy.get("collectiveAgreement"), day, "source"):
            return False
    if not cct_admissible(shift, policy, day):
        return False
    first, last = shift["segments"][0]["start"], shift["segments"][-1]["end"]
    meals = [s["end"] - s["start"] for s in shift["segments"]
             if s["kind"] == "BREAK" and s["start"] > first and s["end"] < last]
    if paid > 360 and max(meals, default=0) > maximum_meal_minutes(policy, day) and not policy.get('_simulation'):
        return False
    short_pause_flex = policy.get("_simulation") and policy.get("allowShortMealSimulation") is True
    required = policy["minMealMinutes"] if paid > 360 else (15 if paid > 240 and not short_pause_flex else 0)
    return required == 0 or max(meals, default=0) >= required


def untimed_admissible(policy, day):
    if policy.get("_simulation"):
        return True
    if policy.get("normativeProfile") != CCT_PROFILE:
        return True
    return (CCT_FROM <= day <= CCT_UNTIL
            and (date.fromisoformat(day).weekday() != 6 or certificate_authorizes(policy, day, "sundays"))
            and (day not in policy["holidayDates"] or certificate_authorizes(policy, day, "holidays")))


def has_no_clock(person):
    # Missing imported clocks do not establish exemption from working-time control.
    return person.get("scheduleMode") in ("UNTIMED", "MISSING")


def excluded_apprentice(person):
    role = unicodedata.normalize('NFKD', person.get('role', '')).encode('ascii', 'ignore').decode().upper()
    return re.sub('[^A-Z0-9]+', ' ', role).strip() in ('AUX DE SERVICOS EM SUPER', 'JOVEM APRENDIZ', 'APRENDIZ')


def retained_learner_records(data):
    retained = {p['id'] for p in data['employees'] if p.get('planningEnabled') is False and excluded_apprentice(p)}
    return [dict(a) for a in data['assignments'] if a['employeeId'] in retained and (a.get('locked') or a['kind'] == 'ABSENCE')]


def solve(data):
    started = time.monotonic()
    dates = days_between(data["startDate"], data["endDate"])
    employees = sorted((p for p in data["employees"] if p.get("planningEnabled") is not False), key=lambda e: e["id"])
    if not 1 <= len(employees) <= 250 or not 7 <= len(dates) <= 42 or len(dates) % 7:
        raise ValueError("model bounds")
    policy = {**data["policy"], "_simulation": data.get("simulation") is True}
    shifts = {s["id"]: s for s in data["shifts"]}
    metrics = {key: shift_metrics(value) for key, value in shifts.items()}
    baseline = {(a["employeeId"], a["date"]): a for a in data["assignments"]}
    model = cp_model.CpModel()
    work, off, choices, history, active = {}, {}, {}, {}, {}
    preference_terms, stability_terms, people_changed, tie_terms = [], [], [], []
    weekend_totals = {5: {}, 6: {}}
    for person in employees:
        if time.monotonic() - started > MAX_SECONDS - 1:
            return _response("UNKNOWN", [], started)
        pid = person["id"]
        untimed = has_no_clock(person)
        prior = {a["date"]: a for a in person.get("planningHistory", []) + person["history"]}
        history[pid] = prior
        future_limit = (date.fromisoformat(dates[-1]) + timedelta(days=21)).isoformat()
        future = {a["date"]: a for a in person.get("planningFuture", [])
                  if dates[-1] < a["date"] <= future_limit}
        # Published neighboring assignments constrain the boundary, not fairness history.
        boundary = {**prior, **future}
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
                day in policy["holidayDates"] and day not in policy["authorizedHolidayDates"] and not policy.get("_simulation"))
            for sid in ([] if untimed else person["shiftIds"]):
                if not admissible(shifts[sid], policy, day):
                    continue
                current[sid] = model.new_bool_var(f"s:{pid}:{day}:{sid}")
                occupied = occupied_dates(day, shifts[sid])
                forbidden = any(baseline.get((pid, d), {}).get("kind") == "ABSENCE" or d in policy["closedDates"] or (d in policy["holidayDates"] and d not in policy["authorizedHolidayDates"] and not policy.get("_simulation")) for d in occupied)
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
                              == effective_weekly_minutes(person, dates[week + 6], policy["_simulation"]))
            else:
                model.add(sum(work[pid, d] for d in group) <= 5)
            if not untimed:
                model.add(sum(metrics[s][0] * v for d in group for s, v in choices[pid, d].items())
                          <= min(effective_weekly_minutes(person, dates[week + 6], policy["_simulation"]), policy["weeklyLimit"] * 60))
        _streaks(model, person, dates, work, off, boundary, active[pid], policy)
        _rest(model, person, dates, choices, off, boundary, shifts, metrics, policy)
        civil_weekends = _civil_rest(model, person, dates, choices, work, off, boundary, shifts)
        for day in active[pid]:
            if person["offPattern"] == "CONSECUTIVE":
                neighbors = []
                for delta in (-1, 1):
                    adjacent = (date.fromisoformat(day) + timedelta(days=delta)).isoformat()
                    fixed_boundary = (day == dates[-1] and delta == 1 and date.fromisoformat(day).weekday() == 6
                                      and person["offMode"] in ("FIXED", "MIXED")
                                      and 0 in person["fixedOffDays"]
                                      and adjacent not in boundary
                                      and (not person.get("activeUntil") or adjacent <= person["activeUntil"])
                                      and not (adjacent in policy["holidayDates"] and (not policy["holidayRestAllowed"] or policy.get("normativeProfile") == CCT_PROFILE)))
                    neighbors.append(off.get((pid, adjacent), int(boundary.get(adjacent, {}).get("kind") == "OFF" or fixed_boundary)))
                model.add(off[pid, day] <= sum(neighbors))
        if person["offPattern"] == "CONSECUTIVE":
            first_future = (date.fromisoformat(dates[-1]) + timedelta(days=1)).isoformat()
            next_future = (date.fromisoformat(dates[-1]) + timedelta(days=2)).isoformat()
            if (future.get(first_future, {}).get("kind") == "OFF"
                    and future.get(next_future, {}).get("kind") in ("WORK", "DUTY", "ABSENCE")
                    and (pid, dates[-1]) in off):
                # Preserve the pair of a published first-day rest. Unknown later
                # information is not silently treated as either work or rest.
                model.add(off[pid, dates[-1]] == 1)
        if person["offPattern"] == "PREFER_CONSECUTIVE":
            for day in active[pid]:
                tomorrow = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
                if (pid, tomorrow) in off:
                    pair = model.new_bool_var(f"pair:{pid}:{day}")
                    model.add_min_equality(pair, [off[pid, day], off[pid, tomorrow]])
                    preference_terms.append(-pair)
        for weekday in (5, 6):
            weekends = [d for d in active[pid] if date.fromisoformat(d).weekday() == weekday]
            historical, known = _historical_weekdays(prior, shifts, dates[0], weekday)
            opportunities = max(1, sum(baseline.get((pid, d), {}).get("kind") != "ABSENCE" for d in weekends)
                                + known)
            weekend_totals[weekday][pid] = (sum(civil_weekends[d] for d in weekends) + historical, opportunities)
    hard_coverage = _coverage(model, data, employees, choices, shifts, started, "HARD")
    if hard_coverage is False:
        return _response("UNKNOWN", [], started)
    if isinstance(hard_coverage, str):
        return _response("INFEASIBLE", [], started, hard_coverage)
    # Find a mandatory-feasible incumbent before adding thousands of optional staffing goals.
    # Optional optimization must never consume the only opportunity to return a complete draft.
    if MAX_SECONDS - (time.monotonic() - started) < 0.1:
        return _response("UNKNOWN", [], started)
    _feasibility_hints(model, employees, dates, off, work, choices, active, baseline, metrics, policy)
    remaining = MAX_SECONDS - (time.monotonic() - started)
    if remaining < 0.1:
        return _response("UNKNOWN", [], started)
    seed_variables = [model.get_int_var_from_proto_index(index) for index in range(len(model.proto.variables))]
    seed = cp_model.CpSolver()
    seed.parameters.max_time_in_seconds = min(2, remaining)
    seed.parameters.stop_after_first_solution = True
    seed.parameters.num_workers = 1
    seed.parameters.random_seed = 37
    # Validate the proposed warm start before symmetry reduction can discard it.
    # Fixing is confined to this solver invocation; the model remains unrestricted.
    # A rejected proposal is not evidence that the actual scheduling model is infeasible.
    seed.parameters.fix_variables_to_their_hinted_value = True
    seed_status = seed.solve(model)
    if seed_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        remaining = MAX_SECONDS - (time.monotonic() - started)
        if remaining < 0.1:
            return _response("UNKNOWN", [], started)
        seed.parameters.fix_variables_to_their_hinted_value = False
        seed.parameters.max_time_in_seconds = min(6, remaining)
        seed_status = seed.solve(model)
        if seed_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return _response(seed.status_name(seed_status), [], started)
    result = _read_assignments(seed, employees, active, baseline, work, choices) + retained_learner_records(data)
    values = {variable.index: seed.value(variable) for variable in seed_variables}
    model.clear_hints()
    for variable in seed_variables:
        model.add_hint(variable, seed.value(variable))
    coverage = _coverage(model, data, employees, choices, shifts, started, "ESTIMATED", values)
    if coverage is False:
        return _response("FEASIBLE", result, started)
    if isinstance(coverage, str):
        return _response("FEASIBLE", result, started)
    fairness = []
    groups = {}
    for person in employees:
        # Comparable opportunities only; absence/new-hire histories are not a debt.
        key = (has_no_clock(person), person["sector"], sunday_limit(person),
               () if has_no_clock(person) else
               tuple(effective_weekly_hours(person, dates[index + 6]) for index in range(0, len(dates), 7)))
        groups.setdefault(key, []).append(person["id"])
    for index, members in enumerate(groups.values()):
        if len(members) < 2:
            continue
        for weekday in (5, 6):
            maximum = model.new_int_var(0, 10000, f"max-weekend:{weekday}:{index}")
            minimum = model.new_int_var(0, 10000, f"min-weekend:{weekday}:{index}")
            totals, scores = [], []
            for pid in members:
                score = model.new_int_var(0, 10000, f"weekend-rate:{weekday}:{pid}")
                total, opportunities = weekend_totals[weekday][pid]
                model.add_division_equality(score, total * 10000, opportunities)
                totals.append(score)
                scores.append(seed.value(total) * 10000 // opportunities)
                remember(model, values, score, scores[-1])
            model.add_max_equality(maximum, totals)
            model.add_min_equality(minimum, totals)
            remember(model, values, maximum, max(scores))
            remember(model, values, minimum, min(scores))
            fairness.append(maximum - minimum)
    # Unconfirmed staffing estimates are planning goals, never approved minima.
    # Prioritize their person-minute shortages before rotation and preferences.
    concentration, rotation = _rest_distribution(model, employees, dates, off, active, baseline, history, policy, values)
    goals = [("COVERAGE", sum(coverage)), ("WEEKEND_BALANCE", sum(fairness)),
             ("REST_DISTRIBUTION", sum(concentration)), ("REST_ROTATION", sum(rotation)),
             ("PEOPLE_CHANGED", sum(people_changed)), ("STABILITY", sum(stability_terms)),
             ("PREFERENCES", sum(preference_terms)), ("TIE_BREAK", sum(tie_terms))]
    goals = [(name, objective) for name, objective in goals if not isinstance(objective, int)]
    # Establish a legal incumbent before spending the bounded budget on soft goals.
    # This seed does not lock a staffing objective or relax a mandatory condition.
    values, proven, phases = improve(model, [objective for _, objective in goals], values,
                                     started + MAX_SECONDS, [name for name, _ in goals])
    # Existing protected learner records are retained, never allocated or counted as workforce.
    result = _read_assignments(Snapshot(values), employees, active, baseline, work, choices) + retained_learner_records(data)
    response = _response("OPTIMAL" if proven else "FEASIBLE", result, started)
    response['optimization'] = {'budgetSeconds': MAX_SECONDS, 'phases': phases}
    return response


def _read_assignments(solver, employees, active, baseline, work, choices):
    result = []
    for person in employees:
        for day in active[person["id"]]:
            key = person["id"], day
            old = baseline.get(key, {})
            item = {"employeeId": key[0], "date": day, "kind": "OFF"}
            if old.get("kind") == "ABSENCE":
                item["kind"] = "ABSENCE"
            elif has_no_clock(person) and solver.value(work[key]):
                item["kind"] = "DUTY"
            else:
                for sid, variable in choices[key].items():
                    if solver.value(variable):
                        item.update(kind="WORK", shiftId=sid)
                        break
            if old.get("locked"):
                item["locked"] = True
            result.append(item)
    return result


def _feasibility_hints(model, employees, dates, off, work, choices, active, baseline, metrics, policy):
    """A balanced complete candidate when available, never a mandatory constraint."""
    proposals = balanced_rest_hints(employees, dates, active, baseline, choices, metrics, policy, instant, sunday_limit)
    for person in employees:
        pid = person["id"]
        for day, entry in proposals.get(pid, {}).items():
            key = pid, day
            is_work = entry["kind"] in ("WORK", "DUTY")
            model.add_hint(off[key], int(entry["kind"] == "OFF"))
            model.add_hint(work[key], int(is_work))
            for sid, variable in choices[key].items():
                model.add_hint(variable, int(is_work and sid == entry.get("shiftId")))


def _streaks(model, person, dates, work, off, prior, active, policy):
    pid = person["id"]
    first = (date.fromisoformat(dates[0]) - timedelta(days=21)).isoformat()
    timeline = days_between(first, max([dates[-1], *prior]))
    maximum = min(5, policy["maxConsecutiveWorkDays"])
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


def _historical_weekdays(prior, shifts, start, weekday):
    first = (date.fromisoformat(start) - timedelta(days=21)).isoformat()
    occupied = set()
    known = {day for day, entry in prior.items() if first <= day < start
             and date.fromisoformat(day).weekday() == weekday and entry["kind"] in ("WORK", "DUTY", "OFF")}
    for day, entry in prior.items():
        if entry["kind"] not in ("WORK", "DUTY"):
            continue
        civil_days = {day} if entry["kind"] == "DUTY" else occupied_dates(day, shifts[entry["shiftId"]])
        occupied.update(civil for civil in civil_days if first <= civil < start and date.fromisoformat(civil).weekday() == weekday)
    return len(occupied), len(known | occupied)


def _rest_distribution(model, employees, dates, off, active, baseline, history, policy, values=None):
    """Soft daily presence and rotation goals; never invent a staffing minimum."""
    sectors, concentration, rotation = {}, [], []
    leadership = []
    for person in employees:
        sectors.setdefault(("sector", person["sector"]), []).append(person["id"])
        # Job labels guide soft operational balance, never legal classification or qualifications.
        role = person["role"].strip().upper()
        if role:
            sectors.setdefault(("role", person["sector"], role), []).append(person["id"])
        if role.startswith("ENC.") or "ENCARREGAD" in role or "GERENTE" in role:
            leadership.append(person["id"])
    if len(leadership) > 1:
        sectors[("leadership",)] = leadership
    # A homogeneous sector and its only role are the same group, not twice the weight.
    unique_groups = {tuple(sorted(members)): members for members in sectors.values()}
    for sector_index, members in enumerate(unique_groups.values()):
        if len(members) < 2:
            continue
        for day in dates:
            if day in policy["closedDates"]:
                continue
            eligible = [pid for pid in members if (pid, day) in off
                        and baseline.get((pid, day), {}).get("kind") != "ABSENCE"]
            if len(eligible) < 2:
                continue
            # Two rests per seven opportunities. Absolute deviation reduces sector
            # pile-ups without treating an estimate as a mandatory operating level.
            deviation = model.new_int_var(0, len(eligible) * 7, f"sector-rest:{sector_index}:{day}")
            model.add_abs_equality(deviation, 7 * sum(off[pid, day] for pid in eligible) - 2 * len(eligible))
            concentration.append(deviation)
            if values is not None:
                remember(model, values, deviation, abs(7 * sum(values[off[pid, day].index] for pid in eligible) - 2 * len(eligible)))
    first = (date.fromisoformat(dates[0]) - timedelta(days=21)).isoformat()
    for person in employees:
        pid = person["id"]
        for weekday in range(7):
            available = [day for day in active[pid] if date.fromisoformat(day).weekday() == weekday
                         and baseline.get((pid, day), {}).get("kind") != "ABSENCE"]
            known = [entry for day, entry in history[pid].items() if first <= day < dates[0]
                     and date.fromisoformat(day).weekday() == weekday and entry["kind"] in ("WORK", "DUTY", "OFF")]
            opportunities = len(available) + len(known)
            if not opportunities:
                continue
            rests = sum(off[pid, day] for day in available) + sum(entry["kind"] == "OFF" for entry in known)
            deviation = model.new_int_var(0, 7 * opportunities, f"weekday-rest:{pid}:{weekday}")
            model.add_abs_equality(deviation, 7 * rests - 2 * opportunities)
            rotation.append(deviation)
            if values is not None:
                rests_value = sum(values[off[pid, day].index] for day in available) + sum(entry["kind"] == "OFF" for entry in known)
                remember(model, values, deviation, abs(7 * rests_value - 2 * opportunities))
    return concentration, rotation


def _rest(model, person, dates, choices, off, prior, shifts, metrics, policy):
    if has_no_clock(person):
        return  # No timestamps exist to establish an hourly rest interval.
    pid = person["id"]
    events = {}
    first_relevant = (date.fromisoformat(dates[0]) - timedelta(days=5)).isoformat()
    for day, entry in prior.items():
        if entry["kind"] == "WORK" and day >= first_relevant:
            events.setdefault(day, []).append((entry["shiftId"], 1))
    for (employee, day), options in choices.items():
        if employee == pid and options:
            events.setdefault(day, []).extend(options.items())
    origin, daily = instant(dates[0], 0), []
    for day, options in sorted(events.items()):
        starts = [int(instant(day, metrics[sid][1]) - origin) for sid, _ in options]
        finishes = [int(instant(day, metrics[sid][2]) - origin) for sid, _ in options]
        variables = [variable for _, variable in options]
        if len(options) == 1 and isinstance(variables[0], int) and variables[0] == 1:
            daily.append((day, date.fromisoformat(day).toordinal(), starts[0], finishes[0], 1, starts[0], finishes[0]))
            continue
        present = model.new_bool_var(f'rest-present:{pid}:{day}')
        model.add_max_equality(present, variables)
        low, high = min(starts) - 1, max(finishes) + 1
        begin = model.new_int_var(min(starts), high, f'rest-start:{pid}:{day}')
        finish = model.new_int_var(low, max(finishes), f'rest-end:{pid}:{day}')
        model.add_min_equality(begin, [start + (1 - variable) * (high - start)
                                       for start, variable in zip(starts, variables)])
        model.add_max_equality(finish, [end - (1 - variable) * (end - low)
                                       for end, variable in zip(finishes, variables)])
        daily.append((day, date.fromisoformat(day).toordinal(), begin, finish, present, min(starts), max(finishes)))
    for index, (day, ordinal, _begin, finish, present, _earliest, latest) in enumerate(daily):
        for next_day, next_ordinal, begin, _finish, next_present, earliest, _latest in daily[index + 1:]:
            delta = next_ordinal - ordinal
            if delta > 5:
                break
            if not (dates[0] <= day <= dates[-1] or dates[0] <= next_day <= dates[-1]):
                continue
            conditions = [v for v in (present, next_present) if not isinstance(v, int)]
            if earliest - latest < policy['minInterShiftMinutes']:
                model.add(begin - finish >= policy['minInterShiftMinutes']).only_enforce_if(conditions)
            if delta > 1 and earliest - latest < policy['minWeeklyRestMinutes']:
                for middle in days_between(day, next_day)[1:-1]:
                    resting = off.get((pid, middle), int(prior.get(middle, {}).get('kind') == 'OFF'))
                    if isinstance(resting, int) and not resting:
                        continue
                    enforcement = conditions + ([] if isinstance(resting, int) else [resting])
                    model.add(begin - finish >= policy['minWeeklyRestMinutes']).only_enforce_if(enforcement)


def _civil_rest(model, person, dates, choices, work, off, prior, shifts):
    pid = person["id"]
    weekend_terms = {}
    for (employee, day), options in choices.items():
        if employee != pid:
            continue
        if has_no_clock(person) and date.fromisoformat(day).weekday() in (5, 6):
            weekend_terms.setdefault(day, []).append(work[pid, day])
        for sid, variable in options.items():
            for occupied in occupied_dates(day, shifts[sid]):
                if occupied != day and (pid, occupied) in off:
                    model.add(variable + off[pid, occupied] <= 1)
                if occupied != day and prior.get(occupied, {}).get("kind") in ("OFF", "ABSENCE"):
                    model.add(variable == 0)
                if date.fromisoformat(occupied).weekday() in (5, 6):
                    weekend_terms.setdefault(occupied, []).append(variable)
    for day, assignment in prior.items():
        if assignment["kind"] not in ("WORK", "DUTY"):
            continue
        occupied_days = {day} if assignment["kind"] == "DUTY" else occupied_dates(day, shifts[assignment["shiftId"]])
        for occupied in occupied_days:
            if (pid, occupied) in off:
                model.add(off[pid, occupied] == 0)
            if date.fromisoformat(occupied).weekday() in (5, 6):
                weekend_terms.setdefault(occupied, []).append(1)
    first = (date.fromisoformat(dates[0]) - timedelta(days=21)).isoformat()
    timeline = days_between(first, max([dates[-1], *prior]))
    sundays = [d for d in timeline if date.fromisoformat(d).weekday() == 6]
    occupied_weekends = {}
    for day in timeline:
        if date.fromisoformat(day).weekday() not in (5, 6):
            continue
        present = model.new_bool_var(f"weekend-occupied:{pid}:{day}")
        terms = weekend_terms.get(day, [])
        if terms:
            model.add_max_equality(present, terms)
        else:
            model.add(present == 0)
        occupied_weekends[day] = present
    cap = sunday_limit(person)
    for end in range(cap, len(sundays)):
        group = sundays[end - cap:end + 1]
        if any(dates[0] <= day <= dates[-1] for day in group):
            model.add(sum(occupied_weekends[d] for d in group) <= cap)
    return occupied_weekends


def _coverage(model, data, employees, choices, shifts, started, scope="ALL", values=None):
    relevant = [d for d in data['demands'] if d['minimum'] > 0
                and not (scope == 'HARD' and d.get('estimated') is True)
                and not (scope == 'ESTIMATED' and d.get('estimated') is not True)]
    if not relevant:
        return []
    by_id = {p["id"]: p for p in employees}
    index = {}
    shortages, grouped = [], {}

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
        if has_no_clock(person):
            continue
        for assignment in {a["date"]: a for a in person.get("planningHistory", []) + person["history"]}.values():
            if assignment["kind"] == "WORK" and assignment["date"] >= (date.fromisoformat(data["startDate"]) - timedelta(days=1)).isoformat():
                register(person["id"], assignment["date"], assignment["shiftId"], 1)
    for demand_index, demand in enumerate(relevant):
        estimated = demand.get("estimated") is True
        if (scope == "HARD" and estimated) or (scope == "ESTIMATED" and not estimated):
            continue
        if demand["minimum"] == 0:
            continue  # A zero floor adds no constraint or shortage; keep it only in the reported estimates.
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
        estimated = demand.get("estimated") is True
        for interval_index, (left, right) in enumerate(zip(ordered, ordered[1:])):
            available = [v for start, end, v in intervals if start <= left and end >= right]
            if estimated:
                if demand["minimum"] > 0:
                    fixed = sum(v for v in available if isinstance(v, int))
                    variables = [v for v in available if not isinstance(v, int)]
                    minimum = max(0, demand['minimum'] - fixed)
                    if not minimum:
                        continue
                    # Repeated role/sector intervals with identical presence share one shortage.
                    # Their durations are added, so the person-minute objective is unchanged.
                    key = (minimum, tuple(sorted(v.index for v in variables)))
                    if key not in grouped:
                        grouped[key] = [variables, 0]
                    grouped[key][1] += int(right - left)
                continue
            if not available and demand["minimum"] > 0:
                minute = int(left - instant(demand["date"], 0))
                return (f"Cobertura sem horário disponível em {demand['date']} às {minute // 60:02d}:{minute % 60:02d}. "
                        "Confira os turnos permitidos, intervalos de refeição, setor e cargo da faixa antes de alterar o efetivo.")
            model.add(cp_model.LinearExpr.sum(available) >= demand["minimum"])
    for index, ((minimum, _), (variables, weight)) in enumerate(grouped.items()):
        shortage = model.new_int_var(0, minimum, f'coverage-gap:{index}')
        model.add(cp_model.LinearExpr.sum(variables) + shortage >= minimum)
        shortages.append(weight * shortage)
        if values is not None:
            present = sum(values[v.index] for v in variables)
            remember(model, values, shortage, max(0, minimum - present))
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
