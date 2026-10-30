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
        if shortage > 0 and len(selected | set(members)) <= limit:
            selected.update(members)
    return selected


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
    protected_groups, active_groups = protected_groups or {}, []
    model.clear_hints()
    for variable in variables:
        model.add_hint(variable, values[variable.index])
    for index, objective in enumerate(objectives):
        if control is not None:
            control.checkpoint()
        remaining = deadline - time.monotonic() - 0.10
        if remaining < 0.1:
            proven = False
            break
        model.minimize(objective)
        active_groups.extend(protected_groups.get(names[index], []))
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
        later = len(objectives) - index - 1
        reserve = min(0.12 * later, remaining * 0.5)
        budget = remaining if not later else min(remaining - reserve, max(0.1, remaining * (0.55 if index == 0 else 0.5)))
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
            weeks = (len(dates) + 6) // 7
            first = (index - 1) % weeks
            movable_weeks = sorted({first, (first + 1) % weeks})
            movable = {day for week in movable_weeks for day in dates[week * 7:week * 7 + 7]}
            # Sunday exchanges need both dates and their surrounding weekly rests.
            # Free selected complete groups for all weeks, not an isolated Sunday.
            for variable in variables:
                if control is not None:
                    control.checkpoint()
                if variable.index in decision_variables:
                    person, day = decision_variables[variable.index]
                    fixed = person not in movable_people if movable_people else day not in movable
                    if fixed:
                        search_model.add(search_model.get_int_var_from_proto_index(variable.index) == values[variable.index])
        budget = min(budget, deadline - time.monotonic() - 0.10)
        if budget < 0.05:
            proven = False
            break
        engine.parameters.max_time_in_seconds = budget
        started = time.monotonic()
        status = engine.solve(search_model) if control is None else control.solve(engine, search_model)
        phase = {'objective': names[index], 'status': engine.status_name(status),
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
            break
        values = {variable.index: engine.value(variable) for variable in variables}
        best = engine.value(objective)
        # Later goals may incidentally improve earlier ones. Keep that gain too.
        for previous, previous_terms in visited:
            model.add(previous <= _linear_value(previous_terms, values))
        for variable in active_groups:
            model.add(variable <= Snapshot(values).value(variable))
        phase.update(incumbentValue=best, bestBound=engine.best_objective_bound)
        model.clear_hints()
        for variable in variables:
            model.add_hint(variable, values[variable.index])
        if status == cp_model.OPTIMAL and not restricted:
            model.add(objective == best)
        else:
            proven = False
            # Preserve the best higher-priority incumbent, while reserving time for operational balance.
            # This is bounded lexicographic improvement, not proof that any unfinished objective is optimal.
            model.add(objective <= best)
    return values, proven, phases
