import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMirror, listMirror, pushMirror } from '../mirror-action.mjs';

test('the mirror tree holds one root action.yml and only its four files', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-'));
  buildMirror(path.resolve('.'), dest);
  const files = listMirror(dest);
  assert.deepEqual(files, ['LICENSE', 'README.md', 'action.yml', 'dist/index.mjs']);
  const actions = files.filter((file) => file.endsWith('action.yml'));
  assert.deepEqual(actions, ['action.yml']);
  const text = fs.readFileSync(path.join(dest, 'action.yml'), 'utf8');
  assert.match(text, /^name: 'truedone'/m);
});

test('a missing mirror token is refused before any send', () => {
  assert.throws(() => pushMirror(os.tmpdir(), { tag: 'v0.0.0', token: '' }), /MIRROR_TOKEN/);
});
