// RUN-07-AC01 (red-green): a base leg with one whole-file import failure for
// a file the pull request adds, and a head leg with three passes of two named
// tests, is a red-green verdict: the import failure is the red, not an
// incomplete run. The junit shape is the one node --test writes for a file
// that fails to load: one testcase named after the file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { redGreen } from '../run/run.mjs';
import { verdictId } from '../src/outcome.mjs';
import { analyse } from '../src/analyse.mjs';
import { judge } from '../src/judge.mjs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

const LOAD_JUNIT = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<testsuites>',
  '\t<testcase name="new-module.test.mjs" time="0.05" classname="test" failure="test failed">',
  '\t\t<failure type="testCodeFailure" message="test failed">[Error: test failed]</failure>',
  '\t</testcase>',
  '</testsuites>',
  '',
].join('\n');

const HEAD_JUNIT = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<testsuites>',
  '\t<testcase name="mul multiplies" time="0.01" classname="test"/>',
  '\t<testcase name="mul negatives" time="0.01" classname="test"/>',
  '</testsuites>',
  '',
].join('\n');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run07-'));
  const cfg = ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com'];
  git('init', '-q', '-b', 'main', dir);
  fs.mkdirSync(path.join(dir, 'src', 'smoke'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'smoke', 'mul.mjs'), 'export const mul = (a, b) => a * b;\n');
  fs.writeFileSync(path.join(dir, 'new-module.test.mjs'), 'import { mul } from "./src/smoke/mul.mjs";\ntest("mul multiplies", () => {});\n');
  return dir;
}

function fakeExec() {
  return async (command, { cwd }) => {
    const junit = /truedone-report-base-/.test(command) ? LOAD_JUNIT : HEAD_JUNIT;
    const m = command.match(/\.truedone-report-[^\s']+/);
    if (m) fs.writeFileSync(path.join(cwd, m[0]), junit);
    return { code: 0, stdout: junit, stderr: '', timedOut: false };
  };
}

const tests = [
  { file: 'new-module.test.mjs', test: 'mul multiplies', runner: 'node-test', cwd: '.', reporter: 'junit', command: 'node --test --test-reporter=junit {files} {report}' },
];

const addedFiles = [
  { path: 'new-module.test.mjs', status: 'A', base: null, head: 'import { mul } from "./src/smoke/mul.mjs";\n' },
  { path: 'src/smoke/mul.mjs', status: 'A', base: null, head: 'export const mul = (a, b) => a * b;\n' },
];

test('a base-leg import failure for an added file is the red for every head test of that file', async () => {
  const report = await redGreen({
    root: fixture(),
    tests,
    files: addedFiles,
    base: 'b'.repeat(40),
    head: 'h'.repeat(40),
    exec: fakeExec(),
  });
  assert.equal(report.could_not_run, null, 'the verdict is not Could not run');
  assert.equal(report.tests.length, 2, 'the file-level row did not become a phantom test');
  for (const entry of report.tests) {
    assert.deepEqual(entry.base, ['fail:missing', 'fail:missing'], `${entry.name}: the import failure is not the red`);
    assert.deepEqual(entry.head, ['pass', 'pass', 'pass'], `${entry.name}: the head is not green`);
    assert.equal(verdictId(entry), 'proven_weak', `${entry.name}: not a red-green verdict`);
  }
  assert.deepEqual(report.tests.map((t) => t.name).sort(), ['mul multiplies', 'mul negatives']);
  assert.equal(report.load_failures.length, 1);
  assert.equal(report.load_failures[0].file, 'new-module.test.mjs');
  assert.match(report.load_failures[0].detail, /could not load/);
  assert.match(report.load_failures[0].detail, /the pull request adds/);
});

test('with the coverage annotation the report judges truedone:yes', async () => {
  const report = await redGreen({
    root: fixture(),
    tests,
    files: addedFiles,
    base: 'b'.repeat(40),
    head: 'h'.repeat(40),
    exec: fakeExec(),
  });
  const annotated = {
    ...report,
    tests: report.tests.map((t) => ({ ...t, condition: 'imports', asserts_new_symbol: true })),
  };
  const pr = { title: '', body: '', author: { login: 'a', type: 'User' } };
  const o = judge(analyse({ files: addedFiles, pr, releases: [] }), [annotated]);
  assert.equal(o.verdict, 'proven_new');
  assert.equal(o.label, 'truedone:yes');
});

test('a base-leg failure for a file the pull request does not add stays incomplete', async () => {
  const modified = [
    { path: 'new-module.test.mjs', status: 'M', base: 'old\n', head: 'new\n' },
  ];
  const report = await redGreen({
    root: fixture(),
    tests,
    files: modified,
    base: 'b'.repeat(40),
    head: 'h'.repeat(40),
    exec: fakeExec(),
  });
  assert.equal(report.load_failures, undefined, 'a non-added file failure must not be named a load failure');
  assert.ok(report.tests.length >= 1, 'the report still carries the tests');
  for (const entry of report.tests) {
    assert.equal(verdictId(entry), 'could_not_run', `${entry.name}: a non-added file failure must stay Could not run`);
  }
});
