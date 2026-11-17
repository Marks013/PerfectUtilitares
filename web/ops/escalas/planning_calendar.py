"""Civil planning weeks, independent of solver settings and employee rules."""
from datetime import date, timedelta
import re


def planning_week_starts_on(data=None):
    """Missing metadata is the legacy Monday convention; unknown values fail."""
    data = {} if data is None else data
    value = data.get('planningWeekStartsOn', 'MONDAY')
    if value not in ('MONDAY', 'SUNDAY'):
        raise ValueError('INVALID_PLANNING_WEEK')
    return value


def _civil(value):
    if not isinstance(value, str) or not re.fullmatch(r'(?:19|20)\d{2}-\d{2}-\d{2}', value):
        raise ValueError('INVALID_CIVIL_DATE')
    return date.fromisoformat(value)


def planning_week_start(value, calendar=None):
    day = _civil(value)
    offset = (day.weekday() + 1) % 7 if planning_week_starts_on(calendar) == 'SUNDAY' else day.weekday()
    return (day - timedelta(days=offset)).isoformat()


def planning_week_end(value, calendar=None):
    return (_civil(planning_week_start(value, calendar)) + timedelta(days=6)).isoformat()


def planning_weeks(data):
    """Aligned 7..42 day horizons only; never create implicit employee rests."""
    first, last = _civil(data['startDate']), _civil(data['endDate'])
    length = (last - first).days + 1
    if (not 7 <= length <= 42 or length % 7
            or planning_week_start(data['startDate'], data) != data['startDate']
            or planning_week_end(data['endDate'], data) != data['endDate']):
        raise ValueError('INVALID_PLANNING_HORIZON')
    weeks = []
    for index in range(0, length, 7):
        days = [(first + timedelta(days=index + offset)).isoformat() for offset in range(7)]
        weeks.append({'startDate': days[0], 'endDate': days[-1], 'dates': days})
    return weeks


def planning_month_period(month, calendar=None):
    if not isinstance(month, str) or not re.fullmatch(r'20\d{2}-(?:0[1-9]|1[0-2])', month):
        raise ValueError('INVALID_PLANNING_MONTH')
    first = _civil(month + '-01')
    last = (first.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    period = {'startDate': planning_week_start(first.isoformat(), calendar),
              'endDate': planning_week_end(last.isoformat(), calendar)}
    if period['startDate'] < '2000-01-01' or period['endDate'] > '2099-12-31':
        raise ValueError('INVALID_PLANNING_MONTH_BOUNDS')
    planning_weeks({**period, 'planningWeekStartsOn': planning_week_starts_on(calendar)})
    return period
