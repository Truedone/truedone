// RUN-06-AC03: two files with a test of the same name stay two rows, and each is judged by its own base: the one whose
// base failed can be Proven, the one whose base passed never is. node --test's junit report (classname="test", no file)
// and pytest's (a dotted classname, no file) are written as measured on 2026-10-18 with node 22.11.0 and pytest 9.0.3.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { verdictId } from '../src/outcome.mjs';
import { redGreen } from '../run/run.mjs';

// a git repository, as the base swap needs
function repo(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
  return dir;
}

const RUNNERS = {
  'node-test': { files: ['test/a.test.js', 'test/b.test.js'], name: 'same', command: 'node --test --test-reporter=junit --test-reporter-destination={report} {files}' },
  pytest: { files: ['tests/test_a.py', 'tests/test_b.py'], name: 'test_same', command: 'python3 -m pytest --junitxml={report} {files}' },
};

function junit(runner, files, failing) {
  const name = RUNNERS[runner].name;
  if (runner === 'node-test') {
    const cases = files.map((f) => (failing.includes(f)
      ? `\t<testcase name="${name}" time="0.001" classname="test" failure="1 == 2"><failure type="testCodeFailure" message="1 == 2">[Error [ERR_TEST_FAILURE]: 1 == 2] { cause: AssertionError [ERR_ASSERTION]: 1 == 2 }</failure></testcase>`
      : `\t<testcase name="${name}" time="0.001" classname="test"/>`));
    return `<testsuites>\n${cases.join('\n')}\n</testsuites>\n`;
  }
  const cases = files.map((f) => {
    const classname = f.replace(/\.py$/, '').split('/').join('.');
    return failing.includes(f)
      ? `<testcase classname="${classname}" name="${name}" time="0.001"><failure message="assert 1 == 2">&gt;       assert 1 == 2\nE       assert 1 == 2\n\n${f}:2: AssertionError</failure></testcase>`
      : `<testcase classname="${classname}" name="${name}" time="0.000" />`;
  });
  return `<testsuites name="pytest tests"><testsuite name="pytest" tests="${files.length}">${cases.join('')}</testsuite></testsuites>`;
}

// on base, the file named fails by assertion; on head every test passes
function stand(runner, failsOnBase) {
  return (command, { cwd }) => {
    const out = command.match(/\.truedone-report-\S+/)[0];
    const files = RUNNERS[runner].files.filter((f) => command.split(/\s+/).includes(f));
    writeFileSync(path.join(cwd, out), junit(runner, files, out.includes('-base-') ? [failsOnBase] : []));
    return { code: 0, stdout: '', stderr: '', timedOut: false };
  };
}

for (const [runner, r] of Object.entries(RUNNERS)) {
  for (const failing of r.files) {
    test(`${runner}: two files with a test named ${r.name} stay two rows, and only ${failing}, whose base failed, has red-green evidence`, async () => {
      const root = repo('td-same-');
      try {
        const tests = r.files.map((file) => ({ test: file, runner, cwd: '.', file, command: r.command, reporter: 'junit' }));
        const report = await redGreen({ root, tests, files: [], base: 'b', head: 'h', exec: stand(runner, failing) });
        assert.deepEqual(report.tests.map((t) => [t.file, t.name]), r.files.map((f) => [f, r.name]));
        for (const t of report.tests) {
          assert.deepEqual(t.head, ['pass', 'pass', 'pass'], t.file);
          if (t.file === failing) {
            assert.deepEqual(t.base, ['fail:assertion', 'fail:assertion'], t.file);
            assert.equal(verdictId(t), 'proven_weak', `${t.file}: its own base failed (no coverage condition here)`);
          } else {
            assert.deepEqual(t.base, ['pass', 'pass'], t.file);
            assert.equal(verdictId(t), 'no_evidence', `${t.file}: its base passed`);
          }
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
}
