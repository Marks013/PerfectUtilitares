"""Cancellation shared by the HTTP supervisor and native transport."""

import time


class SolveCancelled(Exception):
    pass


class SolveTimedOut(Exception):
    pass


class SolveControl:
    def __init__(self, cancel_event, deadline):
        self.cancel_event, self.deadline = cancel_event, deadline

    def checkpoint(self):
        if self.cancel_event.is_set():
            raise SolveCancelled()
        if time.monotonic() >= self.deadline:
            raise SolveTimedOut()
