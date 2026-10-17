// PLG-01-AC02 (PV-P03): a refactor with no test is never blocked, even when the agent says tests pass, and its
// No red-green evidence finding is shown to the user once, not at every Stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hook } from '../src/plugin/stop.mjs';

function run(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-refactor-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const tp = path.join(d, 't.jsonl');
  const rows = [
    { type: 'user', message: { role: 'user', content: 'tidy add' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/repo/src/add.mjs' } }] } },
    { type: 'user', message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Refactored add. All tests pass.' }] } },
  ];
  fs.writeFileSync(tp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  let ran = 0;
  const deps = {
    localInput: () => ({ input: { files: [{ path: 'src/add.mjs', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }], pr: { title: '', body: '', author: { login: 'a', type: 'User' } } } }),
    analyse: () => ({ schema: 'truedone.verdict/1', verdict: 'no_evidence', label: 'truedone:no-evidence', partial: false, reasons: [], next: '' }),
    classify: () => 'source',
    detect: () => [],
    runSide: async () => { ran++; return { tests: [], problem: null, runner: null }; },
    dataDir: path.join(d, 'data'),
  };
  const input = JSON.stringify({ session_id: 's', transcript_path: tp, cwd: '/repo', hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Refactored add. All tests pass.' });
  return { stop: () => hook(input, deps), ran: () => ran };
}

test('a refactor with no test is not blocked, even with a claim that tests pass', async (t) => {
  const r = run(t);
  const out = await r.stop();
  assert.notEqual(out?.decision, 'block');
  assert.equal(r.ran(), 0, 'no test to run');
});

test('the No red-green evidence finding is shown once, then not again for the same change', async (t) => {
  const r = run(t);
  const first = await r.stop(), second = await r.stop(), third = await r.stop();
  assert.match(first?.systemMessage ?? '', /No red-green evidence/);
  assert.equal(second, null);
  assert.equal(third, null);
});
