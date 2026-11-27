"""SolverForge-only service entry point; no alternate optimizer or fallback."""

import threading
import time
from control import SolveControl
from model_input import validate_model_input
from native_runner import run_native
from runtime_settings import MAX_SECONDS


def solve(data, control=None):
    validate_model_input(data)
    if control is None:
        control = SolveControl(threading.Event(), time.monotonic() + MAX_SECONDS + 6)
    return run_native(data, control)
