import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const node = process.execPath;

function run(argv) {
  return spawnSync(node, ['tools/bundle.mjs', ...argv], { cwd: root, encoding: 'utf8' });
}

test('the bundler builds one file', () => {
  const r = run([]);
  assert.equal(r.status, 0, r.stderr);
  const core = readFileSync(path.join(root, 'packages/core/core.mjs'), 'utf8');
  const web = readFileSync(path.join(root, 'packages/web/core.mjs'), 'utf8');
  assert.equal(core, web);
  assert.equal(/^import\s/m.test(core), false);
  assert.equal(/^\s*\/\//m.test(core), false);
  assert.match(core, /export function analyse/);
  assert.match(core, /export function judge/);
  assert.match(core, /\[\\s\\S\]\*\?/);
});

test('the bundler refuses a non-local import', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bundle-'));
  const out = path.join(dir, 'out.mjs');
  try {
    writeFileSync(path.join(dir, 'bad.mjs'), 'import { readFileSync } from "node:fs";\nexport const value = 1;\n');
    const r = run(['--src', dir, '--out', out, '--no-copy']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a local named import/);
    assert.equal(existsSync(out), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the bundler refuses a namespace import', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bundle-'));
  const out = path.join(dir, 'out.mjs');
  try {
    writeFileSync(path.join(dir, 'bad.mjs'), 'import * as msg from "./m.mjs";\nexport const value = 1;\n');
    const r = run(['--src', dir, '--out', out, '--no-copy']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a local named import/);
    assert.equal(existsSync(out), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
