"""Bounded lexicographic improvement from a complete, known-feasible incumbent."""
import time
from datetime import date
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
            raise ValueError("noninteger incumbent expression")
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


def _movable_weeks(variables, values, dates, phase_name, index):
    """Release two weeks together without dropping any joint-model constraint."""
    weeks = [dates[start:start + 7] for start in range(0, len(dates), 7)]
    if len(weeks) <= 2:
        return list(range(len(weeks)))
    first = (index - 1) % len(weeks)
    if phase_name == 'SUNDAY_BALANCE':
        rates = {v.name[len('weekend-rate:6:'):]: values[v.index] for v in variables
                 if v.name.startswith('weekend-rate:6:')}
        occupancy = {v.name[len('weekend-occupied:'):]: values[v.index] for v in variables
                     if v.name.startswith('weekend-occupied:')}
        pressure = []
        for week, days in enumerate(weeks):
            sundays = {day for day in days if date.fromisoformat(day).weekday() == 6}
            # High-rate workers present while lower-rate colleagues rest offer useful exchanges.
            score = sum((2 * present - 1) * rates.get(key.rsplit(':', 1)[0], 0)
                        for key, present in occupancy.items() if key.rsplit(':', 1)[-1] in sundays)
            pressure.append((score, -week))
        selected = sorted(range(len(weeks)), key=lambda week: pressure[week], reverse=True)[:2]
        return sorted(selected)
    return sorted({first, (first + 1) % len(weeks)})


def _movable_people(variables, values, groups, limit=8):
    rates = {v.name[len('weekend-rate:6:'):]: values[v.index] for v in variables
             if v.name.startswith('weekend-rate:6:')}
    candidates = []
    for members in groups:
        ordered = sorted((rates[pid], pid) for pid in members if pid in rates)
        if len(ordered) > 1 and ordered[-1][0] > ordered[0][0]:
            candidates.append((ordered[-1][0] - ordered[0][0], ordered[0][1], ordered[-1][1]))
    selected = set()
    for _, low, high in sorted(candidates, reverse=True):
        if len(selected | {low, high}) > limit:
            break
        selected.update((low, high))
    return selected


def improve(model, objectives, values, deadline, names=None, protected_groups=None, control=None, phase_offset=0, employee_groups=None):
    if control is not None:
        control.checkpoint()
    variables = [model.get_int_var_from_proto_index(i) for i in range(len(model.proto.variables))]
    if len(values) != len(variables):
        raise ValueError('incomplete optimization incumbent')
    phases, visited, proven = [], [], True
    dates = sorted({variable.name.rsplit(':', 1)[-1] for variable in variables
                    if variable.name.startswith('o:')})
    names = names or [f'OBJECTIVE_{i + 1}' for i in range(len(objectives))]
    protected_groups, active_groups = protected_groups or {}, []
    model.clear_hints()
    for variable in variables:
        model.add_hint(variable, values[variable.index])
    for index, objective in enumerate(objectives):
        if control is not None:
            control.checkpoint()
        rank = index + phase_offset
        remaining = deadline - time.monotonic() - 0.10
        if remaining < 0.1:
            proven = False
            break
        model.minimize(objective)
        # CpObjectiveProto stores the integer linear objective before presolve.
        proto = model.proto.objective
        terms = (tuple(proto.vars), tuple(proto.coeffs), int(proto.offset))
        visited.append((objective, terms))
        incumbent = _linear_value(terms, values)
        # A new search may not worsen even its own goal relative to the known draft.
        model.add(objective <= incumbent)
        later = len(objectives) - index - 1
        reserve = min(0.12 * later, remaining * 0.5)
        budget = remaining if not later else min(remaining - reserve, max(0.1, remaining * (0.55 if rank == 0 else 0.5)))
        engine = cp_model.CpSolver()
        engine.parameters.max_time_in_seconds = budget
        engine.parameters.num_workers = 1
        engine.parameters.random_seed = 37
        # Preserve the incumbent when presolve would discard equivalent feasible assignments.
        engine.parameters.cp_model_presolve = True
        engine.parameters.keep_all_feasible_solutions_in_presolve = True
        engine.parameters.symmetry_level = 0
        search_model = model
        restricted = rank > 0 and len(variables) > 3000 and len(dates) > 14
        movable_weeks = []
        movable_people = _movable_people(variables, values, employee_groups or []) if names[index] == "SUNDAY_BALANCE" else set()
        if restricted:
            # Keep the joint model, including leadership and all cross-week constraints.
            # Two weeks permit exchanges that a single frozen neighboring week would forbid.
            search_model = model.clone()
            movable_weeks = _movable_weeks(variables, values, dates, names[index], rank)
            # A two-week neighborhood needs enough time to pass presolve. Start small
            # under a short phase budget; larger instances otherwise return UNKNOWN.
            if budget < 3.5 and len(model.proto.constraints) > 3000:
                movable_weeks = [(rank - 1) % ((len(dates) + 6) // 7)]
            movable = {day for week in movable_weeks for day in dates[week * 7:week * 7 + 7]}
            for variable in variables:
                if control is not None:
                    control.checkpoint()
                name = variable.name
                if name.startswith(('o:', 'w:', 's:')):
                    day = name.rsplit(':', 1)[-1] if not name.startswith('s:') else name.split(':')[-2]
                    movable_person = any(name.startswith(prefix + pid + ":") for pid in movable_people for prefix in ("o:", "w:", "s:"))
                    if (not movable_person if movable_people else day not in movable):
                        search_model.add(search_model.get_int_var_from_proto_index(variable.index) == values[variable.index])
        budget = min(budget, deadline - time.monotonic() - 0.10)
        if budget < 0.05:
            proven = False
            break
        if control is not None:
            control.checkpoint()
        engine.parameters.max_time_in_seconds = budget
        started = time.monotonic()
        status = engine.solve(search_model) if control is None else control.solve(engine, search_model)
        phase = {'objective': names[index], 'status': engine.status_name(status),
                 'wallTimeSeconds': round(time.monotonic() - started, 3),
                 'budgetSeconds': round(budget, 3), 'initialValue': incumbent,
                 'incumbentValue': incumbent, 'searchScope': ('SELECTED_PEOPLE' if movable_people else 'ROLLING_WEEKS') if restricted else 'GLOBAL'}
        if restricted:
            if movable_people:
                phase['movablePeople'] = len(movable_people)
            else:
                phase['movableWeeks'] = len(movable_weeks)
        phases.append(phase)
        active_groups.extend(protected_groups.get(names[index], []))
        if len(active_groups) > 1:
            # Per-group protection narrows later redistribution beyond a scalar sum.
            # Do not describe the resulting incumbent as a global lexicographic proof.
            proven = False
        if status == cp_model.UNKNOWN:
            # The incumbent and its bound remain valid. Use remaining time below it.
            proven = False
            for variable in active_groups:
                model.add(variable <= values[variable.index])
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
            model.add(variable <= values[variable.index])
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
    if control is not None:
        control.checkpoint()
    return values, proven, phases
