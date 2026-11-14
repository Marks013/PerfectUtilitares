"""Bounded lexicographic improvement from a complete, known-feasible incumbent."""
import time
import re
from dataclasses import dataclass
from ortools.sat.python import cp_model
from runtime_settings import (COVERAGE_BUDGET_SHARE, LARGE_MODEL_VARIABLES, MOVABLE_PEOPLE_LIMIT,
                              POLISH_PEOPLE_LIMIT, RANDOM_SEED, SearchSettings)

REST_PHASE_WEIGHT = 3
MIN_SEARCH_SECONDS = 0.10
# Admission includes preparation headroom; the actual search still has its
# own floor after setup. An admitted phase is not evidence of optimization.
MIN_PHASE_BUDGET = 2 * MIN_SEARCH_SECONDS


@dataclass
class ImprovementContext:
    control: object = None
    protected_groups: dict | None = None
    employee_groups: list | None = None
    decision_variables: dict | None = None
    coverage_groups: dict | None = None
    sunday_coverage: dict | None = None
    sector_coverage: dict | None = None
    initial_decision_hints: dict | None = None
    initial_repair_people: set | None = None
    initial_repair_groups: list | None = None
    repair_clock_fixes: dict | None = None
    closing_coverage: dict | None = None
    settings: SearchSettings | None = None
    movement_coverage: dict | None = None
    untimed_people: set | None = None
    rest_spacing: dict | None = None
    rest_spacing_groups: dict | None = None
    refinement_reserve_seconds: float = 0.0


class Snapshot:
    def __init__(self, values):
        self.values = values

    def value(self, variable):
        if isinstance(variable, int):
            return variable
        if isinstance(variable, cp_model.IntVar):
            return self.values[variable.index]
        expression = cp_model.FlatIntExpr(variable)
        if not expression.ok:
            raise ValueError('noninteger incumbent expression')
        return expression.offset + sum(coefficient * self.values[item.index]
                                       for item, coefficient in zip(expression.vars, expression.coeffs))


def remember(model, values, variable, value):
    if values is not None:
        values[variable.index] = int(value)
        model.add_hint(variable, int(value))


def _linear_value(terms, values):
    indexes, coefficients, offset = terms
    total = offset
    for index, coefficient in zip(indexes, coefficients):
        value = values[index] if index >= 0 else -values[-index - 1]
        total += coefficient * value
    return total


def _objective_floor(model, terms, domain_bounds=None):
    """A proven bound from integer domains, including negative coefficients."""
    indexes, coefficients, offset = terms
    lower = offset
    for index, coefficient in zip(indexes, coefficients):
        canonical = index if index >= 0 else -index - 1
        bounds = domain_bounds.get(canonical) if domain_bounds is not None else None
        if bounds is None:
            domain = tuple(model.proto.variables[canonical].domain)
            if not domain:
                return None
            bounds = domain[0], domain[-1]
            if domain_bounds is not None:
                domain_bounds[canonical] = bounds
        minimum, maximum = bounds
        if index < 0:
            minimum, maximum = -maximum, -minimum
        lower += coefficient * (minimum if coefficient >= 0 else maximum)
    return lower


def _movable_people(variables, values, groups, limit=MOVABLE_PEOPLE_LIMIT, weekday=6):
    """Release comparable groups across the month, including tied extremes.

    A single high/low pair cannot improve a max-minus-min objective when peers
    share either extreme. Keep the complete group within the search budget.
    """
    prefix = f'weekend-rate:{weekday}:'
    rates = {v.name[len(prefix):]: values[v.index] for v in variables
             if v.name.startswith(prefix)}
    date_prefix = f'weekend-date-spread:{weekday}:'
    date_spreads = {int(v.name[len(date_prefix):]): values[v.index] for v in variables
                    if v.name.startswith(date_prefix)}
    ranked = []
    for index, members in enumerate(groups):
        eligible = sorted(pid for pid in members if pid in rates)
        if len(eligible) > 1:
            spread = max(max(rates[pid] for pid in eligible) - min(rates[pid] for pid in eligible),
                         date_spreads.get(index, 0))
            if spread:
                ranked.append((spread, tuple(eligible)))
    selected = set()
    for _, members in sorted(ranked, reverse=True):
        if not selected and len(members) > limit:
            # A large tied group needs all its peers movable to lower its spread.
            # Release it alone; the overall model and wall-clock limits still apply.
            return set(members)
        if len(selected | set(members)) <= limit:
            selected.update(members)
    return selected


def _coverage_people(groups, shortages, values, limit=MOVABLE_PEOPLE_LIMIT):
    """Release complete sectors with the largest shortage for this phase.

    Keep every week movable so off-day exchanges can respect Sunday rotation.
    """
    snapshot = Snapshot(values)
    ranked = sorted(((snapshot.value(sum(shortages.get(sector, []))), sector, tuple(sorted(members)))
                     for sector, members in groups.items()), reverse=True)
    selected = set()
    for shortage, _sector, members in ranked:
        if shortage > 0 and not selected and len(members) > limit:
            return set(members)
        if shortage > 0 and len(selected | set(members)) <= limit:
            selected.update(members)
    return selected


def _replace_hints(model, values):
    # The complete incumbent already uses proto indexes. Avoid Python add_hint
    # calls for every auxiliary variable between short optimization phases.
    model.clear_hints()
    model.proto.solution_hint.vars.extend(values.keys())
    model.proto.solution_hint.values.extend(values.values())


def _spacing_people(groups, spacing, values):
    """Release whole sectors whose members retain adjacent OFFs, including ENC."""
    snapshot = Snapshot(values)
    ranked = sorted((snapshot.value(sum(term for pid in members for term in spacing.get(pid, []))),
                     sector, tuple(sorted(members))) for sector, members in groups.items())
    selected = set()
    for score, _sector, members in reversed(ranked):
        if score <= 0:
            continue
        if not selected and len(members) > MOVABLE_PEOPLE_LIMIT:
            return set(members)
        if len(selected | set(members)) <= MOVABLE_PEOPLE_LIMIT:
            selected.update(members)
    return selected


def _polish_people(variables, values, groups, limit=POLISH_PEOPLE_LIMIT, coverage_groups=None,
                   shortages=None, sunday_shortages=None, attempt=0):
    """Rotate bounded sectors by Sunday/total deficit before cosmetic stability."""
    changed = {v.name[len('changed:'):]: values[v.index] for v in variables if v.name.startswith('changed:')}
    ranked = sorted((sum(changed.get(pid, 0) for pid in members), tuple(sorted(members)))
                    for members in groups if members)
    stable = (set(sorted(ranked[-1][1], key=lambda pid: (-changed.get(pid, 0), pid))[:limit])
              if ranked else set())
    snapshot = Snapshot(values)
    deficient = []
    for sector, members in (coverage_groups or {}).items():
        if not members:
            continue
        total = snapshot.value(sum((shortages or {}).get(sector, [])))
        sunday = snapshot.value(sum((sunday_shortages or {}).get(sector, [])))
        if total > 0 or sunday > 0:
            members = tuple(sorted(members))
            deficient.append((sunday, total, sum(changed.get(pid, 0) for pid in members), sector, members))
    if deficient:
        members = sorted(deficient, reverse=True)[attempt % len(deficient)][-1]
        # Keep all exchange partners in normal supermarket sectors. Larger
        # sectors retain a bounded neighborhood rather than growing the budget.
        # Separate attempts release different sectors, not one expensive union.
        return set(sorted(members, key=lambda pid: (-changed.get(pid, 0), pid))[:MOVABLE_PEOPLE_LIMIT])
    return stable


def _expression_terms(objective):
    expression = cp_model.FlatIntExpr(objective)
    return tuple(v.index for v in expression.vars), tuple(expression.coeffs), int(expression.offset)


def _upper_bound_key(terms):
    indexes, coefficients, _offset = terms
    combined = {}
    for index, coefficient in zip(indexes, coefficients):
        canonical = index if index >= 0 else -index - 1
        coefficient = coefficient if index >= 0 else -coefficient
        combined[canonical] = combined.get(canonical, 0) + coefficient
    return tuple(sorted((index, coefficient) for index, coefficient in combined.items()
                        if coefficient))


def _phase_budget(remaining, names, index):
    """Fund one ordered prefix, then share surplus without duplicate reserves.

    Repeated COVERAGE repairs share one allocation. When all active goals fit,
    each keeps preparation headroom plus the search floor; short budgets fund
    only an earlier prefix. Later phases stay unattempted, never falsely proven.
    """
    pending = list(dict.fromkeys(names[index:]))
    # Keep the coverage share unchanged. Within its secondary reserve, fund
    # pending operational goals first; cosmetics receive only actual residual.
    if names[index] != 'COVERAGE':
        cosmetic = {'PEOPLE_CHANGED', 'STABILITY', 'PREFERENCES', 'TIE_BREAK'}
        operational = [name for name in pending if name not in cosmetic]
        if operational:
            if names[index] in cosmetic:
                return 0.0
            pending = operational
    affordable = max(0, int((remaining + 1e-9) / MIN_PHASE_BUDGET))
    admitted = pending[:affordable]
    if not admitted:
        return 0.0
    if len(admitted) == 1:
        return remaining
    if admitted[0] == 'COVERAGE':
        reserve = MIN_PHASE_BUDGET * (len(admitted) - 1)
        return max(MIN_PHASE_BUDGET, min(remaining * COVERAGE_BUDGET_SHARE, remaining - reserve))
    # Sunday recovery, spacing and untimed rotation share the SAME surplus.
    # Leadership and every other admitted phase retain their usable base share.
    weights = [REST_PHASE_WEIGHT if name in ('SUNDAY_COVERAGE', 'REST_SPACING', 'UNTIMED_ROTATION') else 1
               for name in admitted]
    surplus = max(0.0, remaining - MIN_PHASE_BUDGET * len(admitted))
    return MIN_PHASE_BUDGET + surplus * weights[0] / sum(weights)


def _reserved_refinement_names(names):
    # Both Sunday searches need their own net time. Spacing retains the former
    # fallback when this model has no Sunday objective at all.
    sunday = {'SUNDAY_COVERAGE', 'SUNDAY_BALANCE'} & set(names)
    return sunday or {'REST_SPACING'}


def _future_refinement_reserve(names, index, reserve, preparation):
    pending = set(names[index:]) & _reserved_refinement_names(names)
    return len(pending) * (reserve + preparation) if reserve > 0 else 0.0


def _refinement_phase_budget(remaining, names, index, reserve,
                             preparation=MIN_PHASE_BUDGET):
    """Allocate net Sunday search plus charged setup inside the same deadline.

    The existing reserve is per Sunday objective, not a gross share consumed by
    cloning. Earlier phases, including coverage retries, leave both allocations.
    Preparation headroom starts at the existing admission floor and grows to the
    largest setup actually observed in this run; it is never extra wall time.
    """
    budget = _phase_budget(remaining, names, index)
    if reserve <= 0:
        return budget
    future = _future_refinement_reserve(names, index + 1, reserve, preparation)
    if names[index] in _reserved_refinement_names(names):
        budget = max(budget, reserve + preparation)
    return min(budget, max(0.0, remaining - future))


def improve(model, objectives, values, deadline, names=None, *, context=None):
    if names is not None and len(names) != len(objectives):
        raise ValueError('objective/name count mismatch')
    context = context or ImprovementContext()
    control, protected_groups = context.control, context.protected_groups
    employee_groups, decision_variables = context.employee_groups, context.decision_variables
    coverage_groups, sunday_coverage = context.coverage_groups, context.sunday_coverage
    sector_coverage, closing_coverage = context.sector_coverage, context.closing_coverage
    initial_decision_hints = context.initial_decision_hints
    initial_repair_people, initial_repair_groups = context.initial_repair_people, context.initial_repair_groups
    repair_clock_fixes = context.repair_clock_fixes
    settings = context.settings or SearchSettings.from_environment()
    variables = [model.get_int_var_from_proto_index(i) for i in range(len(model.proto.variables))]
    if len(values) != len(variables):
        raise ValueError('incomplete optimization incumbent')
    phases, visited, proven = [], [], True
    if decision_variables is None:
        decision_variables = {}
        for variable in variables:
            match = re.match(r'^[ows]:(.*):(\d{4}-\d{2}-\d{2})(?::.*)?$', variable.name)
            if match:
                decision_variables[variable.index] = match.group(1), match.group(2)
    dates = sorted({day for _pid, day in decision_variables.values()})
    names = [f'OBJECTIVE_{i + 1}' for i in range(len(objectives))] if names is None else names
    secondary = {'SATURDAY_BALANCE', 'REST_DISTRIBUTION', 'REST_ROTATION', 'PEOPLE_CHANGED',
                 'STABILITY', 'PREFERENCES', 'TIE_BREAK'}
    # Lower-priority stability and tie-breaking must be allowed to yield to better
    # operational balance. Freezing every member at its initial value turns a
    # stable incumbent into an immovable roster, even when rests can improve.
    plans = list(zip(names, objectives))
    repair_groups = initial_repair_groups or ([initial_repair_people] if initial_repair_people else [])
    repair_groups = ([set(group) for group in repair_groups[:4] if group]
                     if plans and plans[0][0] == 'COVERAGE'
                     and dates and deadline - time.monotonic() >= 2 else [])
    repair_count = len(repair_groups)
    # A cheap upper estimate of neighborhood cost, including clock alternatives.
    # Count once; no extra model, solve or commercial staffing heuristic.
    decision_costs = {}
    for person, _day in decision_variables.values():
        decision_costs[person] = decision_costs.get(person, 0) + 1
    repair_costs = [max(1, sum(decision_costs.get(person, 0) for person in group)
                        or len(group)) for group in repair_groups]
    if repair_count:
        plans = [plans[0]] * repair_count + plans
    names = [name for name, _objective in plans]
    # All repeated repairs and the main COVERAGE phase share one allowance,
    # computed from the full active sequence, including both rest objectives.
    budget_started = time.monotonic()
    coverage_cutoff = budget_started + (_refinement_phase_budget(
        max(0, deadline - budget_started - MIN_SEARCH_SECONDS), names, 0,
        context.refinement_reserve_seconds)
        if names and names[0] == 'COVERAGE' else 0)
    polish_attempt = 0
    preparation_allowance = MIN_PHASE_BUDGET
    protected_groups, active_groups = protected_groups or {}, {}
    registered_groups = {}
    active_group_count, upper_bounds = 0, {}

    def add_upper_bound(expression, terms, key, value):
        limit = value - terms[2]
        previous = upper_bounds.get(key)
        if previous is None or limit < previous:
            model.add(expression <= value)
            upper_bounds[key] = limit

    # Original variable domains do not change during improve. Neighborhoods fix
    # only cloned domains and must never populate or read this cache.
    domain_bounds = {}
    objective_cache = {}
    current_objective = None
    _replace_hints(model, values)
    if initial_decision_hints:
        # Hints never replace the feasible incumbent used by all no-regression
        # bounds. Auxiliary values are omitted because the decision hint changed.
        model.clear_hints()
        model.proto.solution_hint.vars.extend(decision_variables.keys())
        model.proto.solution_hint.values.extend(
            initial_decision_hints.get(variable_index, values[variable_index])
            for variable_index in decision_variables)
    for index, (name, objective) in enumerate(plans):
        repair_phase = index < repair_count
        phase_index = index - repair_count
        if index == repair_count and initial_decision_hints:
            _replace_hints(model, values)
        if control is not None:
            control.checkpoint()
        remaining = deadline - time.monotonic() - 0.10
        if remaining < 0.1:
            proven = False
            break
        preparation_started = time.monotonic()
        # Consecutive sector repairs reuse the exact same coverage expression.
        # Flatten its coefficients and domain floor once, not once per clone.
        if objective is not current_objective:
            model.minimize(objective)
            current_objective = objective
        new_groups = list(protected_groups.get(names[index], []))
        # Count original group provenance for the conservative proof metadata,
        # but only register each equivalent expression once for propagation.
        active_group_count += len(new_groups)
        for variable in new_groups:
            identity = id(variable)
            if identity in registered_groups:
                continue
            # Keep a reference for the lifetime of the identity cache.
            registered_groups[identity] = variable
            terms = _expression_terms(variable)
            active_groups.setdefault(_upper_bound_key(terms), (variable, terms))
        for key, (variable, variable_terms) in active_groups.items():
            add_upper_bound(variable, variable_terms, key, _linear_value(variable_terms, values))
        if active_group_count > 1:
            # Per-group no-regression narrows the global lexicographic search.
            proven = False
        # CpObjectiveProto stores the integer linear objective before presolve.
        cached = objective_cache.get(id(objective))
        if cached is None:
            proto = model.proto.objective
            terms = (tuple(proto.vars), tuple(proto.coeffs), int(proto.offset))
            objective_key = _upper_bound_key(terms)
            lower = _objective_floor(model, terms, domain_bounds)
            objective_cache[id(objective)] = terms, objective_key, lower
        else:
            terms, objective_key, lower = cached
        visited.append((objective, terms, objective_key))
        incumbent = _linear_value(terms, values)
        # A new search may not worsen even its own goal relative to the known draft.
        add_upper_bound(objective, terms, objective_key, incumbent)
        if lower == incumbent:
            if repair_phase:
                continue
            model.add(objective == incumbent)
            phases.append({'objective': names[index], 'status': 'OPTIMAL',
                           'wallTimeSeconds': 0, 'budgetSeconds': 0, 'initialValue': incumbent,
                           'incumbentValue': incumbent, 'bestBound': lower, 'searchScope': 'GLOBAL'})
            continue
        budget = _refinement_phase_budget(remaining, names, index,
                                          context.refinement_reserve_seconds,
                                          preparation_allowance)
        if repair_phase:
            # Share the SAME coverage deadline by remaining decision cost.
            # Early completion releases time to the next repair; global search
            # gets only a usable residual, never a second reservation.
            coverage_remaining = max(0, coverage_cutoff - time.monotonic())
            budget = coverage_remaining * repair_costs[index] / sum(repair_costs[index:])
        if name == 'COVERAGE':
            budget = min(budget, max(0, coverage_cutoff - time.monotonic()))
        if budget < preparation_allowance + MIN_SEARCH_SECONDS - 1e-9:
            proven = False
            continue  # No clone/presolve for a phase without a usable allocation.
        engine = cp_model.CpSolver()
        engine.parameters.max_time_in_seconds = budget
        engine.parameters.num_workers = settings.workers
        engine.parameters.random_seed = RANDOM_SEED
        # Keep propagation, but avoid rebuilding the large LP relaxation in each
        # short phase. The verified complete hint can enter CP search promptly.
        engine.parameters.cp_model_presolve = True
        engine.parameters.linearization_level = settings.linearization
        engine.parameters.keep_all_feasible_solutions_in_presolve = True
        engine.parameters.symmetry_level = settings.symmetry
        search_model = model
        # A generic improvement model may have no calendar decisions. Keep it
        # global instead of constructing an empty rolling-week neighborhood.
        restricted = bool(dates) and (repair_phase or name in ('REST_SPACING', 'UNTIMED_ROTATION')
                      or (phase_index > 0 and len(variables) > LARGE_MODEL_VARIABLES and len(dates) > 7))
        if restricted:
            # Keep the joint model, including leadership and all cross-week constraints.
            search_model = model.clone()
            movable_people = (_movable_people(variables, values, employee_groups or [])
                              if names[index] == 'SUNDAY_BALANCE' else set())
            if names[index] == 'SUNDAY_COVERAGE':
                movable_people = _coverage_people(coverage_groups or {}, sunday_coverage or {}, values)
            if names[index] == 'CLOSING_COVERAGE':
                movable_people = _coverage_people(coverage_groups or {}, closing_coverage or {}, values)
            if names[index] == 'UNTIMED_ROTATION':
                movable_people = set(context.untimed_people or [])
            if names[index] == 'MOVEMENT_COVERAGE':
                movable_people = _coverage_people(coverage_groups or {}, context.movement_coverage or {}, values)
            if names[index] == 'REST_SPACING':
                movable_people = _spacing_people(context.rest_spacing_groups or coverage_groups or {},
                                                 context.rest_spacing or {}, values)
                if not movable_people:
                    movable_people = {pid for pid, terms in (context.rest_spacing or {}).items()
                                      if Snapshot(values).value(sum(terms)) > 0}
            if name in secondary and name != 'SATURDAY_BALANCE':
                movable_people = _polish_people(variables, values, list((coverage_groups or {}).values()) or employee_groups or [],
                                                coverage_groups=coverage_groups, shortages=sector_coverage,
                                                sunday_shortages=sunday_coverage, attempt=polish_attempt)
                polish_attempt += 1
            if name == 'SATURDAY_BALANCE':
                movable_people = _movable_people(variables, values, employee_groups or [], weekday=5)
            if repair_phase:
                movable_people = repair_groups[index]
            weeks = (len(dates) + 6) // 7
            first = (phase_index - 1) % weeks
            movable_weeks = sorted({first, (first + 1) % weeks})
            movable = {day for week in movable_weeks for day in dates[week * 7:week * 7 + 7]}
            # Sunday exchanges need both dates and their surrounding weekly rests.
            # Free selected complete groups for all weeks, not an isolated Sunday.
            for offset, (variable_index, (person, day)) in enumerate(decision_variables.items()):
                if control is not None and offset % 128 == 0:
                    control.checkpoint()
                fixed = person not in movable_people if movable_people else day not in movable
                narrowed_clock = (repair_phase and len(movable_people) > 16
                                  and person in movable_people
                                  and variable_index in (repair_clock_fixes or {}))
                fixed = fixed or narrowed_clock
                if fixed:
                    domain = search_model.proto.variables[variable_index].domain
                    domain.clear()
                    value = repair_clock_fixes[variable_index] if narrowed_clock else values[variable_index]
                    domain.extend([value, value])
        # Charge all preparation, including guard registration and cloning.
        # Recheck the absolute deadline AFTER setup. Earlier phases cannot spend
        # a later Sunday's net search reserve through either setup or solving.
        prepared = time.monotonic()
        preparation_seconds = prepared - preparation_started
        preparation_allowance = max(preparation_allowance, preparation_seconds)
        future_reserve = _future_refinement_reserve(
            names, index + 1, context.refinement_reserve_seconds, preparation_allowance)
        available = max(0.0, deadline - prepared - MIN_SEARCH_SECONDS - future_reserve)
        budget -= preparation_seconds
        if (context.refinement_reserve_seconds > 0
                and name in _reserved_refinement_names(names)):
            # Recover the setup cost from unspent shared time, never by extending
            # the deadline or taking the next Sunday's reserved allocation.
            budget = max(budget, context.refinement_reserve_seconds)
        budget = min(budget, available)
        if budget < MIN_SEARCH_SECONDS:
            proven = False
            continue
        engine.parameters.max_time_in_seconds = budget
        started = time.monotonic()
        status = engine.solve(search_model) if control is None else control.solve(engine, search_model)
        phase = {'objective': names[index], 'status': engine.status_name(status),
                 'workers': settings.workers,
                 'linearizationLevel': settings.linearization,
                 'symmetryLevel': settings.symmetry,
                 'preparationSeconds': round(preparation_seconds, 3),
                 'wallTimeSeconds': round(time.monotonic() - started, 3),
                 'budgetSeconds': round(budget, 3), 'initialValue': incumbent,
                 'incumbentValue': incumbent, 'searchScope': 'GLOBAL'}
        if restricted:
            phase['searchScope'] = 'SELECTED_PEOPLE' if movable_people else 'ROLLING_WEEKS'
            if movable_people:
                phase['movablePeople'] = len(movable_people)
            else:
                phase['movableWeeks'] = len(movable_weeks)
        phases.append(phase)
        if status == cp_model.UNKNOWN:
            # The incumbent and its bound remain valid. Use remaining time below it.
            proven = False
            continue
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            proven = False
            if repair_phase:
                continue
            break
        values = {variable.index: engine.value(variable) for variable in variables}
        best = engine.value(objective)
        # Later goals may incidentally improve earlier ones. Keep that gain too.
        for previous, previous_terms, key in visited:
            add_upper_bound(previous, previous_terms, key, _linear_value(previous_terms, values))
        for key, (variable, variable_terms) in active_groups.items():
            add_upper_bound(variable, variable_terms, key, _linear_value(variable_terms, values))
        phase.update(incumbentValue=best, bestBound=engine.best_objective_bound)
        _replace_hints(model, values)
        if status == cp_model.OPTIMAL and not restricted:
            model.add(objective == best)
        else:
            proven = False
            # Preserve the best higher-priority incumbent, while reserving time for operational balance.
            # This is bounded lexicographic improvement, not proof that any unfinished objective is optimal.
            add_upper_bound(objective, terms, objective_key, best)
    return values, proven, phases
