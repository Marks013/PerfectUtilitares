"""Civil planning weeks, independent of solver settings and employee rules."""
from datetime import date, timedelta
import re

_MISSING = object()
_FIRST_PLANNING_DATE = date(2000, 1, 1)
_LAST_PLANNING_DATE = date(2099, 12, 31)
_DECEMBER_CUTOVER_START = "2026-12-01"
_DECEMBER_CUTOVER_END = "2026-12-31"


def planning_week_starts_on(data=_MISSING):
    """Only omitted metadata is legacy Monday; malformed inputs must fail."""
    if data is _MISSING:
        data = {}
    if not isinstance(data, dict):
        raise ValueError('INVALID_PLANNING_WEEK')
    value = data.get('planningWeekStartsOn', 'MONDAY')
    if value not in ('MONDAY', 'SUNDAY'):
        raise ValueError('INVALID_PLANNING_WEEK')
    return value


def _civil(value):
    if not isinstance(value, str) or not re.fullmatch(r'(?:19|20)\d{2}-\d{2}-\d{2}', value):
        raise ValueError('INVALID_CIVIL_DATE')
    return date.fromisoformat(value)


def _week_offset(day, convention):
    return (day.weekday() + 1) % 7 if convention == 'SUNDAY' else day.weekday()


def planning_week_start(value, calendar=_MISSING):
    day = _civil(value)
    return (day - timedelta(days=_week_offset(day, planning_week_starts_on(calendar)))).isoformat()


def planning_week_end(value, calendar=_MISSING):
    day = _civil(value)
    # The surrounding week may start in 1899; do not reparse that intermediate date.
    return (day + timedelta(days=6 - _week_offset(day, planning_week_starts_on(calendar)))).isoformat()


def _horizon_length(first, last, convention):
    length = (last - first).days + 1
    if (first < _FIRST_PLANNING_DATE or last > _LAST_PLANNING_DATE
            or not 7 <= length <= 42 or length % 7
            or _week_offset(first, convention) != 0 or _week_offset(last, convention) != 6):
        raise ValueError('INVALID_PLANNING_HORIZON')
    return length


def is_december_cutover(data):
    return (planning_week_starts_on(data) == 'SUNDAY'
            and data.get('startDate') == _DECEMBER_CUTOVER_START
            and data.get('endDate') == _DECEMBER_CUTOVER_END)


def planning_weeks(data):
    """Aligned weeks, with partial weeks only in the December 2026 cutover."""
    convention = planning_week_starts_on(data)
    first, last = _civil(data.get('startDate')), _civil(data.get('endDate'))
    if not is_december_cutover(data):
        _horizon_length(first, last, convention)
    weeks = []
    while first <= last:
        end = min(last, first + timedelta(days=6 - _week_offset(first, convention)))
        days = [(first + timedelta(days=offset)).isoformat() for offset in range((end - first).days + 1)]
        weeks.append({'startDate': days[0], 'endDate': days[-1], 'dates': days})
        first = end + timedelta(days=1)
    return weeks


def planning_month_period(month, calendar=_MISSING):
    if not isinstance(month, str) or not re.fullmatch(r'20\d{2}-(?:0[1-9]|1[0-2])', month):
        raise ValueError('INVALID_PLANNING_MONTH')
    convention = planning_week_starts_on(calendar)
    if month == _DECEMBER_CUTOVER_START[:7] and convention == 'SUNDAY':
        return {'startDate': _DECEMBER_CUTOVER_START, 'endDate': _DECEMBER_CUTOVER_END}
    first = _civil(month + '-01')
    last = (first.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    start = first - timedelta(days=_week_offset(first, convention))
    end = last + timedelta(days=6 - _week_offset(last, convention))
    # Validate without allocating and discarding a second copy of the daily calendar.
    _horizon_length(start, end, convention)
    return {'startDate': start.isoformat(), 'endDate': end.isoformat()}
