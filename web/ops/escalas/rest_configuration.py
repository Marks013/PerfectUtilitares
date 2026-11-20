"""Explicit personal rests and operational closures; never inferred from a roster."""
from datetime import date, timedelta


def fixed_rest_projection(person):
    """Validate optional independent slots against the existing transport contract."""
    slots = person.get('fixedRestSlots')
    if 'fixedRestSlots' not in person:
        return person['offMode'], person['fixedOffDays']
    if not isinstance(slots, list) or len(slots) != 2:
        raise ValueError('INVALID_FIXED_REST_SLOTS')
    days = []
    for slot in slots:
        if not isinstance(slot, dict) or set(slot) != {'enabled', 'weekday'}:
            raise ValueError('INVALID_FIXED_REST_SLOT')
        weekday = slot['weekday']
        if (type(slot['enabled']) is not bool
                or weekday is not None and (type(weekday) is not int or not 0 <= weekday <= 6)
                or slot['enabled'] and weekday is None):
            raise ValueError('INVALID_FIXED_REST_SLOT')
        if slot['enabled']:
            days.append(weekday)
    if len(set(days)) != len(days):
        raise ValueError('DUPLICATE_FIXED_REST')
    days.sort()
    mode = ('VARIABLE', 'MIXED', 'FIXED')[len(days)]
    if person.get('offMode') != mode or sorted(person.get('fixedOffDays', [])) != days:
        raise ValueError('FIXED_REST_PROJECTION_MISMATCH')
    return mode, days


def effective_rest_input(data):
    """v3 branch 02 Sundays are closures, not paid holidays or personal settings."""
    for person in data['employees']:
        fixed_rest_projection(person)
    code = data.get('branchCode', '').strip()
    if data.get('restRulesVersion', 1) < 3 or not code.isascii() or not code.isdigit() or int(code) != 2:
        return data
    first = date.fromisoformat(data['startDate']) - timedelta(days=1)
    last = date.fromisoformat(data['endDate']) + timedelta(days=1)
    sundays = {(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)
               if (first + timedelta(days=i)).weekday() == 6}
    closed = sorted(set(data['policy']['closedDates']) | sundays)
    demands = [item for item in data['demands'] if not (item.get('estimated') is True and item['date'] in sundays)]
    if closed == data['policy']['closedDates'] and demands == data['demands']:
        return data
    return {**data, 'policy': {**data['policy'], 'closedDates': closed}, 'demands': demands}


def variable_rest_groups(person, dates, baseline, policy):
    """Comparable complete weeks only; imposed patterns are not automatic fixes.

    v3 prevents the same TWO weekdays being OFF in every comparable week.
    It permits occasional repetition and does not require weekly alternation.
    At least two complete, unprotected weeks must share the closure weekdays.
    Explicit two-fixed and mandatory consecutive requests are exempt. A day
    cannot be borrowed from another week, absence, holiday or unknown history.
    """
    if (policy.get('_restRulesVersion', 1) < 3 or policy.get('_generationMode') == 'HOURS_ONLY'
            or person.get('planningEnabled') is False or person['offMode'] == 'FIXED'
            or person['offPattern'] == 'CONSECUTIVE'):
        return []
    closed = set(policy['closedDates'])
    holidays = set(policy.get('holidayDates', [])) | set(policy.get('paidHolidayDates', []))
    start_weekday = 6 if policy.get('_planningWeekStartsOn') == 'SUNDAY' else 0
    weeks = {}
    for day in dates:
        if day < person['activeFrom'] or person.get('activeUntil') and day > person['activeUntil']:
            continue
        civil = date.fromisoformat(day)
        start = (civil - timedelta(days=(civil.weekday() - start_weekday) % 7)).isoformat()
        weeks.setdefault(start, []).append(day)
    comparable = {}
    month = policy.get('_visibleMonth')
    for days in weeks.values():
        days = sorted(days)
        # Technical padding cannot be the only source of apparent monthly rotation.
        if month and any(not day.startswith(month + '-') for day in days):
            continue
        if len(days) != 7 or any(day in holidays or baseline.get((person['id'], day), {}).get('locked')
                               or baseline.get((person['id'], day), {}).get('kind') in ('ABSENCE', 'HOLIDAY')
                               for day in days):
            continue
        imposed = frozenset(person['fixedOffDays']) | frozenset(
            date.fromisoformat(day).weekday() for day in days if day in closed)
        if len(imposed) < 2:
            comparable.setdefault(imposed, []).append(days)
    return [(imposed, weeks) for imposed, weeks in comparable.items() if len(weeks) >= 2]


def repeated_variable_pattern(person, dates, records, baseline, policy):
    for _imposed, weeks in variable_rest_groups(person, dates, baseline, policy):
        # Incomplete results are not classified as a repeated complete pattern.
        if any(day not in records for days in weeks for day in days):
            continue
        shared = set(range(7))
        for days in weeks:
            shared.intersection_update(date.fromisoformat(day).weekday()
                                       for day in days if records[day]['kind'] == 'OFF')
        if len(shared) >= 2:
            return True
    return False


def add_variable_rest_constraints(model, person, dates, off, baseline, policy, conflicts):
    """Linear reification keeps conflict diagnosis and the original search budget."""
    pid = person['id']
    for group, (imposed, weeks) in enumerate(variable_rest_groups(person, dates, baseline, policy)):
        common = []
        by_weekday = {weekday: [next(day for day in week if date.fromisoformat(day).weekday() == weekday)
                                for week in weeks] for weekday in range(7) if weekday not in imposed}
        for weekday, days in by_weekday.items():
            all_off = model.new_bool_var(f'variable-rest:{pid}:{group}:{weekday}')
            variables = [off[pid, day] for day in days]
            for variable in variables:
                conflicts.track(model.add(all_off <= variable), 'REST')
            conflicts.track(model.add(all_off >= sum(variables) - len(variables) + 1), 'REST')
            common.append(all_off)
        conflicts.track(model.add(sum(common) <= 1 - len(imposed)), 'REST')
