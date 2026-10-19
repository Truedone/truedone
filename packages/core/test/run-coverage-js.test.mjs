// RUN-04-AC02 (D8): JavaScript coverage of changed lines gives condition
// lines on a live fixture. The fixture's head adds a second export and the
// test calls it; the covered offset sits in the changed line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { conditionFor } from '../run/coverage.mjs';

const git = (...a) => { const r = spawnSync('git', a, { cwd: process.argv[2] ?? os.tmpdir(), encoding: 'utf8' }); return r.stdout?.trim(); };

function fixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-js-'));
  // TEST-01: git maintenance off, so no detached auto-maintenance writes into .git while the directory is removed (MAP-02)
  const cfg = ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0'];
  execFileSync('git', [...cfg, 'init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fx', private: true, scripts: { test: 'node --test' } }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'calc.mjs'), 'export function f() { return 1; }\n');
  execFileSync('git', [...cfg, 'add', '.']);
  execFileSync('git', [...cfg, 'commit', '-q', '-m', 'base']);
  const base = execFileSync('git', [...cfg, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(dir, 'src', 'calc.mjs'), 'export function f() { return 1; }\nexport function g() { return 2; }\n');
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'a.test.mjs'), `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as calc from "../src/calc.mjs";\ntest("f and g", () => {\n  assert.equal(calc.f(), 1);\n  assert.equal(calc.g(), 2);\n});\n`);
  execFileSync('git', [...cfg, 'add', '.']);
  execFileSync('git', [...cfg, 'commit', '-q', '-m', 'head']);
  return { dir, base };
}

test('changed lines the test ran give condition lines', () => {
  const f = fixtureRepo();
  const covDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-dir-'));
  const testFile = path.join(f.dir, 'test', 'a.test.mjs');
  const run = spawnSync(process.execPath, [testFile], { cwd: f.dir, env: { ...process.env, NODE_V8_COVERAGE: covDir }, encoding: 'utf8' });
  assert.equal(run.status, 0, 'the fixture test passes on head');
  const files = [
    { path: 'src/calc.mjs', status: 'modified', base: 'export function f() { return 1; }\n' },
    { path: 'test/a.test.mjs', status: 'added', base: null },
  ];
  const verdict = conditionFor({ coverageDir: covDir, root: f.dir, files, tests: ['test/a.test.mjs'] });
  assert.equal(verdict.condition, 'lines');
  assert.equal(verdict.linesHold, true);
  assert.equal(verdict.sawCoverage, true);
  fs.rmSync(covDir, { recursive: true, force: true });
});
