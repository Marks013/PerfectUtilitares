"""Private bounded search settings, never accepted from the public payload."""
import os
from dataclasses import dataclass

MAX_SECONDS = 12
RANDOM_SEED = 37
MOVABLE_PEOPLE_LIMIT = 36
POLISH_PEOPLE_LIMIT = 18
LARGE_MODEL_VARIABLES = 3000
COVERAGE_BUDGET_SHARE = 0.55


def _bounded_setting(name, default, allowed):
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ValueError("SOLVER_SEARCH_CONFIG_INVALID") from None
    if value not in allowed:
        raise ValueError("SOLVER_SEARCH_CONFIG_INVALID")
    return value


@dataclass(frozen=True)
class SearchSettings:
    workers: int = 1
    linearization: int = 0
    symmetry: int = 0

    @classmethod
    def from_environment(cls):
        return cls(_bounded_setting("ESCALAS_SOLVER_WORKERS", 1, (1, 2)),
                   _bounded_setting("ESCALAS_SOLVER_LINEARIZATION", 0, (0, 1, 2)),
                   _bounded_setting("ESCALAS_SOLVER_SYMMETRY", 0, (0, 1, 2)))
