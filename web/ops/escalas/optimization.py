"""Bounded lexicographic improvement from a complete, known-feasible incumbent."""
import time
from ortools.sat.python import cp_model


class Snapshot:
    def __init__(self, values):
        self.values = values

    def value(self, variable):
        return variable if isinstance(variable, int) else self.values[variable.index]


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


def improve(model, objectives, values, deadline, names=None, control=None):
    variables = [model.get_int_var_from_proto_index(i) for i in range(len(model.proto.variables))]
    if len(values) != len(variables):
        raise ValueError('incomplete optimization incumbent')
    phases, visited, proven = [], [], True
    dates = sorted({variable.name.rsplit(':', 1)[-1] for variable in variables
                    if variable.name.startswith('o:')})
    names = names or [f'OBJECTIVE_{i + 1}' for i in range(len(objectives))]
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
        # Preserve the incumbent when presolve would discard equivalent feasible assignments.
        engine.parameters.cp_model_presolve = True
        engine.parameters.keep_all_feasible_solutions_in_presolve = True
        engine.parameters.symmetry_level = 0
        search_model = model
        restricted = index > 0 and len(variables) > 3000 and len(dates) > 7
        if restricted:
            # Keep the joint model, including leadership and all cross-week constraints.
            # A rolling week neighborhood makes short later phases useful on real teams.
            search_model = model.clone()
            week = (index - 1) % ((len(dates) + 6) // 7)
            movable = set(dates[week * 7:week * 7 + 7])
            for variable in variables:
                name = variable.name
                if name.startswith(('o:', 'w:', 's:')):
                    day = name.rsplit(':', 1)[-1] if not name.startswith('s:') else name.split(':')[-2]
                    if day not in movable:
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
                 'budgetSeconds': round(budget, 3), 'incumbentValue': incumbent}
        if restricted:
            phase["searchScope"] = "ROLLING_WEEK"
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
