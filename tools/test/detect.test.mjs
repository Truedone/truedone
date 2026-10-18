// BENCH-01: the detection benchmark runs the nine labelled cases through the real core and the red-green runner. Every
// tampering and no-evidence case is flagged, the legitimate refactor carries no flag, the two by-design misses are
// reported as not detected with their reason, and the check fails when a fixture's expected outcome is not met.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FIXTURES, FLAGS, check, filesOf, page, readCases, runBench } from '../bench/detect.mjs';

const result = await runBench();
const byId = Object.fromEntries(result.cases.map((c) => [c.id, c]));

test('the nine cases are read in a fixed order, each with a base tree, a head tree and an expected outcome', () => {
  const cases = readCases();
  assert.equal(cases.length, 9);
  assert.deepEqual(cases.map((c) => c.id), [...cases.map((c) => c.id)].sort());
  for (const c of cases) {
    assert.ok(fs.existsSync(path.join(c.dir, 'base')) && fs.existsSync(path.join(c.dir, 'head')), c.id);
    assert.ok(['tampering', 'no_evidence', 'could_not_run', 'by_design', 'legitimate'].includes(c.kind), c.kind);
    assert.ok(typeof c.expected.verdict === 'string' && ['pass', 'fail'].includes(c.expected.baseline_ci), c.id);
    assert.ok(filesOf(c.dir).length > 0, `${c.id} changes a file`);
  }
});

test('every tampering, no-evidence and flaky case is flagged by the real core or runner', () => {
  for (const c of result.cases.filter((x) => ['tampering', 'no_evidence', 'could_not_run'].includes(x.kind))) {
    assert.ok(FLAGS.has(c.truedone.verdict), `${c.id} is ${c.truedone.verdict}`);
    assert.equal(c.detected, true, c.id);
  }
  assert.equal(byId['01-assertion-weakened'].truedone.verdict, 'tampered');
  assert.ok(byId['01-assertion-weakened'].truedone.reasons.some((r) => r.check === 'weakened'));
  assert.equal(byId['02-failing-test-skipped'].truedone.verdict, 'tampered');
  assert.ok(byId['02-failing-test-skipped'].truedone.reasons.some((r) => r.check === 'skip'));
  assert.equal(byId['03-source-change-no-test'].truedone.verdict, 'no_evidence');
  assert.equal(byId['04-green-on-base-and-head'].truedone.verdict, 'no_evidence');
  assert.equal(byId['07-mutation-survives'].truedone.verdict, 'no_evidence');
  assert.equal(byId['08-flaky-test'].truedone.verdict, 'could_not_run');
  assert.deepEqual(byId['08-flaky-test'].truedone.red_green.tests[0].head.filter((t) => t === 'pass').length, 1, 'one of three head runs passed');
});

test('the legitimate refactor carries no flag, and its moved tests are not read as deleted', () => {
  const c = byId['09-legitimate-test-refactor'];
  assert.equal(c.kind, 'legitimate');
  assert.ok(!FLAGS.has(c.truedone.verdict), c.truedone.verdict);
  assert.equal(c.detected, false);
  assert.ok(!c.truedone.reasons.some((r) => r.check === 'deleted'), 'no deleted-test reason');
  assert.equal(result.summary.false_alarms, 0);
});

test('the two by-design misses are reported as not detected, with the reason, never as caught', () => {
  for (const id of ['05-red-green-wrong-assertion', '06-mock-hides-integration']) {
    const c = byId[id];
    assert.equal(c.kind, 'by_design');
    assert.equal(c.detected, false, id);
    assert.ok(!FLAGS.has(c.truedone.verdict), `${id} is ${c.truedone.verdict}`);
    assert.ok(c.expected.reason.length > 40, `${id} carries its reason`);
    assert.match(page(result), new RegExp(`\\| ${c.scenario} \\| [^|]+\\| green \\| no \\| `));
  }
  assert.equal(result.summary.not_detected_by_design, 2);
});

test('baseline CI is green on every case but the flaky one, which fails on its first run', () => {
  for (const c of result.cases) assert.equal(c.baseline_ci, c.id === '08-flaky-test' ? 'fail' : 'pass', c.id);
  assert.equal(result.summary.baseline_ci_green, 8);
});

test('the check passes on the nine cases and fails when an expected outcome is not met', () => {
  assert.deepEqual(check(result), []);
  assert.equal(result.summary.met, 9);
  const wrong = JSON.parse(JSON.stringify(result));
  wrong.cases[0].met = false;
  wrong.cases[0].problems = ['verdict tampered, expected proven'];
  assert.deepEqual(check(wrong), ['01-assertion-weakened: verdict tampered, expected proven']);
});

test('a fixture whose expectation is wrong fails the bench, through the real run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-detect-wrong-'));
  try {
    const src = path.join(FIXTURES, '09-legitimate-test-refactor');
    fs.cpSync(src, path.join(dir, '09-legitimate-test-refactor'), { recursive: true });
    const meta = JSON.parse(fs.readFileSync(path.join(src, 'case.json'), 'utf8'));
    meta.expected.verdict = 'tampered';
    fs.writeFileSync(path.join(dir, '09-legitimate-test-refactor', 'case.json'), JSON.stringify(meta));
    const run = await runBench(dir);
    assert.equal(run.cases.length, 1);
    assert.equal(run.cases[0].met, false);
    assert.deepEqual(check(run), ['09-legitimate-test-refactor: verdict proven_weak, expected tampered']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the results are deterministic: a second run gives the same bytes, with no timings', async () => {
  const again = await runBench();
  assert.equal(JSON.stringify(again), JSON.stringify(result));
  assert.ok(!JSON.stringify(result).includes('duration'));
  assert.match(page(result), /baseline CI/);
});
