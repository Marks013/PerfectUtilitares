// Runs without npm dependencies; also verifies the two independent implementations.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { planningMonthPeriod, planningWeekEnd, planningWeekStart, planningWeeks, planningWeekStartsOn }
  from '../../src/lib/escalas/planning-calendar.ts';

const sunday = { planningWeekStartsOn: 'SUNDAY' };

test('legacy metadata, strict values and Sunday ownership', () => {
  assert.equal(planningWeekStartsOn(), 'MONDAY');
  assert.equal(planningWeekStart('2026-12-13'), '2026-12-07');
  assert.equal(planningWeekStart('2026-12-13', sunday), '2026-12-13');
  assert.equal(planningWeekEnd('2026-12-13', sunday), '2026-12-19');
  for (const value of [null, '', 0, 'SATURDAY', 'sunday']) {
    assert.throws(() => planningWeekStartsOn({ planningWeekStartsOn: value }));
  }
  for (const day of ['2026-02-29', '2026-13-01', '2026-1-01', '2026-01-01T00:00:00Z']) {
    assert.throws(() => planningWeekStart(day, sunday));
  }
});

test('monthly bounds may add or remove a complete technical week', () => {
  for (const [month, startDate, endDate, length] of [
    ['2026-11', '2026-11-01', '2026-12-05', 5],
    ['2027-01', '2026-12-27', '2027-02-06', 6],
    ['2026-02', '2026-02-01', '2026-02-28', 4],
  ]) {
    const actual = planningMonthPeriod(month, sunday);
    assert.deepEqual(actual, { startDate, endDate });
    assert.equal(planningWeeks({ ...actual, ...sunday }).length, length);
  }
  // Real callers may pass a whole saved input; its old dates must not override new bounds.
  assert.deepEqual(planningMonthPeriod('2027-01', { ...sunday, startDate: '2026-12-28', endDate: '2027-01-31' }),
    { startDate: '2026-12-27', endDate: '2027-02-06' });
});

test('December 2026 splits exactly at the civil boundaries and the intervening Sundays', () => {
  const period = planningMonthPeriod('2026-12', sunday);
  assert.deepEqual(period, { startDate: '2026-12-01', endDate: '2026-12-31' });
  assert.deepEqual(planningWeeks({ ...period, ...sunday }).map(week => week.dates.length), [5, 7, 7, 7, 5]);
  assert.throws(() => planningWeeks({ ...period, planningWeekStartsOn: 'MONDAY' }));
  assert.deepEqual(planningWeeks({ startDate: '2026-11-29', endDate: '2027-01-02', ...sunday }).map(week => week.dates.length),
    [7, 7, 7, 7, 7]);
});

test('mismatched, incomplete and oversized horizons fail instead of changing anchors', () => {
  for (const [startDate, endDate] of [['2026-12-07', '2026-12-13'], ['2026-12-06', '2026-12-11'],
    ['2026-12-06', '2027-01-23'], ['2026-12-13', '2026-12-06']]) {
    assert.throws(() => planningWeeks({ startDate, endDate, ...sunday }));
  }
});

test('malformed metadata never silently selects the legacy calendar', () => {
  for (const input of [null, false, 0, '', 'SUNDAY', [], new Date(), new Map(),
    Object.create({ planningWeekStartsOn: 'SUNDAY' })]) {
    assert.throws(() => planningWeekStartsOn(input));
    assert.throws(() => planningWeekStart('2026-12-13', input));
    assert.throws(() => planningWeekEnd('2026-12-13', input));
    assert.throws(() => planningMonthPeriod('2026-12', input));
  }
  assert.equal(planningWeekStartsOn(Object.create(null)), 'MONDAY');
});

test('missing period data and direct horizons outside the planning domain are rejected', () => {
  for (const input of [null, false, [], {}, sunday, { startDate: '2026-12-06' },
    { endDate: '2026-12-12' }, { startDate: 20261206, endDate: '2026-12-12' }]) {
    assert.throws(() => planningWeeks(input));
  }
  for (const [startDate, endDate] of [['1999-12-26', '2000-01-01'], ['2099-12-27', '2100-01-02']]) {
    assert.throws(() => planningWeeks({ startDate, endDate, ...sunday }));
  }
  assert.equal(planningWeeks({ startDate: '2000-01-02', endDate: '2000-01-08', ...sunday }).length, 1);
  assert.equal(planningWeeks({ startDate: '2099-12-21', endDate: '2099-12-27' }).length, 1);
});

test('civil week ends calculate from the input even when intermediate bounds cross 1900 or 2100', () => {
  assert.equal(planningWeekStart('1900-01-01', sunday), '1899-12-31');
  assert.equal(planningWeekEnd('1900-01-01', sunday), '1900-01-06');
  assert.equal(planningWeekStart('2099-12-31', sunday), '2099-12-27');
  assert.equal(planningWeekEnd('2099-12-31', sunday), '2100-01-02');
});

test('immutable inputs and fresh calendar arrays do not alias each other', () => {
  const input = Object.freeze({ ...planningMonthPeriod('2026-12', sunday), ...sunday,
    employees: Object.freeze([]) });
  const before = JSON.stringify(input), first = planningWeeks(input);
  first[0].dates[0] = 'changed';
  const second = planningWeeks(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(second[0].dates[0], input.startDate);
  assert.deepEqual(first[1], second[1]);
});

test('leap days, all six horizon lengths and strict month strings', () => {
  for (const planningWeekStartsOn of ['MONDAY', 'SUNDAY']) {
    const calendar = { planningWeekStartsOn };
    const startDate = planningWeekStart('2028-02-29', calendar);
    for (let weeks = 1; weeks <= 6; weeks++) {
      const endDate = new Date(Date.parse(startDate + 'T00:00:00Z') + (7 * weeks - 1) * 86400000).toISOString().slice(0, 10);
      const result = planningWeeks({ startDate, endDate, ...calendar });
      assert.equal(result.length, weeks);
      assert.equal(result.flatMap(week => week.dates).filter(day => day === '2028-02-29').length, 1);
    }
  }
  for (const month of ['2000-00', '2000-13', '1999-12', '2100-01', '2026-2', '2026-12\n', null, 202612]) {
    assert.throws(() => planningMonthPeriod(month, sunday));
  }
});

test('calendar arithmetic is independent of the host timezone', () => {
  const moduleUrl = new URL('../../src/lib/escalas/planning-calendar.ts', import.meta.url).href;
  const script = `import { planningMonthPeriod } from ${JSON.stringify(moduleUrl)};
console.log(JSON.stringify(['2026-12', '2027-01', '2028-02'].map(month =>
  planningMonthPeriod(month, { planningWeekStartsOn: 'SUNDAY' }))));`;
  const expected = ['2026-12', '2027-01', '2028-02'].map(month => planningMonthPeriod(month, sunday));
  for (const TZ of ['UTC', 'America/Sao_Paulo', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    const actual = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 16384, env: { ...process.env, TZ, NODE_NO_WARNINGS: '1' },
    });
    assert.deepEqual(JSON.parse(actual), expected);
  }
});

test('Python and TypeScript agree on every month in 2000..2099 in both conventions', () => {
  const inputs = [];
  const expected = [];
  for (let year = 2000; year <= 2099; year++) for (let month = 1; month <= 12; month++) {
    for (const planningWeekStartsOn of ['MONDAY', 'SUNDAY']) {
      const input = { month: `${year}-${String(month).padStart(2, '0')}`, planningWeekStartsOn };
      inputs.push(input);
      let period;
      try { period = planningMonthPeriod(input.month, input); }
      catch { assert.ok(['2000-01', '2099-12'].includes(input.month)); expected.push(null); continue; }
      const weeks = planningWeeks({ ...period, planningWeekStartsOn });
      const days = weeks.flatMap(week => week.dates);
      assert.equal(days.length, new Set(days).size);
      if (input.month === '2026-12' && planningWeekStartsOn === 'SUNDAY') {
        assert.equal(days.length, 31);
      } else {
        assert.ok([28, 35, 42].includes(days.length));
        const weekday = planningWeekStartsOn === 'SUNDAY' ? 0 : 1;
        assert.equal(new Date(period.startDate + 'T00:00:00Z').getUTCDay(), weekday);
        assert.equal(new Date(period.endDate + 'T00:00:00Z').getUTCDay(), (weekday + 6) % 7);
      }
      const lastCivil = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      assert.ok(period.startDate <= input.month + '-01' && period.endDate >= lastCivil);
      for (const week of weeks) for (const day of week.dates) {
        assert.equal(planningWeekStart(day, { ...period, planningWeekStartsOn }), week.startDate);
        assert.equal(planningWeekEnd(day, { ...period, planningWeekStartsOn }), week.endDate);
      }
      expected.push({ ...period, weeks });
    }
  }
  const script = `import json, sys
from planning_calendar import planning_month_period, planning_weeks
out = []
for item in json.load(sys.stdin):
    try:
        period = planning_month_period(item['month'], item)
        out.append({**period, 'weeks': planning_weeks({**period, **item})})
    except ValueError:
        out.append(None)
print(json.dumps(out))
`;
  const actual = JSON.parse(execFileSync('python3', ['-c', script], {
    cwd: fileURLToPath(new URL('../../ops/escalas/', import.meta.url)),
    input: JSON.stringify(inputs), encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  }));
  assert.equal(inputs.length, 2400);
  assert.equal(expected.filter(Boolean).length, 2396);
  assert.deepEqual(actual, expected);
});
