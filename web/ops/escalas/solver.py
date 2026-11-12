"""Bounded production scheduling with separate Sunday rotation and preserved hard rules."""
import hashlib
import time
from functools import lru_cache
from datetime import date, datetime, time as civil_time, timedelta
from zoneinfo import ZoneInfo

from ortools.sat.python import cp_model

from diagnostics import ConflictRegistry
from hints import balanced_rest_hints, holiday_rest_forbidden, paid_holiday_dates
from leadership import leadership_objective, leadership_summary
from optimization import ImprovementContext, Snapshot, improve, remember
from policy_reference import CCT_FROM, CCT_PROFILE, CCT_UNTIL, REFERENCE, TRANSITION_40_DATE, TRANSITION_42_DATE
from runtime_settings import MAX_SECONDS, RANDOM_SEED
from weekend_balance import available_weekends, preserve_sunday_presence, weekend_objectives

ZONE = ZoneInfo("America/Sao_Paulo")


def days_between(start, end):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    return [(first + timedelta(days=n)).isoformat()
            for n in range((last - first).days + 1)]

def _coverage_month(data):
    """Match TS visibleDates for legacy monthly horizons without rewriting data."""
    if data.get('visibleMonth'):
        return data['visibleMonth']
    if not data.get('startDate') or not data.get('endDate'):
        return None
    first, last = date.fromisoformat(data['startDate']), date.fromisoformat(data['endDate'])
    if last < first:
        return None
    middle = first + timedelta(days=((last - first).days + 1) // 2)
    month_start = middle.replace(day=1)
    next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    month_end = next_month - timedelta(days=1)
    technical_start = month_start - timedelta(days=month_start.weekday())
    technical_end = month_end + timedelta(days=6 - month_end.weekday())
    if (first, last) == (technical_start, technical_end):
        return month_start.strftime('%Y-%m')
    return None



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
    stage = "second" if day >= TRANSITION_40_DATE else "first" if day >= TRANSITION_42_DATE else "before"
    return REFERENCE["weeklyHours"][stage]


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
    # Documentary references do not block drafts or internal publication.
    # Explicit operational limits remain enforced by admissible().
    return True


def maximum_meal_minutes(policy, day):
    document = policy.get('mealIntervalAgreement')
    maximum = document.get('maximumMinutes') if isinstance(document, dict) else None
    minimum = REFERENCE["mealMinutes"]["standardMaximum"]
    ceiling = REFERENCE["mealMinutes"]["extendedMaximum"]
    return maximum if type(maximum) is int and minimum < maximum <= ceiling else minimum


def _is_mixed_42_long_shift(shift):
    segments = shift["segments"]
    if len(segments) != 3:
        return False
    first, meal, second = segments
    return (first["kind"] == second["kind"] == "WORK" and meal["kind"] == "BREAK"
            and first["end"] - first["start"] == second["end"] - second["start"] == 270
            and meal["end"] - meal["start"] == 180
            and first["end"] == meal["start"] and meal["end"] == second["start"])


def admissible(shift, policy, day, mixed_42=False):
    paid, _start, _end = shift_metrics(shift)
    stage = "second" if day >= TRANSITION_40_DATE else "first" if day >= TRANSITION_42_DATE else "before"
    ceiling = REFERENCE["dailyMinutes"][stage]
    # Only the exact, explicitly selected mixed turn gets this exception.
    long_turn = False
    if mixed_42 and day < TRANSITION_40_DATE:
        long_turn = paid == 540 and _is_mixed_42_long_shift(shift)
        if paid != 480 and not long_turn:
            return False
    if not long_turn and paid > min(policy["dailyLimitMinutes"], ceiling):
        return False
    if paid > 480 and not policy["compensationAuthorized"] and not policy.get("_simulation"):
        return False
    if not cct_admissible(shift, policy, day):
        return False
    first, last = shift["segments"][0]["start"], shift["segments"][-1]["end"]
    meals = [s["end"] - s["start"] for s in shift["segments"]
             if s["kind"] == "BREAK" and s["start"] > first and s["end"] < last]
    if paid > 360 and max(meals, default=0) > maximum_meal_minutes(policy, day) and not policy.get('_simulation') and not long_turn:
        return False
    short_pause_flex = policy.get("_simulation") and policy.get("allowShortMealSimulation") is True
    required = policy["minMealMinutes"] if paid > 360 else (15 if paid > 240 and not short_pause_flex else 0)
    return required == 0 or max(meals, default=0) >= required


def untimed_admissible(policy, day):
    # Presence-only planning does not certify documentary approval.
    return True


def has_no_clock(person):
    # Missing imported clocks do not establish exemption from working-time control.
    return person.get("scheduleMode") in ("UNTIMED", "MISSING")


def retained_disabled_records(data):
    retained = {p['id'] for p in data['employees'] if p.get('planningEnabled') is False}
    return [dict(a) for a in data['assignments'] if a['employeeId'] in retained and (a.get('locked') or a['kind'] == 'ABSENCE')]


def solve(data, control=None):
    started = time.monotonic()
    if control is not None:
        control.checkpoint()
    dates = days_between(data["startDate"], data["endDate"])
    employees = sorted((p for p in data["employees"] if p.get("planningEnabled") is not False), key=lambda e: e["id"])
    if not 1 <= len(employees) <= 250 or not 7 <= len(dates) <= 42 or len(dates) % 7:
        raise ValueError("model bounds")
    policy = {**data["policy"], "_simulation": data.get("simulation") is True}
    mixed_sectors = set(data.get("mixed42Sectors", [])) if data["defaultWeeklyHours"] == 42 else set()
    mixed_people = set()
    shifts = {s["id"]: s for s in data["shifts"]}
    metrics = {key: shift_metrics(value) for key, value in shifts.items()}
    baseline = {(a["employeeId"], a["date"]): a for a in data["assignments"]}
    closed_dates = set(policy["closedDates"])
    paid_holidays = paid_holiday_dates(policy)

    @lru_cache(maxsize=None)
    def shift_calendar(sid, day, mixed_42=False):
        # Shift legality and calendar closures are shared within a profile.
        # Keep the cache per solve; absence and locked choices stay person-specific.
        shift = shifts[sid]
        if not admissible(shift, policy, day, mixed_42):
            return None
        occupied = occupied_dates(day, shift)
        return occupied, not closed_dates.isdisjoint(occupied)

    model = cp_model.CpModel()
    conflicts = ConflictRegistry()
    work, off, choices, history, active = {}, {}, {}, {}, {}
    preference_terms, stability_terms, people_changed, tie_terms = [], [], [], []
    weekend_totals = {5: {}, 6: {}}
    for person in employees:
        if control is not None:
            control.checkpoint()
        if time.monotonic() - started > MAX_SECONDS - 1:
            return _response("UNKNOWN", [], started)
        pid = person["id"]
        untimed = has_no_clock(person)
        mixed_days = set()
        if (not untimed and person["sector"] in mixed_sectors and person["weeklyHours"] == 42
                and person.get("simulationDailyMinutes") is None):
            mixed_days = {day for week in range(0, len(dates), 7)
                          if effective_weekly_hours(person, dates[week + 6]) == 42
                          for day in dates[week:week + 7]}
        if mixed_days:
            mixed_people.add(pid)
        prior = {a["date"]: a for a in person.get("planningHistory", []) + person["history"]}
        history[pid] = prior
        future_limit = (date.fromisoformat(dates[-1]) + timedelta(days=21)).isoformat()
        future = {a["date"]: a for a in person.get("planningFuture", [])
                  if dates[-1] < a["date"] <= future_limit}
        # Published neighboring assignments constrain the boundary, not fairness history.
        boundary = {**prior, **future}
        changed = []
        reference_shifts = person["shiftIds"]
        fixed_import = person.get("fixedImportedShiftId")
        if fixed_import in reference_shifts:
            reference_shifts = [fixed_import]
        elif data.get("generationMode") == "REST_ONLY":
            durations = set()
            reference_shifts = []
            for sid in person["shiftIds"]:
                duration = metrics[sid][0]
                if duration not in durations:
                    reference_shifts.append(sid)
                    durations.add(duration)
        active[pid] = [d for d in dates if person["activeFrom"] <= d
                       and (not person.get("activeUntil") or d <= person["activeUntil"])]
        for day in active[pid]:
            if control is not None:
                control.checkpoint()
            key, old = (pid, day), baseline.get((pid, day))
            absent = old is not None and old["kind"] == "ABSENCE"
            holiday = day in paid_holidays and not absent
            off[key] = model.new_bool_var(f"o:{pid}:{day}")
            work[key] = model.new_bool_var(f"w:{pid}:{day}")
            current = {}
            closed = day in closed_dates
            allowed = reference_shifts
            if (old and old.get("locked") and old["kind"] == "WORK"
                    and old.get("shiftId") in person["shiftIds"] and old["shiftId"] not in allowed):
                # A locked extra is specific to this day, not a new free-day reference.
                allowed = [*allowed, old["shiftId"]]
            for sid in ([] if untimed else allowed):
                calendar = shift_calendar(sid, day, day in mixed_days)
                if calendar is None:
                    continue
                occupied, overlaps_closure = calendar
                current[sid] = model.new_bool_var(f"s:{pid}:{day}:{sid}")
                if closed or overlaps_closure or any(baseline.get((pid, d), {}).get("kind") == "ABSENCE" for d in occupied):
                    conflicts.track(model.add(current[sid] == 0), "AVAILABILITY")
            choices[key] = current
            if untimed:
                if closed or not untimed_admissible(policy, day):
                    conflicts.track(model.add(work[key] == 0), "AVAILABILITY")
            else:
                conflicts.track(model.add(work[key] == sum(current.values())), "AVAILABILITY")
            conflicts.track(model.add(work[key] + off[key] == (0 if absent or holiday else 1)), "AVAILABILITY")
            weekday = date.fromisoformat(day).weekday()
            if weekday in person["fixedOffDays"] and not absent and not holiday:
                conflicts.track(model.add(off[key] == 1), "BLOCKS")
            if holiday_rest_forbidden(policy, day):
                conflicts.track(model.add(off[key] == 0), "AVAILABILITY")
            if old and old.get("locked") and not absent:
                lock_start = len(model.proto.constraints)
                if old["kind"] == "HOLIDAY" and holiday:
                    pass
                elif old["kind"] == "OFF":
                    model.add(off[key] == 1)
                elif old["kind"] == "DUTY" and untimed:
                    model.add(work[key] == 1)
                elif old.get("shiftId") in current:
                    model.add(current[old["shiftId"]] == 1)
                else:
                    model.add(work[key] == 2)  # explicitly infeasible, never replace a locked shift
                conflicts.track_range(model, lock_start, "BLOCKS")
            if old and not absent:
                same = (int(holiday) if old["kind"] == "HOLIDAY" else off[key] if old["kind"] == "OFF" else work[key]
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
            closed_weekdays = sum(d in paid_holidays and date.fromisoformat(d).weekday() != 6 for d in group)
            closed_sundays = sum(d in paid_holidays and date.fromisoformat(d).weekday() == 6 for d in group)
            if len(group) == 7 and not absences:
                conflicts.track(model.add(sum(work[pid, d] for d in group) == max(0, 5 - closed_weekdays)), "DAYS_WORKED")
                conflicts.track(model.add(sum(off[pid, d] for d in group) == max(0, 2 - closed_sundays)), "DAYS_WORKED")
                if not untimed and not closed_weekdays:
                    conflicts.track(model.add(sum(metrics[s][0] * v for d in group for s, v in choices[pid, d].items())
                                    == effective_weekly_minutes(person, dates[week + 6], policy["_simulation"])), "WEEKLY_MINUTES")
            else:
                conflicts.track(model.add(sum(work[pid, d] for d in group) <= 5), "DAYS_WORKED")
            if absences or closed_weekdays:
                if dates[week] in mixed_days:
                    model.add(sum(v for d in group for s, v in choices[pid, d].items()
                                  if metrics[s][0] == 540) <= 2)
            if not untimed:
                conflicts.track(model.add(sum(metrics[s][0] * v for d in group for s, v in choices[pid, d].items())
                                <= min(effective_weekly_minutes(person, dates[week + 6], policy["_simulation"]), policy["weeklyLimit"] * 60)), "WEEKLY_MINUTES")
        rest_start = len(model.proto.constraints)
        _streaks(model, person, dates, work, off, boundary, active[pid], policy)
        _rest(model, person, dates, active[pid], choices, off, boundary, metrics, policy)
        civil_weekends = _civil_rest(model, person, dates, active[pid], choices, work, off, boundary, shifts,
                                     lambda sid, day: shift_calendar(sid, day, day in mixed_days))
        conflicts.track_range(model, rest_start, "REST")
        for day in active[pid]:
            if control is not None:
                control.checkpoint()
            if person["offPattern"] == "CONSECUTIVE":
                neighbors = []
                for delta in (-1, 1):
                    adjacent = (date.fromisoformat(day) + timedelta(days=delta)).isoformat()
                    fixed_boundary = (day == dates[-1] and delta == 1 and date.fromisoformat(day).weekday() == 6
                                      and person["offMode"] in ("FIXED", "MIXED")
                                      and 0 in person["fixedOffDays"]
                                      and adjacent not in boundary
                                      and adjacent not in paid_holidays
                                      and (not person.get("activeUntil") or adjacent <= person["activeUntil"])
                                      and not holiday_rest_forbidden(policy, adjacent))
                    sunday_holiday = (date.fromisoformat(adjacent).weekday() == 6
                                      and (adjacent in paid_holidays or boundary.get(adjacent, {}).get("kind") == "HOLIDAY"))
                    neighbors.append(1 if sunday_holiday and baseline.get((pid, adjacent), {}).get("kind") != "ABSENCE" else off.get((pid, adjacent), int(boundary.get(adjacent, {}).get("kind") == "OFF" or fixed_boundary)))
                regular_rest = 1 if day in paid_holidays and date.fromisoformat(day).weekday() == 6 and baseline.get((pid, day), {}).get("kind") != "ABSENCE" else off[pid, day]
                model.add(regular_rest <= sum(neighbors))
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
                if control is not None:
                    control.checkpoint()
                tomorrow = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
                if (pid, tomorrow) in off:
                    pair = model.new_bool_var(f"pair:{pid}:{day}")
                    model.add_min_equality(pair, [off[pid, day], off[pid, tomorrow]])
                    preference_terms.append(-pair)
        for weekday in (5, 6):
            weekends = [d for d in active[pid] if date.fromisoformat(d).weekday() == weekday]
            historical, known = _historical_weekdays(prior, shifts, dates[0], weekday)
            available = available_weekends(person, weekends, baseline, policy)
            # Explicit unavailable dates are not opportunities or a rotation debt.
            opportunities = len(available) + known if available else 0
            weekend_totals[weekday][pid] = (sum(civil_weekends[d] for d in available) + historical, opportunities)
    coverage_start = len(model.proto.constraints)
    hard_coverage = _coverage(model, data, employees, choices, shifts, started, "HARD")
    conflicts.track_range(model, coverage_start, "COVERAGE")
    construction_finished = time.monotonic()
    if hard_coverage is False:
        return _response("UNKNOWN", [], started)
    if isinstance(hard_coverage, str):
        response = _response("INFEASIBLE", [], started, hard_coverage)
        response["solverDiagnostics"] = [{"family": "COVERAGE", "message": hard_coverage}]
        return response
    # Find a mandatory-feasible incumbent before adding thousands of optional staffing goals.
    # Optional optimization must never consume the only opportunity to return a complete draft.
    if MAX_SECONDS - (time.monotonic() - started) < 0.1:
        return _response("UNKNOWN", [], started)
    baseline_hints = _feasibility_hints(model, employees, dates, off, work, choices, active, baseline, metrics, policy,
                       deadline=min(started + MAX_SECONDS - 2, time.monotonic() + 2), control=control,
                       mixed_people=mixed_people,
                       estimated_demands=data["demands"],
                       initial_assignments=data.get('_initialAssignments'))
    remaining = MAX_SECONDS - (time.monotonic() - started)
    if remaining < 0.1:
        return _response("UNKNOWN", [], started)
    seed_variables = [model.get_int_var_from_proto_index(index) for index in range(len(model.proto.variables))]
    seed = cp_model.CpSolver()
    seed.parameters.max_time_in_seconds = min(2, remaining)
    seed.parameters.stop_after_first_solution = True
    seed.parameters.num_workers = 1
    seed.parameters.random_seed = RANDOM_SEED
    # Validate the proposed warm start before symmetry reduction can discard it.
    # Fixing is confined to this solver invocation; the model remains unrestricted.
    # A rejected proposal is not evidence that the actual scheduling model is infeasible.
    seed.parameters.fix_variables_to_their_hinted_value = _seed_hint_state(model, off, work, choices) == "COMPLETE"
    seed_status = seed.solve(model) if control is None else control.solve(seed, model)
    if seed_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE) and data.get('_initialAssignments') is not None:
        # A preferred seed is not a saved baseline or evidence of infeasibility.
        # Retry the original comparison roster before an unrestricted repair.
        remaining = MAX_SECONDS - (time.monotonic() - started)
        if remaining < 0.1:
            return _response('UNKNOWN', [], started)
        model.clear_hints()
        baseline_hints = _feasibility_hints(
            model, employees, dates, off, work, choices, active, baseline, metrics, policy,
            deadline=min(started + MAX_SECONDS - 2, time.monotonic() + 2),
            control=control, mixed_people=mixed_people, estimated_demands=data["demands"])
        remaining = MAX_SECONDS - (time.monotonic() - started)
        if remaining < 0.1:
            return _response('UNKNOWN', [], started)
        seed.parameters.max_time_in_seconds = min(2, remaining)
        seed.parameters.fix_variables_to_their_hinted_value = _seed_hint_state(model, off, work, choices) == "COMPLETE"
        seed_status = seed.solve(model) if control is None else control.solve(seed, model)
    if seed_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        remaining = MAX_SECONDS - (time.monotonic() - started)
        if remaining < 0.1:
            return _response("UNKNOWN", [], started)
        if baseline_hints:
            model.clear_hints()
            _feasibility_hints(model, employees, dates, off, work, choices, active, baseline, metrics, policy,
                               deadline=min(started + MAX_SECONDS - 2, time.monotonic() + 2), control=control,
                               prefer_baseline=False, mixed_people=mixed_people, estimated_demands=data["demands"])
            # Symmetry reduction can discard a complete balanced hint. Verify it
            # as a fixed candidate before allowing an unrestricted replacement.
            remaining = MAX_SECONDS - (time.monotonic() - started)
            if remaining < 0.1:
                return _response("UNKNOWN", [], started)
            if _seed_hint_state(model, off, work, choices) == "COMPLETE":
                seed.parameters.fix_variables_to_their_hinted_value = True
                seed.parameters.max_time_in_seconds = min(2, remaining)
                seed_status = seed.solve(model) if control is None else control.solve(seed, model)
        if seed_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            remaining = MAX_SECONDS - (time.monotonic() - started)
            if remaining < 0.1:
                return _response("UNKNOWN", [], started)
            seed.parameters.fix_variables_to_their_hinted_value = False
            seed.parameters.max_time_in_seconds = min(6, remaining)
            seed_status = seed.solve(model) if control is None else control.solve(seed, model)
        if seed_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            response = _response(seed.status_name(seed_status), [], started)
            if seed_status == cp_model.INFEASIBLE:
                response["solverDiagnostics"] = conflicts.diagnose(model, started + MAX_SECONDS, control)
                response["wallTimeSeconds"] = round(time.monotonic() - started, 3)
            return response
    result = _read_assignments(seed, employees, active, baseline, work, choices, paid_holidays) + retained_disabled_records(data)
    values = {variable.index: seed.value(variable) for variable in seed_variables}
    feasibility_finished = time.monotonic()
    model.clear_hints()
    for variable in seed_variables:
        model.add_hint(variable, seed.value(variable))
    _preserve_daily_timed_presence(model, employees, dates, choices, shifts,
                                   data["demands"], values, control)
    sunday_coverage = {}
    sector_coverage = {}
    visible_sunday_coverage = {}
    visible_sector_coverage = {}
    closing_coverage = {}
    coverage = _coverage(model, data, employees, choices, shifts, started, "ESTIMATED", values, sunday_coverage, sector_coverage,
                         visible_sunday_coverage, visible_sector_coverage, closing_coverage)
    if coverage is False:
        return _response("FEASIBLE", result, started)
    if isinstance(coverage, str):
        return _response("FEASIBLE", result, started)
    groups = {}
    preserve_sunday_presence(model, employees, dates, work, values, control)
    for person in employees:
        if control is not None:
            control.checkpoint()
        # Comparable opportunities only; absence/new-hire histories are not a debt.
        key = (has_no_clock(person), person["sector"], sunday_limit(person),
               () if has_no_clock(person) else
               tuple(effective_weekly_hours(person, dates[index + 6]) for index in range(0, len(dates), 7)))
        groups.setdefault(key, []).append(person["id"])
    sundays, saturdays = weekend_objectives(model, groups, weekend_totals,
                                            Snapshot(values), values, control)
    # Unconfirmed staffing estimates are planning goals, never approved minima.
    # Prioritize their person-minute shortages before rotation and preferences.
    concentration, rotation = _rest_distribution(model, employees, dates, off, active, baseline, history, policy, values)
    sunday_objective = sum(term for terms in sunday_coverage.values() for term in terms)
    closing_objective = sum(term for terms in closing_coverage.values() for term in terms)
    leader_terms, leader_checks = leadership_objective(model, data, employees, dates, work, values)
    goals = [("COVERAGE", sum(coverage)), ("SUNDAY_COVERAGE", sunday_objective),
             ("CLOSING_COVERAGE", closing_objective), ("SUNDAY_BALANCE", sum(sundays)),
             ("LEADERSHIP", sum(leader_terms)),
             ("SATURDAY_BALANCE", sum(saturdays)),
             ("REST_DISTRIBUTION", sum(concentration)), ("REST_ROTATION", sum(rotation)),
             ("PEOPLE_CHANGED", sum(people_changed)), ("STABILITY", sum(stability_terms)),
             ("PREFERENCES", sum(preference_terms)), ("TIE_BREAK", sum(tie_terms))]
    goals = [(name, objective) for name, objective in goals if not isinstance(objective, int)]
    # Establish a legal incumbent before spending the bounded budget on soft goals.
    # This seed does not lock a staffing objective or relax a mandatory condition.
    # Explicit metadata avoids parsing employee/shift IDs, which may contain colons.
    decisions = {variable.index: key for key, variable in off.items()}
    warm_decisions = {}
    repair_groups = _rest_repair_groups(employees, dates, work, baseline, values, policy,
                                       data["demands"], data.get("visibleMonth"),
                                       sector_coverage, sunday_coverage)
    repair_people = set().union(*repair_groups) if repair_groups else set()
    # A synchronized baseline stays the comparison incumbent. Supply a
    # staggered alternative only as a nonbinding CP-SAT hint, within this budget.
    if (repair_people or mixed_people) and started + MAX_SECONDS - time.monotonic() > 0.8:
        proposals = balanced_rest_hints(
            [person for person in employees
             if (person["id"] in repair_people if repair_people
                 else person["sector"] in mixed_sectors)],
            dates, active, baseline, choices, metrics, policy, instant, sunday_limit,
            deadline=min(started + MAX_SECONDS - 0.2, time.monotonic() + 0.6),
            control=control, mixed_people=mixed_people)
        for pid, entries in proposals.items():
            for day, entry in entries.items():
                key = pid, day
                warm_decisions[off[key].index] = int(entry["kind"] == "OFF")
                warm_decisions[work[key].index] = int(entry["kind"] in ("WORK", "DUTY"))
                for sid, variable in choices[key].items():
                    warm_decisions[variable.index] = int(
                        entry["kind"] == "WORK" and sid == entry.get("shiftId"))
    decisions.update({variable.index: key for key, variable in work.items()})
    decisions.update({variable.index: key for key, options in choices.items()
                      for variable in options.values()})
    values, proven, phases = improve(model, [objective for _, objective in goals], values,
                                     started + MAX_SECONDS, [name for name, _ in goals], context=ImprovementContext(control=control,
                                     protected_groups={goals[0][0]: sundays + [sum(terms) for terms in sunday_coverage.values()]
                                                       + [sum(terms) for terms in sector_coverage.values()]
                                                       + [sum(terms) for terms in visible_sunday_coverage.values()]
                                                       + [sum(terms) for terms in visible_sector_coverage.values()]
                                                       + [sum(terms) for terms in closing_coverage.values()]} if goals else {},
                                     employee_groups=list(groups.values()),
                                     coverage_groups={sector: [p['id'] for p in employees if p['sector'] == sector]
                                                      for sector in sector_coverage}, sunday_coverage=sunday_coverage,
                                     sector_coverage=sector_coverage,
                                     closing_coverage=closing_coverage,
                                     decision_variables=decisions,
                                     initial_decision_hints=warm_decisions,
                                     initial_repair_groups=repair_groups,
                                     repair_clock_fixes=_repair_clock_fixes(choices, metrics, values)))
    # Existing protected disabled records are retained, never allocated or counted as workforce.
    result = _read_assignments(Snapshot(values), employees, active, baseline, work, choices, paid_holidays) + retained_disabled_records(data)
    response = _response("OPTIMAL" if proven else "FEASIBLE", result, started)
    attempted = {phase['objective'] for phase in phases}
    attempted.update(member['objective'] for phase in phases for member in phase.get('members', []))
    response['optimization'] = {'budgetSeconds': MAX_SECONDS, 'phases': phases,
                                'unattemptedObjectives': [name for name, _ in goals if name not in attempted],
                                'constructionSeconds': round(construction_finished - started, 3),
                                'feasibilitySeconds': round(feasibility_finished - construction_finished, 3),
                                'refinementSeconds': round(time.monotonic() - feasibility_finished, 3),
                                'stopReason': 'OBJECTIVES_PROVEN' if proven else 'TIME_BUDGET'
                                if time.monotonic() >= started + MAX_SECONDS - 0.2 else 'BOUNDED_REFINEMENT'}
    leader_metrics = leadership_summary(leader_checks, Snapshot(values))
    if leader_metrics is not None:
        response['optimization']['leadership'] = leader_metrics
    return response


def _preserve_daily_timed_presence(model, employees, dates, choices, shifts, demands, values, control=None):
    """Preserve staffed sector-days in the feasible seed, not hourly coverage.

    Referenced days already containing timed WORK gain a guard, even when an
    automatic rounding produced a zero target. This preserves the seed, not a minimum.
    Empty days remain repair goals; DUTY cannot replace timed presence. Existing
    absence, closure, fixed-rest and locked-assignment constraints stay intact.
    WORK segments count on each occupied civil date, including overnight shifts.
    """
    sectors = {person["id"]: person["sector"] for person in employees if not has_no_clock(person)}
    active_dates = set(dates)
    demanded = {(item["sector"], item["date"]) for item in demands
                if item["date"] in active_dates}
    if not demanded:
        return
    present, occupied = {}, {}
    for (pid, day), options in choices.items():
        if control is not None:
            control.checkpoint()
        if pid not in sectors:
            continue
        for sid, variable in options.items():
            if (sid, day) not in occupied:
                occupied[sid, day] = occupied_dates(day, {"segments": [
                    segment for segment in shifts[sid]["segments"] if segment["kind"] == "WORK"]})
            for civil in occupied[sid, day]:
                key = sectors[pid], civil
                if key in demanded:
                    present.setdefault(key, {})[variable.index] = variable
    for variables in present.values():
        if control is not None:
            control.checkpoint()
        if any(values[index] for index in variables):
            model.add(sum(variables.values()) >= 1)


def _repair_clock_fixes(choices, metrics, values):
    """Keep the incumbent feasible while narrowing clocks only in a repair clone."""
    fixes = {}
    for options in choices.values():
        selected = {}
        for sid, variable in options.items():
            duration = metrics[sid][0]
            if duration not in selected or values[variable.index]:
                selected[duration] = sid
        for sid, variable in options.items():
            if sid != selected[metrics[sid][0]]:
                # The chosen incumbent clock always remains admissible. A free
                # duration uses the same ordered reference as REST_ONLY.
                fixes[variable.index] = 0
    return fixes


def _rest_repair_groups(employees, dates, work, baseline, values, policy, demands, visible_month=None,
                        sector_shortages=None, sunday_shortages=None):
    """Release whole deficient sectors, without assuming sales peaks or staffing minima."""
    sectors = {}
    for person in employees:
        sectors.setdefault(person["sector"], []).append(person)
    active_dates = set(dates)
    demanded = {(item["sector"], item["date"]) for item in demands
                if item["minimum"] > 0 and item["date"] in active_dates
                and (not visible_month or item["date"].startswith(visible_month + "-"))}
    ranked = []
    snapshot = Snapshot(values)
    for sector, members in sectors.items():
        empty = []
        for day in dates:
            if (sector, day) not in demanded:
                continue
            # A presence-only manager has no hourly coverage. Keep them in the
            # exchange group, but do not let DUTY conceal an empty timed sector.
            timed = [p for p in members if not has_no_clock(p)]
            present = [work[p["id"], day] for p in timed if (p["id"], day) in work]
            eligible = [p for p in timed if (p["id"], day) in work
                        and available_weekends(p, [day], baseline, policy)]
            if eligible and not any(values[var.index] for var in present):
                empty.append(day)
        shortage = snapshot.value(sum((sector_shortages or {}).get(sector, [])))
        sunday_shortage = snapshot.value(sum((sunday_shortages or {}).get(sector, [])))
        if empty or shortage > 0 or sunday_shortage > 0:
            sunday_count = sum(date.fromisoformat(day).weekday() == 6 for day in empty)
            ranked.append((-sunday_count, -len(empty), -sunday_shortage, -shortage, len(members), sector,
                           {person["id"] for person in members}))
    # Small sectors share one neighborhood. A large team gets its own complete
    # exchange group instead of being silently excluded by the old size limit.
    # Anchor the union at its highest-ranked member, not unconditionally first.
    # Grouping must not displace a more urgent sector from the four attempts.
    small, groups, small_rank = set(), [], None
    for rank, (_, _, _, _, size, _, members) in enumerate(sorted(ranked)):
        if size <= 8 and len(small | members) <= 16:
            if not small:
                small_rank = rank
            small.update(members)
        else:
            groups.append((rank, members))
    if small:
        groups.append((small_rank, small))
    return [members for _, members in sorted(groups, key=lambda item: item[0])[:4]]

def _read_assignments(solver, employees, active, baseline, work, choices, paid_holidays=frozenset()):
    result = []
    for person in employees:
        for day in active[person["id"]]:
            key = person["id"], day
            old = baseline.get(key, {})
            item = {"employeeId": key[0], "date": day, "kind": "OFF"}
            if old.get("kind") == "ABSENCE":
                item["kind"] = "ABSENCE"
            elif day in paid_holidays:
                item["kind"] = "HOLIDAY"
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


def _initial_hint_baseline(entries, employees, active, baseline, choices):
    """Bound an optional complete seed; it cannot redefine absences or locks."""
    if not isinstance(entries, list) or not entries or len(entries) > 10500:
        return None
    people = {person['id']: person for person in employees}
    required = {(pid, day) for pid in people for day in active[pid]}
    candidate, seen = {}, set()
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get('employeeId'), str) or not isinstance(entry.get('date'), str):
            return None
        key = entry['employeeId'], entry['date']
        if key in seen:
            return None
        seen.add(key)
        if key not in required:
            # Unchanged protected disabled records are retained by the real
            # baseline; foreign people/dates never become solver decisions.
            if baseline.get(key) != entry:
                return None
            continue
        old, kind = baseline.get(key, {}), entry.get('kind')
        if kind not in ('WORK', 'DUTY', 'OFF', 'ABSENCE', 'HOLIDAY'):
            return None
        if (kind == 'ABSENCE') != (old.get('kind') == 'ABSENCE'):
            return None
        if old.get('locked') and (kind != old['kind'] or
                kind == 'WORK' and entry.get('shiftId') != old.get('shiftId')):
            return None
        person = people[key[0]]
        if kind == 'WORK' and (has_no_clock(person) or not isinstance(entry.get('shiftId'), str)
                               or entry['shiftId'] not in choices[key]):
            return None
        if kind == 'DUTY' and not has_no_clock(person):
            return None
        candidate[key] = entry
    return candidate if set(candidate) == required else None


def _seed_hint_state(model, off, work, choices):
    """Only a fully hinted decision roster is a fixed seed, never an empty hint."""
    required = {variable.index for variable in [*off.values(), *work.values(),
                *(variable for options in choices.values() for variable in options.values())]}
    hinted = required.intersection(model.proto.solution_hint.vars)
    if not hinted:
        return "NONE"
    return "COMPLETE" if hinted == required else "PARTIAL"


def _empty_estimated_seed_sectors(employees, active, source, policy, demands):
    """An empty suggested sector may try a balanced seed, never a hard minimum."""
    groups = {}
    for person in employees:
        groups.setdefault(person["sector"], []).append(person["id"])
    active_days = {pid: set(days) for pid, days in active.items()}
    targets = {(d["sector"], d["date"]) for d in demands
               if d.get("estimated") is True and d["minimum"] > 0
               and d["date"] not in policy["closedDates"]}
    empty = set()
    for sector, day in targets:
        available = [pid for pid in groups.get(sector, []) if day in active_days[pid]
                     and source.get((pid, day), {}).get("kind") != "ABSENCE"]
        if len(available) >= 2 and all(source.get((pid, day), {}).get("kind") == "OFF" for pid in available):
            empty.add(sector)
    return empty


def _feasibility_hints(model, employees, dates, off, work, choices, active, baseline, metrics, policy,
                       deadline=None, control=None, prefer_baseline=True, mixed_people=frozenset(),
                       initial_assignments=None, estimated_demands=()):
    """Hint a preferred seed or saved sectors; CP-SAT verifies the combined draft."""
    holidays = paid_holiday_dates(policy)
    source = (_initial_hint_baseline(initial_assignments, employees, active, baseline, choices)
              if prefer_baseline else None)
    source = source if source is not None else baseline
    empty_sectors = _empty_estimated_seed_sectors(employees, active, source, policy, estimated_demands)
    sectors = {}
    for person in employees:
        sectors.setdefault(person['sector'], []).append(person)
    comparable = {sector for sector, members in sectors.items() if prefer_baseline and sector not in empty_sectors and all(
        (old := source.get((person['id'], day))) is not None
        and (old['kind'] == 'ABSENCE' or (day in holidays) == (old['kind'] == 'HOLIDAY'))
        and not (old['kind'] in ('WORK', 'DUTY') and day in policy["closedDates"])
        and not (old['kind'] == 'OFF' and holiday_rest_forbidden(policy, day))
        and (old['kind'] in ('OFF', 'ABSENCE')
             or (old['kind'] == 'HOLIDAY' and day in holidays)
             or (old['kind'] == 'DUTY' and has_no_clock(person))
             or (old['kind'] == 'WORK' and not has_no_clock(person)
                 and old.get('shiftId') in choices[person['id'], day]))
        for person in members for day in active[person['id']])}
    # Never repair the saved draft while declaring it the comparison baseline.
    # The fixed-hint CP-SAT pass checks this exact candidate against current rules.
    # If it fails, the unrestricted fallback remains free to repair the schedule.
    remaining = [person for person in employees if person['sector'] not in comparable]
    proposals = (balanced_rest_hints(remaining, dates, active, baseline, choices, metrics, policy, instant, sunday_limit,
                                        deadline=deadline, control=control, mixed_people=mixed_people)
                 if remaining else {})
    for person in employees:
        if person['sector'] in comparable:
            pid = person['id']
            proposals[pid] = {day: source[pid, day] for day in active[pid]}
    for person in employees:
        pid = person["id"]
        for day, entry in proposals.get(pid, {}).items():
            key = pid, day
            is_work = entry["kind"] in ("WORK", "DUTY")
            model.add_hint(off[key], int(entry["kind"] == "OFF"))
            model.add_hint(work[key], int(is_work))
            for sid, variable in choices[key].items():
                model.add_hint(variable, int(is_work and sid == entry.get("shiftId")))
    return bool(comparable)


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


def _rest(model, person, dates, active_days, choices, off, prior, metrics, policy):
    if has_no_clock(person):
        return  # No timestamps exist to establish an hourly rest interval.
    pid = person["id"]
    holidays = paid_holiday_dates(policy)
    events = {}
    first_relevant = (date.fromisoformat(dates[0]) - timedelta(days=5)).isoformat()
    for day, entry in prior.items():
        if entry["kind"] == "WORK" and day >= first_relevant:
            events.setdefault(day, []).append((entry["shiftId"], 1))
    for day in active_days:
        options = choices[pid, day]
        if options:
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
                    resting = 1 if middle in holidays else off.get((pid, middle), int(prior.get(middle, {}).get('kind') in ('OFF', 'HOLIDAY')))
                    if isinstance(resting, int) and not resting:
                        continue
                    enforcement = conditions + ([] if isinstance(resting, int) else [resting])
                    model.add(begin - finish >= policy['minWeeklyRestMinutes']).only_enforce_if(enforcement)


def _civil_rest(model, person, dates, active_days, choices, work, off, prior, shifts, shift_calendar):
    pid = person["id"]
    weekend_terms = {}
    untimed = has_no_clock(person)
    for day in active_days:
        if untimed and date.fromisoformat(day).weekday() in (5, 6):
            weekend_terms.setdefault(day, []).append(work[pid, day])
        for sid, variable in choices[pid, day].items():
            for occupied in shift_calendar(sid, day)[0]:
                if occupied != day and (pid, occupied) in off:
                    model.add(variable + off[pid, occupied] <= 1)
                if occupied != day and prior.get(occupied, {}).get("kind") in ("OFF", "ABSENCE", "HOLIDAY"):
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


def _coverage(model, data, employees, choices, shifts, started, scope="ALL", values=None, sunday_terms=None,
              sector_terms=None, visible_sunday_terms=None, visible_sector_terms=None, closing_terms=None):
    closed_holidays = paid_holiday_dates(data["policy"])
    relevant = [d for d in data['demands'] if d['minimum'] > 0
                and not (d.get('estimated') is True and d['date'] in closed_holidays)
                and not (scope == 'HARD' and d.get('estimated') is True)
                and not (scope == 'ESTIMATED' and d.get('estimated') is not True)]
    if not relevant:
        return []
    by_id = {p["id"]: p for p in employees}
    index = {}
    shortages, grouped = [], {}
    visible_month = _coverage_month(data)
    closing = data.get('storeClosingMinutes') if closing_terms is not None else None
    if type(closing) is not int or not 1 <= closing <= 1440:
        closing = None  # Older callers supplied no effective closing time.

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
        in_visible_month = visible_month and demand['date'].startswith(visible_month + '-')
        is_sunday = estimated and date.fromisoformat(demand['date']).weekday() == 6
        closing_window = None
        if (estimated and closing is not None and (not visible_month or in_visible_month)
                and demand['start'] < closing and demand['end'] > closing - 60):
            closing_window = (instant(demand['date'], max(0, closing - 60)),
                              instant(demand['date'], closing))
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
                    key = (minimum, tuple(sorted(v.index for v in variables)), demand['sector'])
                    if key not in grouped:
                        grouped[key] = [variables, 0, 0, 0, 0, 0]
                    grouped[key][1] += int(right - left)
                    if is_sunday:
                        grouped[key][2] += int(right - left)
                    if in_visible_month:
                        grouped[key][3] += int(right - left)
                        if is_sunday:
                            grouped[key][4] += int(right - left)
                    if closing_window:
                        grouped[key][5] += max(0, int(min(right, closing_window[1]) - max(left, closing_window[0])))
                continue
            if not available and demand["minimum"] > 0:
                minute = int(left - instant(demand["date"], 0))
                return (f"Cobertura sem horário disponível em {demand['date']} às {minute // 60:02d}:{minute % 60:02d}. "
                        "Confira os turnos permitidos, intervalos de refeição, setor e cargo da faixa antes de alterar o efetivo.")
            model.add(cp_model.LinearExpr.sum(available) >= demand["minimum"])
    for index, ((minimum, _, sector), (variables, weight, sunday_weight, visible_weight, visible_sunday_weight, closing_weight)) in enumerate(grouped.items()):
        shortage = model.new_int_var(0, minimum, f'coverage-gap:{index}')
        model.add(cp_model.LinearExpr.sum(variables) + shortage >= minimum)
        shortages.append(weight * shortage)
        if sector_terms is not None:
            sector_terms.setdefault(sector, []).append(weight * shortage)
        if sunday_terms is not None and sunday_weight:
            sunday_terms.setdefault(sector, []).append(sunday_weight * shortage)
        # Retain horizon guards and also protect the month presented in UI/exports.
        # Closing reuses the same shortage variables and does not invent new demand.
        if visible_sector_terms is not None and visible_weight:
            visible_sector_terms.setdefault(sector, []).append(visible_weight * shortage)
        if visible_sunday_terms is not None and visible_sunday_weight:
            visible_sunday_terms.setdefault(sector, []).append(visible_sunday_weight * shortage)
        if closing_terms is not None and closing_weight:
            closing_terms.setdefault(sector, []).append(closing_weight * shortage)
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
