"""Bounded sufficient conflict sets; original constraints are never relaxed."""
import time
from ortools.sat.python import cp_model

MESSAGES = {
    "AVAILABILITY": "A disponibilidade não combina com os dias que precisam ser trabalhados. Confira afastamentos e dias permitidos.",
    "BLOCKS": "Dias ou horários fixados entram em conflito com a proposta. Confira as marcações bloqueadas.",
    "DAYS_WORKED": "Não é possível distribuir os cinco dias de trabalho com as folgas e os bloqueios atuais.",
    "WEEKLY_MINUTES": "Os horários permitidos não conseguem completar a jornada semanal escolhida.",
    "COVERAGE": "A cobertura mínima obrigatória não pode ser atendida com a equipe disponível.",
    "REST": "As condições atuais não permitem preservar os descansos entre jornadas e semanas.",
}


class ConflictRegistry:
    def __init__(self):
        self.groups = {}

    def track(self, constraint, family):
        # Only explicitly registered linear constraints support these guards.
        self.groups.setdefault(family, []).append(constraint.index)
        return constraint

    def track_range(self, model, first, family):
        for index in range(first, len(model.proto.constraints)):
            constraint = model.proto.constraints[index]
            if constraint.has_linear() or constraint.has_bool_or():
                self.groups.setdefault(family, []).append(index)

    def diagnose(self, model, deadline, control=None):
        remaining = deadline - time.monotonic() - 0.10
        if remaining < 0.05:
            return []
        diagnostic = model.clone()
        diagnostic.clear_hints()
        diagnostic.clear_objective()
        by_literal = {}
        for family, indexes in self.groups.items():
            literal = diagnostic.new_bool_var("diagnostic:" + family)
            for index in indexes:
                diagnostic.proto.constraints[index].enforcement_literal.append(literal.index)
            diagnostic.add_assumption(literal)
            by_literal[literal.index] = family
        # Cloning and registering assumptions consume the same deadline.
        # Do not allocate an engine if preparation exhausted its usable share.
        remaining = deadline - time.monotonic() - 0.10
        if remaining < 0.05:
            return []
        engine = cp_model.CpSolver()
        # Assumptions are unsupported by the parallel search; diagnosis always uses one worker.
        engine.parameters.num_workers = 1
        engine.parameters.max_time_in_seconds = min(0.75, remaining)
        status = engine.solve(diagnostic) if control is None else control.solve(engine, diagnostic)
        if status != cp_model.INFEASIBLE:
            return []
        families = sorted({by_literal[index] for index in engine.sufficient_assumptions_for_infeasibility()
                           if index in by_literal})
        return [{"family": family, "message": MESSAGES[family]} for family in families]
