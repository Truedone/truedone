// PLG-01-AC01 (PV-P02, PV-P05): each row of the plugin table in docs/spec.md blocks or passes as specified, on
// transcripts recorded in the shape Claude Code 2.1.302 writes (test/fixtures/transcripts/index.json, docs/plugin-
// hooks.md). core, the runner and git are stand-ins: the hook's own logic is what runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hook } from '../src/plugin/stop.mjs';
import { MAX_BLOCKS } from '../src/plugin/limits.mjs';

const { cases } = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/transcripts/index.json', import.meta.url)), 'utf8'));

function setup(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-hook-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
// the deps the bundle wires, as stand-ins driven by one case
function deps(c, dir) {
  return {
    localInput: () => ({ input: { files: c.files, pr: { title: '', body: '', author: { login: 'a', type: 'User' } } }, base: 'b'.repeat(40) }),
    analyse: () => ({ schema: 'truedone.verdict/1', verdict: c.verdict, label: null, partial: false, reasons: c.reasons, next: '' }),
    classify: (p) => (/\.test\.mjs$/.test(p) ? 'test' : 'source'),
    detect: (root, paths) => paths.map((p) => ({ test: p, runner: 'node-test', cwd: '.', file: p, command: 'node --test {files}', reporter: 'junit' })),
    runSide: async ({ side, times }) => { assert.deepEqual([side, times], ['head', 1], 'head runs only, once'); return { tests: c.runs, problem: null, runner: 'node-test' }; },
    dataDir: path.join(dir, 'data'),
  };
}
async function stop(c, dir, session = 's1') {
  const rows = c.expect.lagging ? c.transcript.slice(0, -1) : c.transcript;
  const tp = path.join(dir, `${session}.jsonl`);
  fs.writeFileSync(tp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const input = { session_id: session, transcript_path: tp, cwd: '/repo', hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: c.last_assistant_message };
  return hook(JSON.stringify(input), deps(c, dir));
}

for (const c of cases) {
  test(c.name, async (t) => {
    const out = await stop(c, setup(t));
    if (c.expect.block) {
      assert.equal(out?.decision, 'block');
      assert.match(out.reason, new RegExp(c.expect.reason));
    } else {
      assert.notEqual(out?.decision, 'block');
      if (c.expect.message) assert.match(out?.systemMessage ?? '', new RegExp(c.expect.message));
      else assert.equal(out?.systemMessage, undefined);
    }
  });
}

test(`row 6: after ${MAX_BLOCKS} blocks in a row with no change, the next Stop does not block and shows the finding`, async (t) => {
  const dir = setup(t);
  const c = cases.find((x) => x.name.startsWith('row 1'));
  const outs = [];
  for (let i = 0; i < MAX_BLOCKS + 1; i++) outs.push(await stop(c, dir));
  assert.deepEqual(outs.map((o) => o?.decision ?? null), [...Array(MAX_BLOCKS).fill('block'), null]);
  assert.match(outs[MAX_BLOCKS].systemMessage, /stopped blocking after 3 blocks/);
  assert.match(outs[MAX_BLOCKS].systemMessage, /fails? on a fresh run/);
});

test('row 6: a change after a block starts the count again', async (t) => {
  const dir = setup(t);
  const c = cases.find((x) => x.name.startsWith('row 1'));
  for (let i = 0; i < MAX_BLOCKS; i++) await stop(c, dir);
  const changed = { ...c, files: c.files.map((f) => ({ ...f, patch: f.patch + '\n+c' })) };
  assert.equal((await stop(changed, dir))?.decision, 'block');
});

test('the block count is kept per session', async (t) => {
  const dir = setup(t);
  const c = cases.find((x) => x.name.startsWith('row 1'));
  for (let i = 0; i < MAX_BLOCKS; i++) await stop(c, dir, 'one');
  assert.equal((await stop(c, dir, 'two'))?.decision, 'block');
});

test('a hook that throws never blocks: the error goes to the user', async () => {
  const { main } = await import('../src/plugin/stop.mjs');
  let written = '';
  const stdin = (async function* () { yield '{"session_id":"x","cwd":"/nope"}'; })();
  await main({ localInput: () => { throw new Error('no git here'); } }, { stdin, stdout: { write: (s) => { written += s; } } });
  const out = JSON.parse(written);
  assert.equal(out.decision, undefined);
  assert.match(out.systemMessage, /could not check this turn: no git here/);
});
