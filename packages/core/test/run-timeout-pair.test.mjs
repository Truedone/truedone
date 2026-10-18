// RUN-06-AC02: a run that times out pairs with the other side's rows of that file and gives Could not run: timed out,
// never a head-only row judged No red-green evidence. The stand-in runner times out where the case says and otherwise
// writes the report the real runner writes (node --test: junit with classname="test" and no file; jest: absolute
// suite paths), as measured on 2026-10-18.
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

const FILES = { 'test/a.test.js': ['t1', 't2'], 'test/b.test.js': ['t3'] };
const NODE = 'node --test --test-reporter=junit --test-reporter-destination={report} {files}';
const JEST = 'npx --no -- jest --json --outputFile={report} {files}';
const ASSERTION = '<failure type="testCodeFailure" message="1 == 2">[Error [ERR_TEST_FAILURE]: 1 == 2] { code: \'ERR_TEST_FAILURE\', cause: AssertionError [ERR_ASSERTION]: 1 == 2 }</failure>';

function write(runner, cwd, out, files, fail) {
  if (runner === 'node-test') {
    const cases = files.flatMap((f) => FILES[f].map((n) => (fail ? `<testcase name="${n}" time="0.001" classname="test" failure="1 == 2">${ASSERTION}</testcase>` : `<testcase name="${n}" time="0.001" classname="test"/>`)));
    writeFileSync(path.join(cwd, out), `<testsuites>\n${cases.join('\n')}\n</testsuites>\n`);
    return;
  }
  const results = files.map((f) => ({
    name: path.join(realpathSync(cwd), f),
    assertionResults: FILES[f].map((n) => ({ fullName: n, title: n, status: fail ? 'failed' : 'passed', duration: 1, failureMessages: fail ? ['Error: expect(received).toBe(expected)'] : [] })),
  }));
  writeFileSync(path.join(cwd, out), JSON.stringify({ testResults: results }));
}

// timeout: 'base' or 'head', the side whose every run times out; the other side passes, or on base fails by assertion
function stand(runner, timeout) {
  return (command, { cwd }) => {
    const out = command.match(/\.truedone-report-\S+/)[0];
    const side = out.includes('-base-') ? 'base' : 'head';
    if (side === timeout) return { code: null, stdout: '', stderr: '', timedOut: true };
    const files = Object.keys(FILES).filter((f) => command.split(/\s+/).includes(f));
    write(runner, cwd, out, files, side === 'base');
    return { code: 0, stdout: '', stderr: '', timedOut: false };
  };
}

async function run(runner, timeout) {
  const root = repo('td-tpair-');
  try {
    const tests = Object.keys(FILES).map((file) => ({ test: file, runner, cwd: '.', file, command: runner === 'jest' ? JEST : NODE, reporter: runner === 'jest' ? 'jest-json' : 'junit' }));
    return await redGreen({ root, tests, files: [], base: 'b', head: 'h', exec: stand(runner, timeout) });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const KEYS = Object.entries(FILES).flatMap(([f, names]) => names.map((n) => [f, n]));

for (const runner of ['node-test', 'jest']) {
  test(`${runner}: a base timeout pairs with that file's head rows and gives Could not run: timed out`, async () => {
    const report = await run(runner, 'base');
    assert.deepEqual(report.tests.map((t) => [t.file, t.name]), KEYS, 'one row a test, no row for the whole file');
    for (const t of report.tests) {
      assert.deepEqual(t.base, ['timeout', 'timeout'], t.name);
      assert.deepEqual(t.head, ['pass', 'pass', 'pass'], t.name);
      assert.equal(outcome(t).result, 'Could not run: timed out', t.name);
    }
    assert.equal(report.could_not_run?.reason, 'timeout');
    assert.equal(judge({ verdict: 'unrun' }, [report]).verdict, 'could_not_run');
  });

  test(`${runner}: a head timeout pairs with that file's base rows and gives Could not run: timed out`, async () => {
    const report = await run(runner, 'head');
    assert.deepEqual(report.tests.map((t) => [t.file, t.name]), KEYS);
    for (const t of report.tests) {
      assert.deepEqual(t.base, ['fail:assertion', 'fail:assertion'], t.name);
      assert.deepEqual(t.head, ['timeout', 'timeout', 'timeout'], t.name);
      assert.equal(outcome(t).result, 'Could not run: timed out', t.name);
    }
  });
}
