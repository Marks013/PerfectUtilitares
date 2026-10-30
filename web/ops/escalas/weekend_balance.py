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
