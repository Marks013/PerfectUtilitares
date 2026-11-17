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
    ['2026-12', '2026-11-29', '2027-01-02', 5],
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

test('mismatched, incomplete and oversized horizons fail instead of changing anchors', () => {
  for (const [startDate, endDate] of [['2026-12-07', '2026-12-13'], ['2026-12-06', '2026-12-11'],
    ['2026-12-06', '2027-01-23'], ['2026-12-13', '2026-12-06']]) {
    assert.throws(() => planningWeeks({ startDate, endDate, ...sunday }));
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
      assert.ok([28, 35, 42].includes(days.length));
      for (const week of weeks) for (const day of week.dates) {
        assert.equal(planningWeekStart(day, input), week.startDate);
        assert.equal(planningWeekEnd(day, input), week.endDate);
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
