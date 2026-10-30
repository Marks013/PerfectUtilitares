"""One disposable, owned process per solve. Only sanitized outcomes leave it."""
from control import SolveCancelled, SolveControl, SolveTimedOut


def run_worker(payload, cancel_event, deadline, connection):
    try:
        control = SolveControl(cancel_event, deadline)
        control.checkpoint()
        from solver import solve
        result = solve(payload, control=control)
        control.checkpoint()
        outcome = {"state": "COMPLETED", "result": result}
    except SolveCancelled:
        outcome = {"state": "CANCELLED"}
    except SolveTimedOut:
        outcome = {"state": "TIMED_OUT"}
    except (ValueError, KeyError, TypeError, OverflowError):
        outcome = {"state": "FAILED", "error": "INVALID_MODEL_INPUT"}
    except BaseException:
        # Exception text may contain personal input. Never emit a traceback or payload.
        outcome = {"state": "FAILED", "error": "SOLVER_FAILED"}
    try:
        connection.send(outcome)
    except (BrokenPipeError, EOFError, OSError):
        pass
    finally:
        connection.close()
