"""Bounded lexicographic improvement from a complete, known-feasible incumbent."""
import time
import re
from ortools.sat.python import cp_model


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


def _movable_people(variables, values, groups, limit=36):
    """Release comparable groups across the month, including tied extremes.

    A single high/low pair cannot improve a max-minus-min objective when peers
    share either extreme. Keep the complete group within the search budget.
    """
    rates = {v.name[len('weekend-rate:6:'):]: values[v.index] for v in variables
             if v.name.startswith('weekend-rate:6:')}
    ranked = []
    for members in groups:
        eligible = sorted(pid for pid in members if pid in rates)
        if len(eligible) > 1:
            spread = max(rates[pid] for pid in eligible) - min(rates[pid] for pid in eligible)
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


def _coverage_people(groups, shortages, values, limit=36):
    """Release the complete sectors with the largest remaining Sunday shortage.

    Keep every week movable: transferring one Sunday's rest can require an
    exchange with a distant week to preserve each person's Sunday rotation.
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


def _polish_people(variables, values, groups, limit=18):
    """One bounded sector, across every week, prioritizing changed people."""
    changed = {v.name[len('changed:'):]: values[v.index] for v in variables if v.name.startswith('changed:')}
    ranked = sorted((sum(changed.get(pid, 0) for pid in members), tuple(sorted(members)))
                    for members in groups if members)
    if not ranked:
        return set()
    members = ranked[-1][1]
    return set(sorted(members, key=lambda pid: (-changed.get(pid, 0), pid))[:limit])


def _expression_terms(objective):
    expression = cp_model.FlatIntExpr(objective)
    return tuple(v.index for v in expression.vars), tuple(expression.coeffs), int(expression.offset)


def _phase_budget(remaining, names, index):
    """Keep coverage first, without geometrically starving the last real goals."""
    if index == len(names) - 1:
        return remaining
    if names[index] == 'COVERAGE':
        return remaining * .55
    return remaining * .5


def improve(model, objectives, values, deadline, names=None, control=None, protected_groups=None, employee_groups=None, decision_variables=None, coverage_groups=None, sunday_coverage=None):
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
    names = names or [f'OBJECTIVE_{i + 1}' for i in range(len(objectives))]
    secondary = {'SATURDAY_BALANCE', 'REST_DISTRIBUTION', 'REST_ROTATION', 'PEOPLE_CHANGED',
                 'STABILITY', 'PREFERENCES', 'TIE_BREAK'}
    plans = [(name, objective, []) for name, objective in zip(names, objectives)]
    first = next((i for i, name in enumerate(names) if name in secondary), len(names))
    if len(names) - first > 1 and all(name in secondary for name in names[first:]):
        plans = plans[:first] + [('SECONDARY_POLISH', None, list(zip(names[first:], objectives[first:])))]
    names = [name for name, _objective, _members in plans]
    protected_groups, active_groups = protected_groups or {}, []
    # Original variable domains do not change during improve. Neighborhoods fix
    # only cloned domains and must never populate or read this cache.
    domain_bounds = {}
    _replace_hints(model, values)
    for index, (name, objective, members) in enumerate(plans):
        if control is not None:
            control.checkpoint()
        remaining = deadline - time.monotonic() - 0.10
        if remaining < 0.1:
            proven = False
            break
        preparation_started = time.monotonic()
        member_values = []
        if members:
            weighted = []
            for member_name, member in members:
                initial = Snapshot(values).value(member)
                model.add(member <= initial)
                floor = _objective_floor(model, _expression_terms(member), domain_bounds)
                weight = max(1, min(1000, 100000 // max(1, initial - floor)))
                weighted.append(weight * member)
                member_values.append({'objective': member_name, 'initialValue': initial, 'incumbentValue': initial})
            objective = sum(weighted)
            # Joint dominance improvement is not a lexicographic optimality proof.
            proven = False
        model.minimize(objective)
        active_groups.extend(protected_groups.get(names[index], []))
        for member_name, _member in members:
            active_groups.extend(protected_groups.get(member_name, []))
        for variable in active_groups:
            model.add(variable <= Snapshot(values).value(variable))
        if len(active_groups) > 1:
            # Per-group no-regression narrows the global lexicographic search.
            proven = False
        # CpObjectiveProto stores the integer linear objective before presolve.
        proto = model.proto.objective
        terms = (tuple(proto.vars), tuple(proto.coeffs), int(proto.offset))
        visited.append((objective, terms))
        incumbent = _linear_value(terms, values)
        # A new search may not worsen even its own goal relative to the known draft.
        model.add(objective <= incumbent)
        lower = _objective_floor(model, terms, domain_bounds)
        if lower == incumbent:
            model.add(objective == incumbent)
            phases.append({'objective': names[index], 'status': 'OPTIMAL',
                           'wallTimeSeconds': 0, 'budgetSeconds': 0, 'initialValue': incumbent,
                           'incumbentValue': incumbent, 'bestBound': lower, 'searchScope': 'GLOBAL'})
            if members:
                phases[-1]['members'] = member_values
            continue
        budget = _phase_budget(remaining, names, index)
        engine = cp_model.CpSolver()
        engine.parameters.max_time_in_seconds = budget
        engine.parameters.num_workers = 1
        engine.parameters.random_seed = 37
        # Keep propagation, but avoid rebuilding the large LP relaxation in each
        # short phase. The verified complete hint can enter CP search promptly.
        engine.parameters.cp_model_presolve = True
        engine.parameters.linearization_level = 0
        engine.parameters.keep_all_feasible_solutions_in_presolve = True
        engine.parameters.symmetry_level = 0
        search_model = model
        restricted = index > 0 and len(variables) > 3000 and len(dates) > 7
        if restricted:
            # Keep the joint model, including leadership and all cross-week constraints.
            search_model = model.clone()
            movable_people = (_movable_people(variables, values, employee_groups or [])
                              if names[index] == 'SUNDAY_BALANCE' else set())
            if names[index] == 'SUNDAY_COVERAGE':
                movable_people = _coverage_people(coverage_groups or {}, sunday_coverage or {}, values)
            if name == 'SECONDARY_POLISH':
                movable_people = _polish_people(variables, values, list((coverage_groups or {}).values()) or employee_groups or [])
            weeks = (len(dates) + 6) // 7
            first = (index - 1) % weeks
            movable_weeks = sorted({first, (first + 1) % weeks})
            movable = {day for week in movable_weeks for day in dates[week * 7:week * 7 + 7]}
            # Sunday exchanges need both dates and their surrounding weekly rests.
            # Free selected complete groups for all weeks, not an isolated Sunday.
            for offset, (variable_index, (person, day)) in enumerate(decision_variables.items()):
                if control is not None and offset % 128 == 0:
                    control.checkpoint()
                fixed = person not in movable_people if movable_people else day not in movable
                if fixed:
                    domain = search_model.proto.variables[variable_index].domain
                    domain.clear()
                    domain.extend([values[variable_index], values[variable_index]])
        # Model setup belongs to this phase's share, not the later objectives.
        # Do not start a presolve with too little time to use the known incumbent.
        budget = min(budget - (time.monotonic() - preparation_started), deadline - time.monotonic() - 0.10)
        if budget < 0.10:
            proven = False
            continue
        engine.parameters.max_time_in_seconds = budget
        started = time.monotonic()
        status = engine.solve(search_model) if control is None else control.solve(engine, search_model)
        phase = {'objective': names[index], 'status': engine.status_name(status),
                 'wallTimeSeconds': round(time.monotonic() - started, 3),
                 'budgetSeconds': round(budget, 3), 'initialValue': incumbent,
                 'incumbentValue': incumbent, 'searchScope': 'GLOBAL'}
        if members:
            phase['members'] = member_values
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
            break
        values = {variable.index: engine.value(variable) for variable in variables}
        for member, (_member_name, member_objective) in zip(member_values, members):
            member['incumbentValue'] = Snapshot(values).value(member_objective)
        best = engine.value(objective)
        # Later goals may incidentally improve earlier ones. Keep that gain too.
        for previous, previous_terms in visited:
            model.add(previous <= _linear_value(previous_terms, values))
        for variable in active_groups:
            model.add(variable <= Snapshot(values).value(variable))
        phase.update(incumbentValue=best, bestBound=engine.best_objective_bound)
        _replace_hints(model, values)
        if status == cp_model.OPTIMAL and not restricted:
            model.add(objective == best)
        else:
            proven = False
            # Preserve the best higher-priority incumbent, while reserving time for operational balance.
            # This is bounded lexicographic improvement, not proof that any unfinished objective is optimal.
            model.add(objective <= best)
    return values, proven, phases
