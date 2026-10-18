// RUN-06-AC01: each row of a red-green report is keyed by the test file's path from the repository root and the test's
// name, for vitest, jest, mocha, node --test and pytest. The stand-in runner writes each report in the shape the real
// runner writes it, as measured on 2026-10-18 with jest 30.5.2, vitest 3.2.7, mocha 11.8.0, node 22.11.0 and pytest
// 9.0.3: jest and vitest give testResults[].name as an absolute path, mocha tests[].file as an absolute path;
// node --test's junit report has classname="test" and no file at all; pytest's junit classname is the file's dotted
// path. Two files in a package directory each have a test named "same".
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { redGreen } from '../run/run.mjs';

// a git repository, as the base swap needs
function repo(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
  return dir;
}

const RUNNERS = {
  jest: { reporter: 'jest-json', command: 'npx --no -- jest --json --outputFile={report} {files}', files: ['test/a.test.js', 'test/b.test.js'], name: 'same' },
  vitest: { reporter: 'vitest-json', command: 'npx --no -- vitest run --reporter=json --outputFile={report} {files}', files: ['test/a.test.js', 'test/b.test.js'], name: 'same' },
  mocha: { reporter: 'mocha-json', command: 'npx --no -- mocha --reporter json --reporter-option output={report} {files}', files: ['test/a.test.js', 'test/b.test.js'], name: 'same' },
  'node-test': { reporter: 'junit', command: 'node --test --test-reporter=junit --test-reporter-destination={report} {files}', files: ['test/a.test.js', 'test/b.test.js'], name: 'same' },
  pytest: { reporter: 'junit', command: 'python3 -m pytest --junitxml={report} {files}', files: ['tests/test_a.py', 'tests/test_b.py'], name: 'test_same' },
};

// the report the runner writes for the files on its command line, every test passing
function report(runner, cwd, files) {
  const abs = (f) => path.join(realpathSync(cwd), f);
  const name = RUNNERS[runner].name;
  if (runner === 'jest' || runner === 'vitest') {
    return JSON.stringify({ testResults: files.map((f) => ({ name: abs(f), assertionResults: [{ fullName: name, title: name, status: 'passed', duration: 1, failureMessages: [] }] })) });
  }
  if (runner === 'mocha') {
    const tests = files.map((f) => ({ title: name, fullTitle: name, file: abs(f), duration: 1, err: {} }));
    return JSON.stringify({ tests, passes: tests, failures: [] });
  }
  if (runner === 'node-test') return `<?xml version="1.0" encoding="utf-8"?>\n<testsuites>\n${files.map(() => `\t<testcase name="${name}" time="0.000835" classname="test"/>`).join('\n')}\n</testsuites>\n`;
  const cases = files.map((f) => `<testcase classname="${f.replace(/\.py$/, '').split('/').join('.')}" name="${name}" time="0.000" />`).join('');
  return `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="0" skipped="0" tests="${files.length}">${cases}</testsuite></testsuites>`;
}

function stand(runner, seen) {
  return (command, { cwd }) => {
    const out = command.match(/\.truedone-report-\S+/)[0];
    const files = RUNNERS[runner].files.filter((f) => command.split(/\s+/).includes(f));
    seen.push(files);
    writeFileSync(path.join(cwd, out), report(runner, cwd, files));
    return { code: 0, stdout: '', stderr: '', timedOut: false };
  };
}

for (const [runner, r] of Object.entries(RUNNERS)) {
  test(`${runner}: each row is the test file's path from the root and the test's name`, async () => {
    const root = repo('td-keys-');
    const seen = [];
    try {
      const tests = r.files.map((file) => ({ test: `pkg/${file}`, runner, cwd: 'pkg', file, command: r.command, reporter: r.reporter }));
      mkdirSync(path.join(root, 'pkg'), { recursive: true });
      const got = await redGreen({ root, tests, files: [], base: 'b', head: 'h', exec: stand(runner, seen) });
      assert.deepEqual(got.tests.map((t) => [t.file, t.name]), r.files.map((f) => [`pkg/${f}`, r.name]));
      for (const t of got.tests) {
        assert.equal(t.base.length, 2, t.file);
        assert.deepEqual(t.head, ['pass', 'pass', 'pass'], t.file);
      }
      if (runner === 'node-test') assert.deepEqual(seen, Array.from({ length: 5 }, () => r.files.map((f) => [f])).flat(), 'one file a run');
      else assert.equal(seen.length, 5);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
