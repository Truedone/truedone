// CLI-02-AC01 (PV-L07): npx truedone init appends the three-line snippet to AGENTS.md if it exists, else to CLAUDE.md
// if it exists, else creates AGENTS.md. Existing bytes stay a prefix of the file, a second run writes nothing, and it
// prints what it wrote. The expected lines are read from test/fixtures/init/snippet.md, never from init.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../src/init.mjs';

const LINES = fs.readFileSync(fileURLToPath(new URL('./fixtures/init/snippet.md', import.meta.url)), 'utf8').trimEnd().split('\n');

function repo(t, files = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-init-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(d, f), body);
  return d;
}
const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');
const quiet = () => { const out = []; return { out, log: (s) => out.push(s) }; };

test('with neither file, init creates AGENTS.md holding exactly the three lines', (t) => {
  const d = repo(t);
  init(d, quiet());
  assert.equal(read(d, 'AGENTS.md'), LINES.join('\n') + '\n');
  assert.equal(fs.existsSync(path.join(d, 'CLAUDE.md')), false);
});

test('AGENTS.md wins when both exist: it is appended to and CLAUDE.md is untouched', (t) => {
  const agents = '# Agents\n\nBuild with make.\n', claude = '# Claude\n';
  const d = repo(t, { 'AGENTS.md': agents, 'CLAUDE.md': claude });
  init(d, quiet());
  const after = read(d, 'AGENTS.md');
  assert.ok(after.startsWith(agents), 'the existing bytes are a prefix');
  assert.deepEqual(after.slice(agents.length).split('\n').filter(Boolean), LINES);
  assert.equal(read(d, 'CLAUDE.md'), claude);
});

test('with only CLAUDE.md, init appends to it and creates no AGENTS.md', (t) => {
  const claude = 'Use pnpm.\n';
  const d = repo(t, { 'CLAUDE.md': claude });
  init(d, quiet());
  const after = read(d, 'CLAUDE.md');
  assert.ok(after.startsWith(claude));
  assert.deepEqual(after.slice(claude.length).split('\n').filter(Boolean), LINES);
  assert.equal(fs.existsSync(path.join(d, 'AGENTS.md')), false);
});

test('a second run leaves the file byte for byte as the first run left it, and says nothing was written', (t) => {
  const d = repo(t, { 'AGENTS.md': 'x\n' });
  init(d, quiet());
  const once = read(d, 'AGENTS.md');
  const q = quiet();
  const r = init(d, q);
  assert.equal(read(d, 'AGENTS.md'), once);
  assert.deepEqual(r.written, []);
  assert.match(q.out.join('\n'), /AGENTS\.md/);
  assert.match(q.out.join('\n'), /nothing written/);
});

test('a last line with no newline keeps its bytes, and each snippet line lands on a line of its own', (t) => {
  const d = repo(t, { 'AGENTS.md': 'last line' });
  init(d, quiet());
  const after = read(d, 'AGENTS.md');
  assert.ok(after.startsWith('last line\n'));
  const lines = after.split('\n');
  assert.equal(lines[0], 'last line');
  for (const l of LINES) assert.ok(lines.includes(l), `on its own line: ${l}`);
});

test('a CRLF file is appended to with CRLF', (t) => {
  const body = '# Agents\r\nRun tests.\r\n';
  const d = repo(t, { 'AGENTS.md': body });
  init(d, quiet());
  const tail = read(d, 'AGENTS.md').slice(body.length);
  assert.equal(tail.replace(/\r\n/g, ''), tail.replace(/\r?\n/g, ''), 'every newline added is CRLF');
  assert.deepEqual(tail.split('\r\n').filter(Boolean), LINES);
});

test('init prints the file it wrote and each line it added', (t) => {
  const d = repo(t);
  const q = quiet();
  const r = init(d, q);
  assert.equal(r.file, 'AGENTS.md');
  assert.deepEqual(r.written, LINES);
  const printed = q.out.join('\n');
  assert.match(printed, /AGENTS\.md/);
  for (const l of LINES) assert.ok(printed.includes(l), `printed: ${l}`);
});

test('existing snippet lines are not added again; only the missing ones are appended', (t) => {
  const body = `# Agents\n${LINES[1]}\n`;
  const d = repo(t, { 'AGENTS.md': body });
  const r = init(d, quiet());
  const after = read(d, 'AGENTS.md');
  assert.ok(after.startsWith(body));
  assert.deepEqual(r.written, [LINES[0], LINES[2]]);
  assert.equal(after.split('\n').filter((l) => l === LINES[1]).length, 1);
});
