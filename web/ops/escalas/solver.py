"""Bounded production scheduling with separate Sunday rotation and preserved hard rules."""
import hashlib
import time
from functools import lru_cache
from datetime import date, datetime, time as civil_time, timedelta
from zoneinfo import ZoneInfo

from ortools.sat.python import cp_model

from diagnostics import ConflictRegistry
from hints import balanced_rest_hints, holiday_rest_forbidden, paid_holiday_dates, saturday_rest_forbidden
from leadership import PRIORITY, leadership_objective, leadership_summary, movement_priority
from model_input import validate_manual_shifts
from optimization import ImprovementContext, Snapshot, improve, remember
from rest_quality import build_rest_quality, visible_month
from policy_reference import CCT_FROM, CCT_PROFILE, CCT_UNTIL, REFERENCE, TRANSITION_40_DATE, TRANSITION_42_DATE
from runtime_settings import MAX_SECONDS, RANDOM_SEED
from weekend_balance import available_weekends, preserve_sunday_presence, sunday_distribution, weekend_objectives

ZONE = ZoneInfo("America/Sao_Paulo")


def days_between(start, end):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    return [(first + timedelta(days=n)).isoformat()
            for n in range((last - first).days + 1)]

def _coverage_month(data):
    """Match TS visibleDates for legacy monthly horizons without rewriting data."""
    return visible_month(data)



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
    preserve_all = data.get('generationMode') == 'HOURS_ONLY'
    return [dict(a) for a in data['assignments'] if a['employeeId'] in retained
            and (preserve_all or a.get('locked') or a['kind'] in ('ABSENCE', 'HOLIDAY'))]


def _saturday_off_forbidden(data, day, old=None):
    return saturday_rest_forbidden({'_restRulesVersion': data.get('restRulesVersion', 1),
                                    '_visibleMonth': _coverage_month(data)}, day, old)


def _contract_conflict(started, message):
    response = _response('INFEASIBLE', [], started)
    response['solverDiagnostics'] = [{'family': 'BLOCKS', 'message': message}]
    return response


def solve(data, control=None):
    """Check preservation contracts before allocating or optimizing any days."""
    started = time.monotonic()
    validate_manual_shifts(data)
    hours_only = data.get('generationMode') == 'HOURS_ONLY'
    baseline = {(a['employeeId'], a['date']): a for a in data['assignments']}
    if hours_only and len(baseline) != len(data['assignments']):
        return _contract_conflict(started, 'A grade contém dias duplicados. Corrija a grade antes de ajustar horários.')
    dates = days_between(data['startDate'], data['endDate'])
    holidays = paid_holiday_dates(data['policy'])
    for person in data['employees']:
        if person.get('planningEnabled') is False:
            continue
        for day in dates:
            if day < person['activeFrom'] or person.get('activeUntil') and day > person['activeUntil']:
                continue
            old = baseline.get((person['id'], day))
            if hours_only and old is None:
                return _contract_conflict(started, 'Apenas horários exige uma grade completa para todas as datas ativas. Complete ou selecione a grade antes de continuar.')
            if hours_only and old['kind'] in ('WORK', 'DUTY'):
                if (old['kind'] == 'DUTY') != has_no_clock(person):
                    return _contract_conflict(started, 'O tipo de dia da grade não combina com o perfil de horário. Revise o perfil sem substituir os dias da grade.')
            protected_kind = old and old['kind'] in ('ABSENCE', 'HOLIDAY')
            if (_saturday_off_forbidden(data, day, old) and not protected_kind
                    and day not in holidays
                    and (5 in person['fixedOffDays']
                         or old and old['kind'] == 'OFF' and (hours_only or old.get('locked')))):
                return _contract_conflict(started, 'A regra de sábado sem folga conflita com uma folga fixa, bloqueada ou preservada pela opção Apenas horários. Revise a configuração ou escolha uma geração de folgas; nenhum dia foi desbloqueado.')
    response = _solve(data, control, started)
    if hours_only and response['status'] in ('OPTIMAL', 'FEASIBLE'):
        proposed = {(a['employeeId'], a['date']): a for a in response['assignments']}
        result = []
        for key, old in baseline.items():
            new = proposed.get(key, old)
            if new['kind'] != old['kind'] or old.get('locked') and new.get('shiftId') != old.get('shiftId'):
                return _contract_conflict(started, 'Os horários permitidos conflitam com os dias ou bloqueios da grade. Revise as referências de horário.')
            item = dict(old)
            if old['kind'] == 'WORK' and not old.get('locked'):
                item['shiftId'] = new['shiftId']
            result.append(item)
        if any(key not in baseline for key in proposed):
            return _contract_conflict(started, 'O ajuste de horários tentou criar uma data ausente da grade. Revise a grade de referência.')
        response['assignments'] = result
    return response


def _solve(data, control=None, started=None):
    started = time.monotonic() if started is None else started
    if control is not None:
        control.checkpoint()
    dates = days_between(data["startDate"], data["endDate"])
    employees = sorted((p for p in data["employees"] if p.get("planningEnabled") is not False), key=lambda e: e["id"])
    if not 1 <= len(employees) <= 250 or not 7 <= len(dates) <= 42 or len(dates) % 7:
        raise ValueError("model bounds")
    policy = {**data["policy"], "_simulation": data.get("simulation") is True,
              "_visibleMonth": _coverage_month(data),
              "_restRulesVersion": data.get('restRulesVersion', 1),
              "_generationMode": data.get('generationMode')}
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
            holiday = (old is not None and old['kind'] == 'HOLIDAY'
                       or day in paid_holidays and data.get('generationMode') != 'HOURS_ONLY') and not absent
            off[key] = model.new_bool_var(f"o:{pid}:{day}")
            work[key] = model.new_bool_var(f"w:{pid}:{day}")
            current = {}
            closed = day in closed_dates
            manual = person.get('manualShiftByDate', {}).get(day)
            # Restrict actual model choices before hours, rest, coverage and hints.
            # A dated preference does not force WORK or create a lock.
            allowed = [manual] if manual is not None else reference_shifts
            if (manual is None and old and old.get("locked") and old["kind"] == "WORK"
                    and old.get("shiftId") in shifts and old["shiftId"] not in allowed):
                # An existing explicit lock authorizes only its own local shift/day,
                # including targets outside the normal base. It never widens other days.
                allowed = [*allowed, old["shiftId"]]
            for sid in ([] if untimed else allowed):
                calendar = shift_calendar(sid, day, day in mixed_days)
                if calendar is None:
                    # An inadmissible dated target leaves no WORK option. Do not
                    # substitute a normal shift or reject legitimate non-work;
                    # mandatory work/coverage will expose a real model conflict.
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
            if _saturday_off_forbidden(data, day, old):
                conflicts.track(model.add(off[key] == 0), 'BLOCKS')
            if data.get('generationMode') == 'HOURS_ONLY':
                conflicts.track(model.add(off[key] == int(old['kind'] == 'OFF')), 'BLOCKS')
                conflicts.track(model.add(work[key] == int(old['kind'] in ('WORK', 'DUTY'))), 'BLOCKS')
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
            holidays_in_group = {d for d in group if baseline.get((pid, d), {}).get('kind') == 'HOLIDAY'
                                 or d in paid_holidays and data.get('generationMode') != 'HOURS_ONLY'}
            closed_weekdays = sum(date.fromisoformat(d).weekday() != 6 for d in holidays_in_group)
            closed_sundays = sum(date.fromisoformat(d).weekday() == 6 for d in holidays_in_group)
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
        _streaks(model, person, dates, work, off, boundary, active[pid], policy, baseline=baseline)
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
    result = _read_assignments(seed, employees, active, baseline, work, choices,
                               paid_holidays if data.get('generationMode') != 'HOURS_ONLY' else frozenset()) + retained_disabled_records(data)
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
    daily_coverage = {}
    movement_coverage, priority_coverage, movement_groups = [], {}, {}
    coverage = _coverage(model, data, employees, choices, shifts, started, "ESTIMATED", values, sunday_coverage, sector_coverage,
                         visible_sunday_coverage, visible_sector_coverage, closing_coverage,
                         movement_terms=movement_coverage, priority_terms=priority_coverage,
                         movement_groups=movement_groups, daily_terms=daily_coverage)
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
    date_spreads, sunday_presence, untimed_spreads = sunday_distribution(
        model, groups, employees, dates, work, baseline, policy, values, control)
    sundays.extend(date_spreads)
    # Unconfirmed staffing estimates are planning goals, never approved minima.
    # Prioritize their person-minute shortages before rotation and preferences.
    untimed_rotation = list(untimed_spreads)
    concentration, rotation = _rest_distribution(model, employees, dates, off, active, baseline, history, policy,
                                                 values, untimed_rotation=untimed_rotation)
    rest_quality = build_rest_quality(model, {**data, 'assignments': result}, employees, off,
                                      values, list(groups.values()))
    spacing_people = rest_quality['people']
    sunday_objective = sum(term for terms in sunday_coverage.values() for term in terms)
    closing_objective = sum(term for terms in closing_coverage.values() for term in terms)
    leader_terms, leader_checks = leadership_objective(model, data, employees, dates, work, values)
    goals = [("COVERAGE", sum(coverage)), ("SUNDAY_COVERAGE", sunday_objective),
             ("MOVEMENT_COVERAGE", sum(movement_coverage)),
             ("CLOSING_COVERAGE", closing_objective),
             # Untimed presence/rotation is operational. With unequal Sunday
             # opportunities, freezing the seed's zero spread can force every
             # person to stay OFF. Compare fairness only after this recovery.
             ("UNTIMED_ROTATION", sum(untimed_rotation)),
             ("SUNDAY_BALANCE", sum(sundays)),
             ("REST_SPACING", rest_quality['objective']),
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
    if (data.get('generationMode') != 'HOURS_ONLY' and (repair_people or mixed_people)
            and started + MAX_SECONDS - time.monotonic() > 0.8):
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
                                     # Coverage may leave an equal-but-empty Sunday seed.
                                     # Fairness guards start only at their own later phase.
                                     protected_groups={goals[0][0]: [sum(terms) for terms in sunday_coverage.values()]
                                                       + [sum(terms) for terms in sector_coverage.values()]
                                                       + [sum(terms) for terms in visible_sunday_coverage.values()]
                                                       + [sum(terms) for terms in visible_sector_coverage.values()]
                                                       + [sum(terms) for terms in closing_coverage.values()]
                                                       # Explicit priority-day references stay protected.
                                                       # Ordinary estimates may redistribute between dates;
                                                       # sector/month/Sunday/closing totals above cannot worsen.
                                                       + [sum(terms) for terms in priority_coverage.values()],
                                                       'UNTIMED_ROTATION': sunday_presence,
                                                       'SUNDAY_BALANCE': sundays + sunday_presence,
                                                       'SATURDAY_BALANCE': saturdays,
                                                       'REST_SPACING': rest_quality['guards']} if goals else {},
                                     employee_groups=list(groups.values()),
                                     untimed_people={person['id'] for person in employees if has_no_clock(person)},
                                     rest_spacing=spacing_people,
                                     rest_spacing_groups={sector: [p['id'] for p in employees if p['sector'] == sector]
                                                          for sector in {p['sector'] for p in employees}},
                                     coverage_groups={sector: [p['id'] for p in employees if p['sector'] == sector]
                                                      for sector in sector_coverage}, sunday_coverage=sunday_coverage,
                                     sector_coverage=sector_coverage,
                                     closing_coverage=closing_coverage,
                                     movement_coverage=movement_groups,
                                     decision_variables=decisions,
                                     initial_decision_hints=warm_decisions,
                                     initial_repair_groups=repair_groups,
                                     repair_clock_fixes=_repair_clock_fixes(choices, metrics, values)))
    # Existing protected disabled records are retained, never allocated or counted as workforce.
    result = _read_assignments(Snapshot(values), employees, active, baseline, work, choices,
                               paid_holidays if data.get('generationMode') != 'HOURS_ONLY' else frozenset()) + retained_disabled_records(data)
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
            # Recover measured person-minutes first; an almost empty large team
            # must not rank below every completely empty small department.
            ranked.append((-shortage, -sunday_shortage, -sunday_count, -len(empty), len(members), sector,
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
            elif old.get('kind') == 'HOLIDAY' or day in paid_holidays:
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
    """Hint a preferred seed, saved sectors or a rebuilt saved rest pattern.

    Return whether any saved reference was reused, so a rejected candidate can
    retry without it. This is not proof that the original roster is comparable
    or feasible; CP-SAT verifies the complete candidate before using its guards.
    """
    hours_only = policy.get('_generationMode') == 'HOURS_ONLY'
    if hours_only and not prefer_baseline:
        return False  # Retry without hints rather than redistribute preserved days.
    holidays = set() if hours_only else paid_holiday_dates(policy)
    source = (_initial_hint_baseline(initial_assignments, employees, active, baseline, choices)
              if prefer_baseline and not hours_only else None)
    source = source if source is not None else baseline
    empty_sectors = set() if hours_only else _empty_estimated_seed_sectors(employees, active, source, policy, estimated_demands)
    sectors = {}
    for person in employees:
        sectors.setdefault(person['sector'], []).append(person)
    comparable = {sector for sector, members in sectors.items() if prefer_baseline and all(
        (old := source.get((person['id'], day))) is not None
        and (old['kind'] == 'ABSENCE' or (day in holidays or baseline.get((person['id'], day), {}).get('kind') == 'HOLIDAY') == (old['kind'] == 'HOLIDAY'))
        and not (old['kind'] in ('WORK', 'DUTY') and day in policy["closedDates"])
        and not (old['kind'] == 'OFF' and holiday_rest_forbidden(policy, day))
        and not (old['kind'] == 'OFF' and saturday_rest_forbidden(policy, day, baseline.get((person['id'], day))))
        and (old['kind'] in ('OFF', 'ABSENCE')
             or old['kind'] == 'HOLIDAY'
             or (old['kind'] == 'DUTY' and has_no_clock(person))
             or (old['kind'] == 'WORK' and not has_no_clock(person)
                 and old.get('shiftId') in choices[person['id'], day]))
        for person in members for day in active[person['id']])}
    # Never repair the saved draft while declaring it the comparison baseline.
    # The fixed-hint CP-SAT pass checks this exact candidate against current rules.
    # If it fails, the unrestricted fallback remains free to repair the schedule.
    remaining = [person for person in employees if person['sector'] not in comparable]
    rest_candidates = [person for person in remaining
                       if prefer_baseline and not hours_only and person['sector'] not in empty_sectors
                       and any(baseline.get((person['id'], day), {}).get('kind') == 'OFF'
                               for day in active[person['id']])]
    proposals = (balanced_rest_hints(rest_candidates, dates, active, baseline, choices, metrics, policy,
                                    instant, sunday_limit, deadline=deadline, control=control,
                                    mixed_people=mixed_people, preserve_rest_pattern=True)
                 if rest_candidates else {})
    # A clock-adaptation candidate is verified by the same fixed-hint pass.
    # On rejection, prefer_baseline=False must also release its saved OFF pattern.
    reused_rests = bool(proposals)
    remaining = [person for person in remaining if person['id'] not in proposals]
    if remaining and not hours_only:
        proposals.update(balanced_rest_hints(
            remaining, dates, active, baseline, choices, metrics, policy, instant, sunday_limit,
            deadline=deadline, control=control, mixed_people=mixed_people,
            preserve_work_people={person['id'] for person in remaining
                                  if person['sector'] not in empty_sectors}))
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
    return bool(comparable) or reused_rests


def _variable_rest_streaks(model, person, dates, off, prior, active, baseline, policy):
    """Cap variable regular OFF runs without rewriting imposed boundary records."""
    if person['offMode'] != 'VARIABLE':
        return
    pid = person['id']
    active_set = set(active)
    closed_holidays = paid_holiday_dates(policy)
    first = (date.fromisoformat(dates[0]) - timedelta(days=2)).isoformat()
    last = (date.fromisoformat(dates[-1]) + timedelta(days=2)).isoformat()
    timeline = days_between(first, last)
    for index in range(2, len(timeline)):
        window = timeline[index - 2:index + 1]
        mutable = [day for day in window if day in active_set and (pid, day) in off
                   and day not in policy['closedDates'] and day not in closed_holidays
                   and baseline.get((pid, day), {}).get('kind') not in ('ABSENCE', 'HOLIDAY')
                   and not baseline.get((pid, day), {}).get('locked')
                   and date.fromisoformat(day).weekday() not in person['fixedOffDays']]
        if not mutable:
            continue  # Fully imposed OFFs and historical-only windows remain intact.
        terms = [off.get((pid, day), int(prior.get(day, {}).get('kind') == 'OFF')) for day in window]
        model.add(sum(terms) <= 2)


def _rest_spacing(model, employees, dates, off, baseline, history, policy, values):
    """Compatibility entrypoint exercising the production rest-quality builder."""
    participants = [{**person, 'history': [{'date': day, **entry}
                     for day, entry in history.get(person['id'], {}).items()]}
                    for person in employees]
    data = {'startDate': dates[0], 'endDate': dates[-1], 'policy': policy,
            'employees': participants, 'assignments': [{'employeeId': pid, 'date': day, **entry}
                for (pid, day), entry in baseline.items()]}
    quality = build_rest_quality(model, data, participants, off, values,
                                 [[person['id'] for person in participants]])
    return [term for terms in quality['people'].values() for term in terms], quality['people']


def _streaks(model, person, dates, work, off, prior, active, policy, baseline=None):
    pid = person["id"]
    _variable_rest_streaks(model, person, dates, off, prior, active, baseline or {}, policy)
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


def _rest_distribution(model, employees, dates, off, active, baseline, history, policy, values=None,
                       untimed_rotation=None):
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
            convex = None
            if untimed_rotation is not None and has_no_clock(person):
                # L1 is linear beyond the target: e.g. counts (4,2,2) and (3,3,2)
                # can tie. Squared deviation makes repeated weekday rests increasingly costly.
                convex = model.new_int_var(0, (7 * opportunities) ** 2, f'untimed-rotation:{pid}:{weekday}')
                model.add_multiplication_equality(convex, [deviation, deviation])
                untimed_rotation.append(convex)
            if values is not None:
                rests_value = sum(values[off[pid, day].index] for day in available) + sum(entry["kind"] == "OFF" for entry in known)
                deviation_value = abs(7 * rests_value - 2 * opportunities)
                remember(model, values, deviation, deviation_value)
                if convex is not None:
                    remember(model, values, convex, deviation_value ** 2)
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


def _coverage_reference_slices(demands):
    """Sweep reference boundaries; duplicate functions use max, distinct ones sum.

    Confirmed and estimated references remain separate. Targets depend only on
    the supplied references, never on a candidate roster or its presence.
    """
    groups = {}
    for demand in demands:
        key = demand['date'], demand['sector'], demand.get('estimated') is True
        events = groups.setdefault(key, {})
        role, minimum = demand.get('role') or '', demand['minimum']
        events.setdefault(demand['start'], []).append((role, minimum, 1))
        events.setdefault(demand['end'], []).append((role, minimum, -1))
    for (day, sector, estimated), events in groups.items():
        counts = {}
        points = sorted(events)
        for start, end in zip(points, points[1:]):
            for role, minimum, delta in events[start]:
                levels = counts.setdefault(role, {})
                levels[minimum] = levels.get(minimum, 0) + delta
                if levels[minimum] == 0:
                    del levels[minimum]
                if not levels:
                    del counts[role]
            if not counts:
                continue
            floors = {role: max(levels) for role, levels in counts.items()}
            general = floors.pop('', 0)
            yield {'date': day, 'sector': sector, 'estimated': estimated,
                   'start': start, 'end': end, 'roles': floors,
                   'minimum': max(general, sum(floors.values()))}


def _coverage(model, data, employees, choices, shifts, started, scope="ALL", values=None, sunday_terms=None,
              sector_terms=None, visible_sunday_terms=None, visible_sector_terms=None, closing_terms=None,
              movement_terms=None, priority_terms=None, movement_groups=None, daily_terms=None):
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
    priorities = data.get('movementPriorities', [])
    movement_enabled = bool(priorities) and movement_terms is not None
    priority_cache = {}
    segment_cache = {}

    def register(pid, day, sid, variable):
        person = by_id[pid]
        key = day, sid
        if key not in segment_cache:
            segments = []
            for segment in shifts[sid]["segments"]:
                if segment["kind"] != "WORK":
                    continue
                start, end = instant(day, segment["start"]), instant(day, segment["end"])
                for offset in range(segment["start"] // 1440, (segment["end"] - 1) // 1440 + 1):
                    civil = (date.fromisoformat(day) + timedelta(days=offset)).isoformat()
                    segments.append((civil, start, end))
            segment_cache[key] = segments
        for civil, start, end in segment_cache[key]:
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
    for demand_index, demand in enumerate(_coverage_reference_slices(relevant)):
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
            if end > begin and start < finish:
                left, right = max(begin, start), min(finish, end)
                intervals.append((left, right, variable, role))
                points.update((left, right))
        ordered = sorted(points)
        in_visible_month = visible_month and demand['date'].startswith(visible_month + '-')
        is_sunday = estimated and date.fromisoformat(demand['date']).weekday() == 6
        closing_window = None
        if (estimated and closing is not None and (not visible_month or in_visible_month)
                and demand['start'] < closing and demand['end'] > closing - 60):
            closing_window = (instant(demand['date'], max(0, closing - 60)),
                              instant(demand['date'], closing))
        priority_key = demand['sector'], demand['date']
        if priority_key not in priority_cache:
            priority_cache[priority_key] = movement_priority(priorities, *priority_key)
        priority = priority_cache[priority_key]
        # Missing movement data is neutral, not an inferred weekend peak.
        movement_weight = (priority if priority is not None else PRIORITY['NORMAL']) if movement_enabled else 0
        for interval_index, (left, right) in enumerate(zip(ordered, ordered[1:])):
            present = [(v, role) for start, end, v, role in intervals if start <= left and end >= right]
            available = [v for v, _ in present]
            role_available = {role: [v for v, actual_role in present if actual_role == role]
                              for role in demand['roles']}
            if estimated:
                if demand["minimum"] > 0:
                    fixed = sum(v for v in available if isinstance(v, int))
                    variables = [v for v in available if not isinstance(v, int)]
                    minimum = max(0, demand['minimum'] - fixed)
                    role_requirements = []
                    for role, floor in sorted(demand['roles'].items()):
                        members = role_available[role]
                        required = max(0, floor - sum(v for v in members if isinstance(v, int)))
                        if required:
                            role_requirements.append((required, tuple(sorted(v.index for v in members if not isinstance(v, int)))))
                    if not minimum and not role_requirements:
                        continue
                    # References are already deduplicated per exact civil slice.
                    # Only disjoint durations with identical deficit algebra share a variable.
                    key = (minimum, tuple(sorted(v.index for v in variables)), demand['sector'],
                           tuple(role_requirements))
                    if key not in grouped:
                        grouped[key] = [variables, 0, 0, 0, 0, 0, 0, {}, {}]
                    grouped[key][1] += int(right - left)
                    if is_sunday:
                        grouped[key][2] += int(right - left)
                    if in_visible_month:
                        grouped[key][3] += int(right - left)
                        if is_sunday:
                            grouped[key][4] += int(right - left)
                    grouped[key][6] += movement_weight * int(right - left)
                    if priority_terms is not None and priority == PRIORITY['HIGH']:
                        prioritized = grouped[key][7]
                        prioritized[priority_key] = prioritized.get(priority_key, 0) + int(right - left)
                    if daily_terms is not None:
                        daily = grouped[key][8]
                        daily[priority_key] = daily.get(priority_key, 0) + int(right - left)
                    if closing_window:
                        grouped[key][5] += max(0, int(min(right, closing_window[1]) - max(left, closing_window[0])))
                continue
            if not available and demand["minimum"] > 0:
                minute = int(left - instant(demand["date"], 0))
                return (f"Cobertura sem horário disponível em {demand['date']} às {minute // 60:02d}:{minute % 60:02d}. "
                        "Confira os turnos permitidos, intervalos de refeição, setor e cargo da faixa antes de alterar o efetivo.")
            model.add(cp_model.LinearExpr.sum(available) >= demand["minimum"])
            for role, floor in demand['roles'].items():
                model.add(cp_model.LinearExpr.sum(role_available[role]) >= floor)
    for index, ((minimum, _, sector, roles), (variables, weight, sunday_weight, visible_weight, visible_sunday_weight, closing_weight, movement_weight, prioritized, daily)) in enumerate(grouped.items()):
        ceiling = max(minimum, sum(required for required, _ in roles))
        shortage = model.new_int_var(0, ceiling, f'coverage-gap:{index}')
        model.add(cp_model.LinearExpr.sum(variables) + shortage >= minimum)
        role_gaps = []
        initial_role_gap = 0
        for role_index, (required, indexes) in enumerate(roles):
            members = [model.get_int_var_from_proto_index(i) for i in indexes]
            if members:
                gap = model.new_int_var(0, required, f'coverage-role-gap:{index}:{role_index}')
                model.add(cp_model.LinearExpr.sum(members) + gap >= required)
                if values is not None:
                    initial = max(0, required - sum(values[i] for i in indexes))
                    remember(model, values, gap, initial)
                    initial_role_gap += initial
            else:
                gap = required
                initial_role_gap += required
            role_gaps.append(gap)
        if role_gaps:
            model.add(shortage >= sum(role_gaps))
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
        if movement_terms is not None and movement_weight:
            term = movement_weight * shortage
            movement_terms.append(term)
            if movement_groups is not None:
                movement_groups.setdefault(sector, []).append(term)
        if priority_terms is not None:
            for sector_day, minutes in prioritized.items():
                priority_terms.setdefault(sector_day, []).append(minutes * shortage)
        # Reuse the shortage variable, but retain each civil day's duration.
        if daily_terms is not None:
            for sector_day, minutes in daily.items():
                daily_terms.setdefault(sector_day, []).append(minutes * shortage)
        if values is not None:
            present = sum(values[v.index] for v in variables)
            remember(model, values, shortage, max(0, minimum - present, initial_role_gap))
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
