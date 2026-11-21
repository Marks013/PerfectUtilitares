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



def sector_sunday_distribution(model, groups, employees, days, work, baseline, policy,
                               values, excluded_sectors=(), control=None):
    """Secondary cross-cohort Sunday rate spreads, never an operational minimum.

    Only compare a sector containing distinct already-approved role/clock
    cohorts. Skip untimed or overnight sectors: an origin-day WORK boolean
    cannot verify their civil-Sunday staffing. A deficit variable makes any
    loss of the incumbent's aggregate eligible Sunday presence visible to
    the soft objective, without making a new hard staffing requirement.
    """
    sundays = [day for day in days if date.fromisoformat(day).weekday() == 6]
    if len(sundays) < 2:
        return [], [], 0
    cohort = {pid: index for index, members in enumerate(groups.values())
              for pid in members}
    excluded = set(excluded_sectors)
    sectors = {}
    for person in employees:
        sectors.setdefault(person['sector'], []).append(person)
    spreads, deficits, maximum_presence_deficit = [], [], 0
    for index, (sector, people) in enumerate(sorted(sectors.items())):
        if control is not None:
            control.checkpoint()
        if (sector in excluded or len(people) < 2
                or any(person.get('scheduleMode') in ('UNTIMED', 'MISSING')
                       or not person.get('shiftIds') for person in people)
                or len({cohort.get(person['id']) for person in people}) < 2):
            continue
        opportunities = {person['id']: set(available_weekends(person, sundays, baseline, policy))
                         for person in people}
        per_day = [[work[person['id'], day] for person in people
                    if day in opportunities[person['id']] and (person['id'], day) in work]
                   for day in sundays]
        eligible_days = [entry for entry in per_day if entry]
        if len(eligible_days) < 2:
            continue
        present = [variable for entry in eligible_days for variable in entry]
        incumbent = sum(values[variable.index] for variable in present)
        if incumbent == 0:
            continue  # No reference presence: do not invent a staffing target.
        # Compare only dates with the same eligible headcount. A division
        # equality for every Sunday used to add nonlinear auxiliary geometry
        # before COVERAGE was optimized, changing bounded repair outcomes.
        # Count extrema need just two variables and linear expressions; when
        # denominators differ, abstain rather than compare unlike rates.
        counts = {len(entry) for entry in eligible_days}
        if len(counts) != 1:
            continue
        eligible_count = next(iter(counts))
        initial_counts = [sum(values[variable.index] for variable in entry)
                          for entry in eligible_days]
        maximum = model.new_int_var(0, eligible_count, f'sector-sunday-max:{index}')
        minimum = model.new_int_var(0, eligible_count, f'sector-sunday-min:{index}')
        spread = model.new_int_var(0, 10000, f'sector-sunday-spread:{index}')
        model.add_max_equality(maximum, [sum(entry) for entry in eligible_days])
        model.add_min_equality(minimum, [sum(entry) for entry in eligible_days])
        # Scaled by the common eligible population (floor error < headcount
        # per sector); this is still a soft tie-break, never a coverage rule.
        scale = 10000 // eligible_count
        model.add(spread == scale * (maximum - minimum))
        remember(model, values, maximum, max(initial_counts))
        remember(model, values, minimum, min(initial_counts))
        remember(model, values, spread, scale * (max(initial_counts) - min(initial_counts)))
        # Soft loss budget, not a new minimum: earlier coverage optimization
        # may legally reduce incumbent Sunday presence if it must.
        deficit = model.new_int_var(0, incumbent, f'sector-sunday-presence-loss:{index}')
        model.add(deficit >= incumbent - sum(present))
        remember(model, values, deficit, 0)
        spreads.append(spread)
        deficits.append(deficit)
        maximum_presence_deficit += incumbent
    return spreads, deficits, maximum_presence_deficit


def sunday_balance_guards(cohort_spreads, cohort_presence):
    """Freeze only prior eligible-cohort guarantees, not new soft tie-breaks.

    Registering the sector spread or the soft presence-loss variables as
    no-regression guards before search would turn their seed values into hard
    limits, preventing a better higher-priority cohort solution.
    """
    return [*cohort_spreads, *cohort_presence]


def sector_sunday_tie_break(personal_spreads, sector_spreads, presence_losses,
                            max_presence_loss):
    """Lexicographic weights: personal fairness, presence, then sector spread.

    The weights are bounded by the variable ranges and the actual incumbent.
    A lower sector spread cannot purchase a worse personal fairness score or
    a reduction in existing Sunday presence when fairness is unchanged.
    """
    spread_bound = 10000 * len(sector_spreads)
    presence_weight = spread_bound + 1
    personal_weight = max_presence_loss * presence_weight + spread_bound + 1
    return (personal_weight * sum(personal_spreads)
            + presence_weight * sum(presence_losses) + sum(sector_spreads))


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
