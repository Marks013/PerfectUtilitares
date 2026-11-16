"""Worst open-Sunday deficit per sector, reusing actual timed coverage terms."""
from datetime import date

from ortools.sat.python import cp_model
from optimization import Snapshot, remember


def _bounds(model, expression, domains):
    """Conservative integer bounds, without a staffing target or a big-M."""
    flat = cp_model.FlatIntExpr(expression)
    if not flat.ok:
        raise ValueError('noninteger Sunday coverage expression')
    lower = upper = int(flat.offset)
    for variable, coefficient in zip(flat.vars, flat.coeffs):
        if variable.index not in domains:
            domain = model.proto.variables[variable.index].domain
            domains[variable.index] = int(domain[0]), int(domain[-1])
        low, high = domains[variable.index]
        lower += coefficient * (low if coefficient >= 0 else high)
        upper += coefficient * (high if coefficient >= 0 else low)
    return int(lower), int(upper)


def build_sunday_peaks(model, daily_coverage, policy, values, *, visible_month=None, control=None):
    """Build one soft maximum in person-minutes per comparable sector calendar.

    Daily expressions come from _coverage, not daily headcounts: meals, roles
    and civil WORK segments retain their existing algebra. DUTY supplies no
    hourly coverage. Closed Sundays and neighboring months do not become a
    reason to move rests inside the visible month. No employee rule changes.

    The caller minimizes these peaks AFTER total coverage and Sunday coverage,
    and protects each sector at this phase. Equalizing a worse total deficit or
    buying a gain by worsening another sector is therefore not an improvement.
    """
    closed = set(policy.get('closedDates', []))
    if not policy.get('_simulation'):
        closed.update(set(policy.get('holidayDates', []))
                      - set(policy.get('authorizedHolidayDates', [])))
    by_sector = {}
    for (sector, day), terms in sorted(daily_coverage.items()):
        if control is not None:
            control.checkpoint()
        if (day in closed or date.fromisoformat(day).weekday() != 6
                or visible_month and not day.startswith(visible_month + '-')):
            continue
        by_sector.setdefault(sector, []).append(sum(terms))
    snapshot, domains, peaks = Snapshot(values), {}, {}
    for index, (sector, totals) in enumerate(sorted(by_sector.items())):
        if control is not None:
            control.checkpoint()
        if len(totals) < 2:
            continue  # With one referenced Sunday its total is already protected.
        bounds = [_bounds(model, expression, domains) for expression in totals]
        lower = max(0, max(low for low, _high in bounds))
        upper = max(high for _low, high in bounds)
        if upper <= lower:
            continue  # A domain-proven constant needs neither a phase nor a guard.
        peak = model.new_int_var(lower, upper, f'sunday-peak:{index}')
        model.add_max_equality(peak, totals)
        remember(model, values, peak, max(snapshot.value(expression) for expression in totals))
        peaks[sector] = [peak]
    return peaks
