// RUN-04-AC04 (D8): Python coverage of changed lines gives condition lines on
// a live pytest fixture, through the generated plugin: sys.monitoring on 3.12
// and newer, sys.settrace below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { conditionFor, writePythonPlugin } from '../run/coverage.mjs';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-py-'));
  fs.mkdirSync(path.join(dir, 'pkg'));
  fs.writeFileSync(path.join(dir, 'pkg', 'calc.py'), 'def f():\n    return 1\n');
  fs.writeFileSync(path.join(dir, 'test_calc.py'), 'from pkg.calc import f\n\ndef test_f():\n    assert f() == 1\n');
  return dir;
}

test('changed python lines the test ran give condition lines through the plugin', () => {
  const dir = fixture();
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-py-plugin-'));
  const plugin = writePythonPlugin(pluginDir);
  assert.equal(path.basename(plugin), 'truedone_coverage_plugin.py');
  const out = path.join(pluginDir, 'py-coverage.json');
  const changed = 'def f():\n    return 1\n\ndef g():\n    return 2\n';
  fs.writeFileSync(path.join(dir, 'pkg', 'calc.py'), changed);
  const run = spawnSync('python3', ['-m', 'pytest', 'test_calc.py', '-p', 'truedone_coverage_plugin', '-q'], {
    cwd: dir,
    env: { ...process.env, PYTHONPATH: `${pluginDir}${path.delimiter}${process.env.PYTHONPATH ?? ''}`, TRUEDONE_PY_COVERAGE_OUT: out, TRUEDONE_PY_ROOT: dir },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `the fixture pytest run passes: ${run.stderr?.slice(0, 300)}`);
  assert.ok(fs.existsSync(out), 'the plugin wrote its coverage file');
  const files = [{ path: 'pkg/calc.py', status: 'modified', base: 'def f():\n    return 1\n' }];
  const verdict = conditionFor({ coverageDir: path.join(dir, 'none'), pythonCoverageFile: out, root: dir, files, tests: ['test_calc.py'] });
  assert.equal(verdict.condition, 'lines', 'the changed line g ran under the test');
  assert.equal(verdict.linesHold, true);
});
