"""Comparable weekend rates with Sunday priority and explicit group safeguards."""
from datetime import date
from optimization import remember


def available_weekends(person, days, baseline, policy):
    """Count explicit opportunities, not absences, closed dates or forced rests."""
    available = []
    for day in days:
        old = baseline.get((person['id'], day), {})
        closed = day in policy['closedDates'] or (day in policy['holidayDates']
            and day not in policy['authorizedHolidayDates'] and not policy.get('_simulation'))
        if (closed or date.fromisoformat(day).weekday() in person['fixedOffDays']
                or old.get('kind') == 'ABSENCE' or (old.get('locked') and old.get('kind') == 'OFF')):
            continue
        available.append(day)
    return available


def weekend_objectives(model, groups, weekend_totals, seed, values, control=None):
    goals = {6: [], 5: []}
    for index, members in enumerate(groups.values()):
        if control is not None:
            control.checkpoint()
        for weekday in (6, 5):
            eligible = [pid for pid in members if weekend_totals[weekday][pid][1] > 0]
            if len(eligible) < 2:
                continue
            maximum = model.new_int_var(0, 10000, f'max-weekend:{weekday}:{index}')
            minimum = model.new_int_var(0, 10000, f'min-weekend:{weekday}:{index}')
            totals, scores = [], []
            for pid in eligible:
                score = model.new_int_var(0, 10000, f'weekend-rate:{weekday}:{pid}')
                total, opportunities = weekend_totals[weekday][pid]
                model.add_division_equality(score, total * 10000, opportunities)
                totals.append(score)
                scores.append(seed.value(total) * 10000 // opportunities)
                remember(model, values, score, scores[-1])
            model.add_max_equality(maximum, totals)
            model.add_min_equality(minimum, totals)
            remember(model, values, maximum, max(scores))
            remember(model, values, minimum, min(scores))
            spread = model.new_int_var(0, 10000, f'weekend-spread:{weekday}:{index}')
            model.add(spread == maximum - minimum)
            remember(model, values, spread, max(scores) - min(scores))
            goals[weekday].append(spread)
    return goals[6], goals[5]


def sunday_distribution(model, groups, employees, days, work, baseline, policy, values, control=None):
    """Balance staffed rates between open Sundays, separately from personal totals.

    Opportunities exclude closures, absences and forced rests. These soft rates
    express distribution, not demand. Preserve total incumbent Sunday presence
    when optimizing them so equal emptiness cannot purchase a better score.
    """
    sunday_days = [day for day in days if date.fromisoformat(day).weekday() == 6]
    opportunities = {p['id']: set(available_weekends(p, sunday_days, baseline, policy))
                     for p in employees}
    untimed = {p['id'] for p in employees if p.get('scheduleMode') in ('UNTIMED', 'MISSING')}
    spreads, presence, untimed_spreads = [], [], []
    for index, members in enumerate(groups.values()):
        if control is not None:
            control.checkpoint()
        if len(members) < 2:
            continue
        rates, initial_rates, totals = [], [], []
        for day in sunday_days:
            eligible = [work[pid, day] for pid in members
                        if day in opportunities[pid] and (pid, day) in work]
            if not eligible:
                continue
            total = sum(eligible)
            initial = sum(values[v.index] for v in eligible)
            rate = model.new_int_var(0, 10000, f'sunday-date-rate:{index}:{day}')
            model.add_division_equality(rate, total * 10000, len(eligible))
            remember(model, values, rate, initial * 10000 // len(eligible))
            rates.append(rate)
            initial_rates.append(initial * 10000 // len(eligible))
            totals.append(total)
        if len(rates) < 2:
            continue
        maximum = model.new_int_var(0, 10000, f'sunday-date-max:{index}')
        minimum = model.new_int_var(0, 10000, f'sunday-date-min:{index}')
        spread = model.new_int_var(0, 10000, f'weekend-date-spread:6:{index}')
        model.add_max_equality(maximum, rates)
        model.add_min_equality(minimum, rates)
        model.add(spread == maximum - minimum)
        remember(model, values, maximum, max(initial_rates))
        remember(model, values, minimum, min(initial_rates))
        remember(model, values, spread, max(initial_rates) - min(initial_rates))
        spreads.append(spread)
        presence.append(-sum(totals))
        if all(pid in untimed for pid in members):
            untimed_spreads.append(spread)
    return spreads, presence, untimed_spreads


def preserve_sunday_presence(model, employees, days, work, values, control=None):
    """Do not empty a sector that is staffed in the feasible Sunday reference.

    This protects the incumbent, not an approved staffing minimum or hourly
    coverage. A sector already empty or wholly absent creates no new demand.
    """
    sectors = {}
    for person in employees:
        sectors.setdefault(person['sector'], []).append(person['id'])
    for day in days:
        if date.fromisoformat(day).weekday() != 6:
            continue
        for members in sectors.values():
            if control is not None:
                control.checkpoint()
            present = [work[pid, day] for pid in members if (pid, day) in work]
            if any(values[variable.index] for variable in present):
                model.add(sum(present) >= 1)
