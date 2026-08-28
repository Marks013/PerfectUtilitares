import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const script = join(dirname(fileURLToPath(import.meta.url)), 'server-resource-guard');
const GIB = 1024 ** 3;
const BASE = Date.parse('2026-08-27T13:00:00Z') / 1000;

function fixture(t, config = '') {
  const root = mkdtempSync(join(tmpdir(), 'guard-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  mkdirSync(bin);
  mkdirSync(state);
  const put = (name, value) => writeFileSync(join(bin, name), value, { mode: 0o755 });
  put('df', `#!/bin/sh
case "$*" in
 *-Pi*) printf 'Filesystem Inodes IUsed IFree IUse%% Mounted\n/dev/test 10000 1000 9000 %s%% /\n' "$SIM_INODES" ;;
 *) printf 'Filesystem 1B-blocks Used Available Use%% Mounted\n/dev/test 200000000000 100000000000 %s %s%% /\n' "$SIM_FREE" "$SIM_USED" ;;
esac
`);
  put('awk', `#!/bin/sh
case "$*" in
 *MemAvailable*) echo "$((SIM_MEMORY * 1024))" ;;
 *SwapTotal*) echo 8388608 ;;
 *SwapFree*) echo 8000000 ;;
 *) exec /usr/bin/awk "$@" ;;
esac
`);
  put('docker', '#!/bin/sh\nprintf "%s" "${SIM_UNHEALTHY:-}"\n');
  put('date', `#!/bin/sh
case "$*" in
 *+%s*) echo "$SIM_NOW" ;;
 *+%H*) exec /usr/bin/date -d "@$SIM_NOW" +%H ;;
 *) exec /usr/bin/date -u -d "@$SIM_NOW" '+%Y-%m-%dT%H:%M:%SZ' ;;
esac
`);
  put('logger', '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SIM_ROOT/journal"\n');
  put('curl', `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const stdin = fs.readFileSync(0, 'utf8');
if (!stdin.includes('test-fixture-only') || args.some(x => x.includes('test-fixture-only'))) process.exit(99);
if (!args.includes('--max-time') || !args.includes('--connect-timeout')) process.exit(98);
const payload = JSON.parse(args[args.indexOf('--data') + 1]);
const key = args.find(x => x.startsWith('Idempotency-Key:'));
fs.appendFileSync(process.env.SIM_ROOT + '/sent', JSON.stringify({payload, key}) + '\\n');
if (process.env.SIM_FAIL === '1') process.exit(22);
console.log(process.env.SIM_BAD_RESPONSE === '1' ? '{}' : '{"id":"fixture-email"}');
`);
  writeFileSync(join(root, 'credentials'), 'RESEND_API_KEY=test-fixture-only\n');
  writeFileSync(join(root, 'mail.conf'), `ENV_FILE='${root}/credentials'\nTO_EMAIL=test@example.invalid\nFROM_EMAIL=test@example.invalid\nSERVER_NAME=fixture\n`);
  writeFileSync(join(root, 'guard.conf'), `ALERT_CONFIG='${root}/mail.conf'\n${config}\n`);
  const read = name => JSON.parse(readFileSync(join(state, name), 'utf8'));
  return {
    root, state,
    run(seconds = 0, values = {}, expectedExit = 0) {
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RESOURCE_GUARD_CONFIG: join(root, 'guard.conf'),
        RESOURCE_GUARD_STATE_DIR: state, SIM_ROOT: root, SIM_NOW: String(BASE + seconds),
        SIM_USED: '73', SIM_FREE: String(50 * GIB), SIM_MEMORY: '18000', SIM_INODES: '10', ...values };
      const result = spawnSync('/bin/sh', [script], { env, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, expectedExit, `${result.stderr}\n${result.stdout}`);
      if (expectedExit !== 0) return result;
      assert.equal(result.stderr, '');
      return read('status.json');
    },
    read,
    seed(values = {}) {
      writeFileSync(join(state, 'notification-state.json'), JSON.stringify({ version: 1, observed: 'warning',
        observedSince: BASE - 1000, sampledAt: BASE - 120, notified: 'ok', lastSent: 0,
        retryAfter: 0, pendingSeverity: 'none', pendingEpoch: 0, ...values }));
    },
    sent() { return existsSync(join(root, 'sent')) ? readFileSync(join(root, 'sent'), 'utf8').trim().split('\n').map(JSON.parse) : []; },
  };
}
const warning = { SIM_USED: '79', SIM_FREE: String(40 * GIB) };
const blocked = { SIM_USED: '84', SIM_FREE: String(30 * GIB) };
const critical = { SIM_USED: '91', SIM_FREE: String(14 * GIB) };

test('normal state, no email, public status and private notification state', t => {
  const f = fixture(t);
  assert.equal(f.run().acceptingHeavyJobs, true);
  assert.equal(f.sent().length, 0);
  assert.equal(statSync(join(f.state, 'status.json')).mode & 0o777, 0o644);
  assert.equal(statSync(join(f.state, 'notification-state.json')).mode & 0o777, 0o600);
});

test('disk exact bytes and hysteresis across 30/31 GiB oscillation', t => {
  const f = fixture(t);
  assert.equal(f.run(0, { ...blocked, SIM_FREE: String(30 * GIB + 1) }).acceptingHeavyJobs, true);
  assert.equal(f.run(120, blocked).acceptingHeavyJobs, false);
  assert.equal(f.run(240, { ...blocked, SIM_FREE: String(31 * GIB) }).acceptingHeavyJobs, false);
  assert.equal(f.run(360, { SIM_USED: '81', SIM_FREE: String(35 * GIB) }).acceptingHeavyJobs, false);
  const recovered = f.run(480, { SIM_USED: '80', SIM_FREE: String(35 * GIB) });
  assert.equal(recovered.acceptingHeavyJobs, true);
  assert.equal(recovered.policy.disk.blocked, false);
  assert.equal(f.sent().length, 1);
});

test('legacy false status retains disk block but not a memory-only block', t => {
  const f = fixture(t);
  writeFileSync(join(f.state, 'status.json'), JSON.stringify({ acceptingHeavyJobs: false, reasons: ['Disco raiz bloqueado'] }));
  assert.equal(f.run(0, { ...blocked, SIM_FREE: String(31 * GIB) }).acceptingHeavyJobs, false);
  writeFileSync(join(f.state, 'status.json'), JSON.stringify({ acceptingHeavyJobs: false, reasons: ['Memoria baixa'] }));
  assert.equal(f.run(120, { ...blocked, SIM_FREE: String(31 * GIB) }).acceptingHeavyJobs, true);
});

test('memory latch is independent of disk', t => {
  const f = fixture(t);
  assert.equal(f.run(0, { ...warning, SIM_MEMORY: '3000' }).policy.memory.blocked, true);
  assert.equal(f.run(120, { ...warning, SIM_MEMORY: '3500' }).acceptingHeavyJobs, false);
  const s = f.run(240, { ...warning, SIM_MEMORY: '4096' });
  assert.equal(s.acceptingHeavyJobs, true);
  assert.equal(s.policy.disk.blocked, false);
});

test('warning requires 15 minutes and transient warning sends nothing', t => {
  const f = fixture(t);
  f.run(0, warning); f.run(480, warning);
  assert.equal(f.sent().length, 0);
  f.run(900, warning);
  assert.equal(f.sent().length, 1);
  f.run(1020, warning);
  assert.equal(f.sent().length, 1);
  const other = fixture(t);
  other.run(0, warning); other.run(120); other.run(240, warning);
  assert.equal(other.sent().length, 0);
});

test('notification window uses Sao Paulo: before 08 silent, at 08 eligible', t => {
  const f = fixture(t);
  const at08 = -2 * 3600;
  f.seed({ observedSince: BASE + at08 - 1200, sampledAt: BASE + at08 - 121 });
  f.run(at08 - 1, warning);
  assert.equal(f.sent().length, 0);
  f.run(at08, warning);
  assert.equal(f.sent().length, 1);
});

test('17:59 sends, 18:00 defers noncritical while admission remains blocked', t => {
  const before = fixture(t);
  before.seed({ observedSince: BASE + 8 * 3600 - 1200, sampledAt: BASE + 8 * 3600 - 121 });
  before.run(8 * 3600 - 1, warning);
  assert.equal(before.sent().length, 1);
  const after = fixture(t);
  after.seed({ observed: 'blocked', observedSince: BASE + 8 * 3600 - 1200, sampledAt: BASE + 8 * 3600 - 120 });
  assert.equal(after.run(8 * 3600, blocked).acceptingHeavyJobs, false);
  assert.equal(after.sent().length, 0);
});

test('critical bypasses quiet window, then waits six hours before reminder', t => {
  const f = fixture(t);
  f.run(10 * 3600, critical);
  assert.equal(f.sent().length, 1);
  f.run(10 * 3600 + 120, critical);
  assert.equal(f.sent().length, 1);
  f.seed({ observed: 'critical', observedSince: BASE + 10 * 3600, sampledAt: BASE + 16 * 3600 - 120,
    notified: 'critical', lastSent: BASE + 10 * 3600 });
  f.run(16 * 3600, critical);
  assert.equal(f.sent().length, 2);
});

test('partial recovery and re-block do not produce repeated mail', t => {
  const f = fixture(t);
  f.seed({ observed: 'blocked', notified: 'blocked', lastSent: BASE - 5 * 3600 });
  f.run(0, warning);
  f.run(480, warning);
  f.run(960, warning);
  f.run(1080, blocked);
  f.run(1320, blocked);
  assert.equal(f.sent().length, 0);
});

test('stable recovery closes incident without email, brief recovery does not', t => {
  const f = fixture(t);
  f.seed({ observed: 'blocked', notified: 'blocked', lastSent: BASE - 100 });
  f.run(0); f.run(600); f.run(1200);
  assert.equal(f.read('notification-state.json').notified, 'blocked');
  f.run(1800);
  assert.equal(f.read('notification-state.json').notified, 'ok');
  assert.equal(f.sent().length, 0);
});

test('new noncritical incidents respect four-hour cooldown', t => {
  const f = fixture(t);
  f.seed({ lastSent: BASE - 3600 });
  f.run(0, warning);
  assert.equal(f.sent().length, 0);
  f.seed({ observedSince: BASE + 3 * 3600 - 1200, sampledAt: BASE + 3 * 3600 - 120, lastSent: BASE - 3600 });
  f.run(3 * 3600, warning);
  assert.equal(f.sent().length, 1);
});

test('continuous warning has a daily reminder, never per-sample mail', t => {
  const f = fixture(t);
  f.seed({ notified: 'warning', lastSent: BASE - 86399 });
  f.run(0, warning);
  assert.equal(f.sent().length, 0);
  f.run(1, warning);
  assert.equal(f.sent().length, 1);
});

test('failed delivery is not acknowledged; retry is delayed and idempotent', t => {
  const f = fixture(t);
  f.seed();
  f.run(0, { ...warning, SIM_FAIL: '1' });
  assert.equal(f.read('notification-state.json').notified, 'ok');
  f.run(120, warning);
  assert.equal(f.sent().length, 1);
  f.run(600, warning);
  assert.equal(f.sent().length, 2);
  assert.deepEqual(f.sent()[1], f.sent()[0]);
  assert.equal(f.read('notification-state.json').notified, 'warning');
});

test('critical escalation can bypass a failed warning retry, not its own retry', t => {
  const f = fixture(t);
  f.seed(); f.run(0, { ...warning, SIM_FAIL: '1' });
  f.run(120, { ...critical, SIM_FAIL: '1' });
  f.run(240, critical);
  assert.equal(f.sent().length, 2);
  f.run(720, critical);
  assert.equal(f.sent().length, 3);
  assert.deepEqual(f.sent()[1], f.sent()[2]);
});

test('sample gaps and backward clocks reset confirmation', t => {
  const f = fixture(t);
  f.seed({ sampledAt: BASE - 601 });
  f.run(0, warning);
  assert.equal(f.sent().length, 0);
  f.seed({ sampledAt: BASE + 100, observedSince: BASE + 10 });
  f.run(0, warning);
  assert.equal(f.sent().length, 0);
});

test('malformed persisted state does not bypass confirmation', t => {
  const f = fixture(t);
  writeFileSync(join(f.state, 'notification-state.json'), '{broken');
  f.run(0, warning);
  assert.equal(f.sent().length, 0);
});

test('HTTP success without delivery id is not acknowledged', t => {
  const f = fixture(t);
  f.seed(); f.run(0, { ...warning, SIM_BAD_RESPONSE: '1' });
  assert.equal(f.read('notification-state.json').notified, 'ok');
  assert.equal(f.read('notification-state.json').retryAfter, BASE + 600);
});

test('unhealthy containers and inode warnings use the same confirmation window', t => {
  const f = fixture(t);
  assert.equal(f.run(0, { SIM_UNHEALTHY: 'fixture-container', SIM_INODES: '75' }).severity, 'warning');
  assert.equal(f.sent().length, 0);
});

test('invalid config fails before overwriting status or delivering mail', t => {
  for (const config of ['DISK_BLOCK_PERCENT=101', 'ALERT_QUIET_END_HOUR=08', 'ALERT_RETRY_SECONDS=0',
    'MEMORY_RESUME_MIB=2000', 'DISK_BLOCK_FREE_GIB=99999999999999999999999999']) {
    const f = fixture(t, config);
    f.run(0, {}, 2);
    assert.equal(existsSync(join(f.state, 'status.json')), false);
    assert.equal(f.sent().length, 0);
  }
});

test('concurrent timer/manual runs cannot duplicate an alert or mutate status', async t => {
  const f = fixture(t);
  f.run();
  const initial = readFileSync(join(f.state, 'status.json'), 'utf8');
  const holder = spawn('/usr/bin/flock', [join(f.state, 'monitor.lock'), '/bin/sh', '-c', 'printf ready; sleep 2'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { holder.stdout.once('data', resolve); holder.once('error', reject); });
  f.run(120, critical);
  assert.equal(readFileSync(join(f.state, 'status.json'), 'utf8'), initial);
  assert.equal(f.sent().length, 0);
  await new Promise(resolve => holder.once('close', resolve));
});
