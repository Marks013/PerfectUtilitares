# Resource admission and email policy

The host is shared. Disk occupancy does not identify which application caused
it; Frigate, background maintenance and retained images can consume space with
no PerfectUtilitares visitors. Admission protection stays active continuously.

## Installed contract

- Source: `web/ops/server-resource-guard`; installed at
  `/usr/local/sbin/server-resource-guard`. The server-ops launcher delegates here.
- Configuration: `/etc/server-resource-guard.conf`, using the committed example.
- Timer: every two minutes. `status.json` is atomic, mode 0644, mounted read-only
  at `/run/server-resource-guard` by the application and PDF worker.
- Private notification state: `/var/lib/server-resource-guard/notification-state.json`,
  mode 0600. Never delete it during routine cleanup or deployment.
- `flock` serializes timer and manual execution. Email timeout is 20 seconds.

## Resource limits

| Metric | Warning | Pause new heavy operations | Resume | Critical |
| --- | --- | --- | --- | --- |
| Root used percentage | >=78% | >=85% | <=80% | >=90% |
| Root available bytes | none separately | <=30 GiB | >=35 GiB | <=15 GiB |
| Available memory | <=4096 MiB | <=3072 MiB | >=4096 MiB | <=1536 MiB |
| Inodes used | >=70% | no additional gate | below warning | no additional gate |

Disk admission resumes only when BOTH disk recovery conditions are satisfied.
Memory and disk latches are independent. Available disk uses exact bytes, not
truncated GiB. Application/worker retain their own operation-size reservation
and 85% / 30 GiB checks, independent from email delivery.

## Delivery policy

- Non-critical email window: **08:00 <= local time < 18:00**, every day,
  `America/Sao_Paulo` (currently UTC-03).
- Warning persists at least 900 seconds; blocked persists 240 seconds.
- Critical risks bypass the time window and confirmation delay.
- New non-critical notifications are separated by at least four hours.
- Same incident: at most one reminder per 24 hours (six hours for critical).
- A partial improvement is not a new incident. Stable `ok` for 30 minutes
  closes the incident without sending a recovery email.
- Outside the email window, only the current persistent condition is evaluated
  at the next allowed check. A recovered nighttime warning is not queued.
- Sampling gaps above ten minutes and backward clocks restart confirmation.
- Failed sends are not acknowledged. Retries wait ten minutes; the same
  idempotency key and exact payload are reused for uncertain provider responses.
- A fresh critical escalation can bypass the retry delay of a lower severity.

## Validation and deployment

Run on the server, from `web/ops`:

```sh
sh -n server-resource-guard
sh -n install-server-protection.sh
node --test server-resource-guard.test.mjs
```

Tests isolate metrics, clock, network and state in temporary directories. No
production email is sent. No application rebuild is needed for these host-only
files. Install the monitor atomically, preserve credentials and notification
state, start the systemd service, then check app readiness and mounted status.

No CPU/PSI shadow measurement currently gates this monitor. Do not reinstall
historical scripts from server-ops to restore those features without a separate
review; those older versions have different thresholds and alert behavior.

Principle: alert on actionable symptoms with confirmation and minimal noise.
Reference: https://prometheus.io/docs/practices/alerting/
