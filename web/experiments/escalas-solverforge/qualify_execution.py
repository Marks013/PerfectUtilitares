"""Require every original qualification stage; skipped work cannot certify a SHA.

This supplements, never replaces, verify_comparison.py. Only sanitized step
outcomes are recorded. A passing experimental qualification is not production
certification. No network, credentials, or new dependencies are used.
"""
import json
import os

REQUIRED_STEPS = (
    'offline', 'build', 'controls', 'security', 'scale', 'temporal',
    'expanded_quality', 'paired', 'quality', 'personal', 'curve', 'tail',
    'adaptive_gain',
)


def qualify(outcomes: dict[str, object]) -> dict[str, object]:
    failed = []
    for step in REQUIRED_STEPS:
        value = outcomes.get(step)
        if value == 'success':
            continue
        status = ('missing' if step not in outcomes else
                  value if isinstance(value, str) and value in ('failure', 'skipped', 'cancelled')
                  else 'invalid')
        failed.append({'step': step, 'outcome': status})
    return {
        'decision': 'QUALIFICATION_NOT_PROVEN' if failed else 'QUALIFICATION_PASSED',
        'requiredSteps': list(REQUIRED_STEPS),
        'failedSteps': failed,
        'productionCertified': False,
    }


def main() -> int:
    outcomes = {step: os.environ['FORGE_' + step.upper()] for step in REQUIRED_STEPS
                if 'FORGE_' + step.upper() in os.environ}
    report = qualify(outcomes)
    print(json.dumps(report, separators=(',', ':')))
    return int(report['decision'] != 'QUALIFICATION_PASSED')


if __name__ == '__main__':
    raise SystemExit(main())
