"""SolverForge-only service entry point; no alternate optimizer or fallback."""

import threading
import time
from datetime import date, timedelta
from control import SolveControl
from model_input import validate_model_input
from native_runner import run_native
from runtime_settings import MAX_SECONDS


def solve(data, control=None):
    validate_model_input(data)
    if control is None:
        control = SolveControl(threading.Event(), time.monotonic() + MAX_SECONDS + 6)
    return run_native(data, control)


def occupied_dates(day, shift):
    """Civil dates occupied by paid segments; unpaid breaks never create work."""
    first = date.fromisoformat(day)
    occupied = set()
    for segment in shift["segments"]:
        if segment["kind"] != "BREAK":
            for offset in range(segment["start"] // 1440, (segment["end"] - 1) // 1440 + 1):
                occupied.add((first + timedelta(days=offset)).isoformat())
    return occupied
