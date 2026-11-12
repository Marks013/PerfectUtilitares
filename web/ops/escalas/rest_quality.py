"""Monthly rest quality; reported facts remain distinct from adjustable decisions."""
from datetime import date, timedelta
from optimization import remember

TARGET_MONTHLY_PAIRS = 2

def calendar_days(first, last):
    start, end = date.fromisoformat(first), date.fromisoformat(last)
    return [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]

def visible_month(data):
    if data.get('visibleMonth'):
        return data['visibleMonth']
    if not data.get('startDate') or not data.get('endDate'):
        return None
    first, last = date.fromisoformat(data['startDate']), date.fromisoformat(data['endDate'])
    if last < first:
        return None
    middle = first + timedelta(days=((last - first).days + 1) // 2)
    start = middle.replace(day=1)
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    if (first, last) == (start - timedelta(days=start.weekday()), end + timedelta(days=6-end.weekday())):
        return start.strftime('%Y-%m')
    return None

def in_visible(data, day):
    month = visible_month(data)
    return day.startswith(month + '-') if month else data['startDate'] <= day <= data['endDate']

def mutable_rest(person, day, data, records):
    old = records.get(day, {})
    return (person.get('offMode') == 'VARIABLE' and person.get('offPattern') == 'ANY'
        and data['startDate'] <= day <= data['endDate']
        and person['activeFrom'] <= day and (not person.get('activeUntil') or day <= person['activeUntil'])
        and not old.get('locked') and old.get('kind') not in ('ABSENCE', 'HOLIDAY')
        and day not in data['policy']['closedDates']
        and date.fromisoformat(day).weekday() not in person['fixedOffDays'])

def assignment_index(assignments):
    index = {}
    for item in assignments:
        index.setdefault(item['employeeId'], []).append(item)
    return index

def person_records(person, assignments):
    records = {item['date']: item for item in person.get('planningHistory', []) + person['history']
               + person.get('planningFuture', [])}
    records.update({item['date']: item for item in assignments if item['employeeId'] == person['id']})
    return records

def rest_pair_summary(data, assignments=None):
    assignments = data['assignments'] if assignments is None else assignments
    indexed = assignment_index(assignments)
    summary = {'targetMonthlyPairs': TARGET_MONTHLY_PAIRS, 'totalPairs': 0, 'imposedPairs': 0,
               'adjustablePairs': 0, 'correctableExcess': 0, 'peopleAboveTarget': 0,
               'concentration': 0, 'weeklyRepetitions': 0, 'people': []}
    for person in data['employees']:
        if person.get('planningEnabled') is False:
            continue
        records = person_records(person, indexed.get(person['id'], []))
        total, imposed, weeks = 0, 0, set()
        for after, record in records.items():
            if after < person['activeFrom'] or person.get('activeUntil') and after > person['activeUntil']:
                continue
            before = (date.fromisoformat(after) - timedelta(days=1)).isoformat()
            if not in_visible(data, after) or record['kind'] != 'OFF' or records.get(before, {}).get('kind') != 'OFF':
                continue
            total += 1
            if not any(mutable_rest(person, day, data, records) for day in (before, after)):
                imposed += 1
            else:
                parsed = date.fromisoformat(after)
                weeks.add(parsed - timedelta(days=parsed.weekday()))
        adjustable = total - imposed
        excess = max(0, total - TARGET_MONTHLY_PAIRS) - max(0, imposed - TARGET_MONTHLY_PAIRS)
        repetitions = sum(week + timedelta(days=7) in weeks for week in weeks)
        detail = {'employeeId': person['id'], 'totalPairs': total, 'imposedPairs': imposed,
                  'adjustablePairs': adjustable, 'correctableExcess': excess, 'weeklyRepetitions': repetitions}
        summary['people'].append(detail)
        for key in ('totalPairs', 'imposedPairs', 'adjustablePairs', 'correctableExcess', 'weeklyRepetitions'):
            summary[key] += detail[key]
        summary['peopleAboveTarget'] += int(excess > 0)
        summary['concentration'] += adjustable * (adjustable - 1) // 2
    return summary

def build_rest_quality(model, data, employees, off, values, groups):
    """Keep monthly excess and group totals, without freezing every person's pairs."""
    indexed = assignment_index(data['assignments'])
    by_person, excess, horizon, outside = {}, {}, {}, {}
    for person in employees:
        if person.get('offMode') != 'VARIABLE' or person.get('offPattern') != 'ANY':
            continue
        pid = person['id']
        records = person_records(person, indexed.get(pid, []))
        first = (date.fromisoformat(data['startDate']) - timedelta(days=1)).isoformat()
        last = (date.fromisoformat(data['endDate']) + timedelta(days=1)).isoformat()
        timeline = calendar_days(first, last)
        monthly, forced, adjustable = [], [], []
        full, padding = [], {}
        for before, after in zip(timeline, timeline[1:]):
            if after < person['activeFrom'] or person.get('activeUntil') and after > person['activeUntil']:
                continue
            if (pid, before) not in off and (pid, after) not in off:
                continue
            members = [off.get((pid, day), int(records.get(day, {}).get('kind') == 'OFF'))
                       for day in (before, after)]
            pair = model.new_bool_var(f'rest-pair:{pid}:{before}')
            model.add_min_equality(pair, members)
            initial = min(values[item.index] if not isinstance(item, int) else item for item in members)
            remember(model, values, pair, initial)
            mutable = any(mutable_rest(person, day, data, records) for day in (before, after))
            if mutable:
                full.append(pair)
                if not in_visible(data, after):
                    padding.setdefault(after[:7], []).append(pair)
            if in_visible(data, after):
                monthly.append(pair)
                if mutable:
                    adjustable.append(pair)
                else:
                    forced.append(pair)
        by_person[pid], horizon[pid], outside[pid] = adjustable, full, padding
        forced_value = sum(values[term.index] for term in forced)
        variable = model.new_int_var(0, len(monthly), f'rest-excess:{pid}')
        model.add_max_equality(variable, [0, sum(monthly) - max(TARGET_MONTHLY_PAIRS, forced_value)])
        remember(model, values, variable,
                 max(0, sum(values[term.index] for term in monthly) - max(TARGET_MONTHLY_PAIRS, forced_value)))
        excess[pid] = variable
    guard = list(excess.values())
    guard.extend(sum(terms) for months in outside.values() for terms in months.values())
    for members in groups:
        for collection in (by_person, horizon):
            terms = [term for pid in members for term in collection.get(pid, [])]
            if terms:
                guard.append(sum(terms))
    count = sum(len(terms) for terms in by_person.values())
    # One corrected excess dominates every possible monthly pair reduction.
    objective = (count + 1) * sum(excess.values()) + sum(term for terms in by_person.values() for term in terms)
    return {'objective': objective, 'people': by_person, 'excess': excess, 'guards': guard}
