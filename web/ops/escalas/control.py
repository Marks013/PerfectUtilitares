"""Cooperative cancellation during model construction and native CP-SAT search."""
import threading
import time


class SolveCancelled(Exception):
    pass


class SolveTimedOut(Exception):
    pass


class SolveControl:
    def __init__(self, cancel_event, deadline):
        self.cancel_event = cancel_event
        self.deadline = deadline

    def checkpoint(self):
        if self.cancel_event.is_set():
            raise SolveCancelled()
        if time.monotonic() >= self.deadline:
            raise SolveTimedOut()

    def solve(self, engine, model):
        self.checkpoint()
        finished = threading.Event()

        def watch():
            while not finished.wait(0.01):
                if self.cancel_event.is_set() or time.monotonic() >= self.deadline:
                    # Retry until solve returns: cancellation may precede native startup.
                    engine.stop_search()

        watcher = threading.Thread(target=watch, daemon=True)
        watcher.start()
        try:
            status = engine.solve(model)
        finally:
            finished.set()
            watcher.join(timeout=0.25)
        self.checkpoint()
        return status
