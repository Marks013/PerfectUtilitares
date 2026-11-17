"""Guarded Sunday maxima with a bounded, strictly secondary dispersion score."""
from dataclasses import dataclass
from datetime import date
from math import gcd

from ortools.sat.python import cp_model
from optimization import Snapshot, remember


MAX_SAFE_INTEGER = (1 << 53) - 1


@dataclass(frozen=True)
class SundayPeakPlan:
    objective: object
    peaks: dict
    neighborhoods: dict
    ready: bool = True


def _bounds(model, expression, domains):
    """Conservative integer bounds, without a staffing target or a big-M."""
    if isinstance(expression, int):
        return expression, expression
    flat = cp_model.FlatIntExpr(expression)
    if not flat.ok:
        raise ValueError('noninteger Sunday coverage expression')
    lower = upper = int(flat.offset)
    for variable, coefficient in zip(flat.vars, flat.coeffs):
        if variable.index not in domains:
            # Native 9.15 repeated-field proxies do not provide Python negative
            # indexing semantics. Materialize before reading either endpoint.
            domain = tuple(model.proto.variables[variable.index].domain)
            domains[variable.index] = int(domain[0]), int(domain[-1])
        low, high = domains[variable.index]
        lower += coefficient * (low if coefficient >= 0 else high)
        upper += coefficient * (high if coefficient >= 0 else low)
    return int(lower), int(upper)


def build_sunday_peaks(model, daily_coverage, policy, values, *, visible_month=None, control=None):
    """Minimize sector maxima, then squared daily deficits on an exact common unit.

    Daily expressions come from _coverage, not daily headcounts: meals, roles
    and civil WORK segments retain their existing algebra. DUTY supplies no
    hourly coverage. Closed Sundays and neighboring months do not become a
    reason to move rests inside the visible month. No employee rule changes.

    The caller retains total/sector/role coverage guards and runs this AFTER
    Sunday totals. Construction retains the original domains: earlier priorities
    may improve totals even when their accepted peak exceeds the seed's peak.
    The caller activates returned guards only on entry into SUNDAY_PEAK using
    the CURRENT accepted incumbent, then preserves gains in following phases.
    Days remain free to exchange deficits below that accepted sector cap.

    Integer weights are derived, never tuned: one unit of aggregate peak gain
    dominates the entire possible secondary range. A constant maximum leaves
    the squared deficits of the other Sundays active. This is a convex tie
    break, not a claim of a complete lexicographic sort of all Sundays.
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
    snapshot, domains = Snapshot(values), {}
    # Preserve exact person-minute comparisons while removing a common duration
    # factor. This reduces integer range without rounding any deficit or target.
    quantum = 0
    for totals in by_sector.values():
        for expression in totals:
            if isinstance(expression, int):
                quantum = gcd(quantum, expression)
            else:
                flat = cp_model.FlatIntExpr(expression)
                quantum = gcd(quantum, int(flat.offset))
                for coefficient in flat.coeffs:
                    quantum = gcd(quantum, int(coefficient))
    quantum = max(1, abs(quantum))
    peaks, neighborhoods, primary, variable_days = {}, {}, [], []
    primary_upper, secondary_upper = 0, 0
    for index, (sector, totals) in enumerate(sorted(by_sector.items())):
        if control is not None:
            control.checkpoint()
        if len(totals) < 2:
            continue  # With one referenced Sunday its total is already protected.
        bounds = [_bounds(model, expression, domains) for expression in totals]
        if any(low < 0 for low, _high in bounds):
            raise ValueError('negative Sunday deficit domain')
        normalized = []
        for expression in totals:
            if isinstance(expression, int):
                normalized.append(expression // quantum)
            else:
                flat = cp_model.FlatIntExpr(expression)
                normalized.append(int(flat.offset) // quantum + sum(
                    (int(coefficient) // quantum) * variable
                    for variable, coefficient in zip(flat.vars, flat.coeffs)))
        initial = [snapshot.value(expression) // quantum for expression in totals]
        lower = max(low // quantum for low, _high in bounds)
        upper = max(high // quantum for _low, high in bounds)
        current_peak = max(initial)
        peak = model.new_int_var(lower, upper, f'sunday-peak:{index}')
        model.add_max_equality(peak, normalized)
        remember(model, values, peak, current_peak)
        peaks[sector] = [quantum * peak]
        if lower < upper:
            excess = model.new_int_var(0, upper - lower, f'sunday-peak-excess:{index}')
            model.add(excess == peak - lower)
            remember(model, values, excess, current_peak - lower)
            primary.append(excess)
        primary_upper += upper - lower
        movable = lower < upper
        for day_index, (expression, (low, high), current) in enumerate(zip(normalized, bounds, initial)):
            low, high = low // quantum, high // quantum
            if low == high:
                continue
            movable = True
            variable_days.append((index, day_index, expression, low, high, current))
            secondary_upper += high * high - low * low
        if movable:
            neighborhoods[sector] = peaks[sector]
    # Fail closed on exceptional integer ranges; keep the feasible incumbent
    # and let the caller report SUNDAY_PEAK as unattempted, without seed caps.
    # Scores must survive JSON and the client's strict safe-integer schema
    # exactly. Never round telemetry or weaken the primary/secondary ordering.
    weight = secondary_upper + 1
    if primary_upper * weight + secondary_upper > MAX_SAFE_INTEGER:
        return SundayPeakPlan(0, peaks, neighborhoods, ready=False)
    secondary = []
    for index, day_index, expression, low, high, current in variable_days:
        if control is not None:
            control.checkpoint()
        # (deficit - low)^2 + 2*low*(deficit - low) equals deficit^2 - low^2.
        # Offset variables keep CP-SAT's coefficients/domains bounded even when
        # a large constant part does not contribute to the objective's range.
        total = model.new_int_var(0, high - low, f'sunday-deficit:{index}:{day_index}')
        model.add(total == expression - low)
        remember(model, values, total, current - low)
        square = model.new_int_var(0, (high - low) ** 2, f'sunday-deficit-square:{index}:{day_index}')
        model.add_multiplication_equality(square, [total, total])
        remember(model, values, square, (current - low) ** 2)
        secondary.append(square + 2 * low * total)
    return SundayPeakPlan(weight * sum(primary) + sum(secondary), peaks, neighborhoods)
