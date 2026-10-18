// RUN-06-AC04: a test without two base runs and three head runs, because a run gave no result for it, is Could not
// run with the reason "incomplete runs", never No red-green evidence (docs/spec.md, the one red-green table). Shown on
// outcome() and judge(), and through the runner: a run whose report has no result for a test leaves that test short
// of a run, and no stand-in result fills the gap.
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { judge } from '../src/judge.mjs';
import { outcome } from '../src/outcome.mjs';
import { redGreen } from '../run/run.mjs';

// a git repository, as the base swap needs
function repo(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
  return dir;
}

const INCOMPLETE = { result: 'Could not run: incomplete runs', reason: 'incomplete runs', detail: 'incomplete runs' };
const row = (base, head) => ({ file: 'a.test.js', name: 't', base, head, condition: 'lines', asserts_new_symbol: false });

test('one base run, no base run, or one or two head runs is Could not run: incomplete runs', () => {
  for (const [base, head] of [
    [['fail:assertion'], ['pass', 'pass', 'pass']],
    [['pass'], ['pass', 'pass', 'pass']],
    [[], ['pass', 'pass', 'pass']],
    [['fail:assertion', 'fail:assertion'], ['pass', 'pass']],
    [['pass', 'pass'], ['pass']],
    [['fail:assertion', 'fail:assertion'], []],
  ]) assert.deepEqual(outcome(row(base, head)), INCOMPLETE, JSON.stringify([base, head]));
  assert.equal(outcome(row(['fail:assertion', 'fail:assertion'], ['pass', 'pass', 'pass'])).result, 'Proven', 'two and three runs go to the table');
});

test('judge() gives Could not run for a report whose only test has incomplete runs', () => {
  const report = { schema: 'truedone.report/1', tests: [row(['pass'], ['pass', 'pass', 'pass'])], could_not_run: null, truncated: false };
  const got = judge({ verdict: 'unrun', reasons: [] }, [report]);
  assert.equal(got.verdict, 'could_not_run');
  assert.equal(got.label, 'truedone:could-not-run');
});

// jest, as measured: absolute suite paths. The case names the runs whose report leaves the test out.
function stand(missing) {
  return (command, { cwd }) => {
    const out = command.match(/\.truedone-report-\S+/)[0];
    const tag = out.replace('.truedone-report-', '');
    const tests = [{ fullName: 'kept', title: 'kept', status: 'passed', duration: 1, failureMessages: [] }];
    if (!missing.includes(tag)) tests.push({ fullName: 't', title: 't', status: tag.startsWith('base') ? 'failed' : 'passed', duration: 1, failureMessages: tag.startsWith('base') ? ['Error: expect(received).toBe(expected)'] : [] });
    writeFileSync(path.join(cwd, out), JSON.stringify({ testResults: [{ name: path.join(realpathSync(cwd), 'a.test.js'), assertionResults: tests }] }));
    return { code: 1, stdout: '', stderr: '', timedOut: false };
  };
}

for (const missing of [['base-1'], ['head-2'], ['base-0', 'base-1']]) {
  test(`a test the report leaves out of ${missing.join(' and ')} is Could not run: incomplete runs`, async () => {
    const root = repo('td-incomplete-');
    try {
      const tests = [{ test: 'a.test.js', runner: 'jest', cwd: '.', file: 'a.test.js', command: 'npx --no -- jest --json --outputFile={report} {files}', reporter: 'jest-json' }];
      const report = await redGreen({ root, tests, files: [], base: 'b', head: 'h', exec: stand(missing) });
      const t = report.tests.find((x) => x.name === 't');
      assert.ok(t, 'the test has a row');
      assert.equal(t.base.length + t.head.length, 5 - missing.length, 'one run fewer for each run that left it out');
      assert.deepEqual(outcome(t), INCOMPLETE);
      assert.equal(report.could_not_run, null, 'the report keeps the spec\'s reasons; incomplete runs is the row\'s');
      const kept = report.tests.find((x) => x.name === 'kept');
      assert.deepEqual([kept.base, kept.head], [['pass', 'pass'], ['pass', 'pass', 'pass']]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
