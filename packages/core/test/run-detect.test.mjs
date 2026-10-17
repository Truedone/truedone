// RUN-01-AC01 (PV-X06): runner detection gives the right runner, directory and reporter for every fixture project in
// test/fixtures/projects/index.json, both from files on disk (detect) and from the same manifests passed as data
// (detectFromManifests). Each command uses the runner's built-in machine reporter from docs/spec.md (Runners).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, detectFromManifests } from '../run/detect.mjs';

const { projects } = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/projects/index.json', import.meta.url)), 'utf8'));
// the reporter flag docs/spec.md names for each runner
const FLAG = { jest: '--json', vitest: '--reporter=json', mocha: '--reporter json', 'node-test': '--test-reporter=junit', pytest: '--junitxml' };

function check(p, r) {
  const e = p.expect;
  if (e.runner === null) {
    assert.equal(r.runner, null, `${p.name}: no runner`);
    assert.ok(typeof r.reason === 'string' && r.reason.includes(e.reason), `${p.name}: the reason names ${e.reason}: ${r.reason}`);
    return;
  }
  assert.deepEqual([r.runner, r.cwd, r.reporter], [e.runner, e.cwd, e.reporter], p.name);
  assert.ok(r.command.includes(FLAG[e.runner]), `${p.name}: ${r.command} uses ${FLAG[e.runner]}`);
  assert.ok(r.command.includes('{files}'), `${p.name}: ${r.command} takes {files}`);
  assert.equal(path.posix.join(r.cwd, r.file), p.test, `${p.name}: the file is given relative to cwd`);
  if (e.command_has) assert.ok(r.command.includes(e.command_has), `${p.name}: ${r.command} keeps ${e.command_has}`);
}

assert.ok(projects.length >= 15, 'at least 15 fixture projects');

for (const p of projects) {
  test(`${p.name}: from files`, (t) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-detect-'));
    t.after(() => fs.rmSync(d, { recursive: true, force: true }));
    for (const [f, body] of Object.entries(p.files)) {
      fs.mkdirSync(path.join(d, path.dirname(f)), { recursive: true });
      fs.writeFileSync(path.join(d, f), body);
    }
    fs.mkdirSync(path.join(d, path.dirname(p.test)), { recursive: true });
    fs.writeFileSync(path.join(d, p.test), '');
    const [r] = detect(d, [p.test]);
    assert.equal(r.test, p.test);
    check(p, r);
  });
  test(`${p.name}: from manifests passed as data`, () => {
    check(p, detectFromManifests(p.files, p.test));
  });
}

test('detect gives one result per changed test file, each from its own nearest manifest', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-detect-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const files = { 'package.json': '{"scripts":{"test":"vitest run"}}', 'svc/pyproject.toml': '[tool.pytest.ini_options]\n', 'svc/tests/test_x.py': '', 'web/a.test.ts': '' };
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.join(d, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  const r = detect(d, ['web/a.test.ts', 'svc/tests/test_x.py']);
  assert.deepEqual(r.map((x) => [x.test, x.runner, x.cwd]), [['web/a.test.ts', 'vitest', '.'], ['svc/tests/test_x.py', 'pytest', 'svc']]);
});
