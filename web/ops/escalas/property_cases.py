"""Development-only generated cases, independently checked by the TypeScript verifier."""
import copy

from hypothesis import given, settings, strategies as st
from test_solver import fixture, make_untimed


def cases():
    generated = []

    @settings(max_examples=30, derandomize=True, database=None, deadline=None)
    @given(people=st.integers(1, 4), weeks=st.integers(1, 2), hours=st.sampled_from([40, 42]),
           untimed=st.booleans(), absence=st.booleans(), locked=st.booleans())
    def collect(people, weeks, hours, untimed, absence, locked):
        data = fixture(hours, people=people, weeks=weeks)
        if untimed:
            make_untimed(data['employees'][-1])
        if absence:
            data['assignments'].append({'employeeId': 'p0', 'date': data['startDate'], 'kind': 'ABSENCE'})
        elif locked:
            data['assignments'].append({'employeeId': 'p0', 'date': data['startDate'], 'kind': 'OFF', 'locked': True})
        generated.append(copy.deepcopy(data))

    collect()
    return generated
