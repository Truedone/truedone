// PLG-01 with core/run's own runSide, not a stand-in: the hook reads runSide's { tests, problem, runner } as core/run
// returns it. Each case builds a scratch repository whose feature branch changes one source file and one node --test
// file, so a change to what runSide returns fails here instead of only in the installed plugin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hook } from '../src/plugin/stop.mjs';
import { localInput } from '../src/local.mjs';
import { analyse, classify } from '../../core/core.mjs';
import { detect } from '../../core/run/detect.mjs';
import { runSide } from '../../core/run/run.mjs';

// the outer node --test sets NODE_TEST_CONTEXT, which would make the inner run report to it instead of writing its file
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));

function setup(t, expected, side = (o) => runSide({ ...o, env })) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-runside-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const r = path.join(d, 'repo');
  fs.mkdirSync(path.join(r, 'src'), { recursive: true });
  fs.mkdirSync(path.join(r, 'test'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: r, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }));
  fs.writeFileSync(path.join(r, 'src/add.mjs'), 'export const add = (a, b) => a - b;\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feature');
  fs.writeFileSync(path.join(r, 'src/add.mjs'), 'export const add = (a, b) => a + b;\n');
  fs.writeFileSync(path.join(r, 'test/add.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\n"
    + `import { add } from '../src/add.mjs';\ntest('add sums', () => { assert.equal(add(2, 3), ${expected}); });\n`);
  const seen = [];
  const deps = { analyse, classify, detect, localInput, dataDir: path.join(d, 'data'), runSide: async (o) => { const got = await side(o); seen.push(got); return got; } };
  const input = JSON.stringify({ session_id: 's', transcript_path: path.join(d, 'none.jsonl'), cwd: r, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Fixed add.' });
  return { stop: () => hook(input, deps), seen };
}

test('with core/run\'s runSide, a changed test that passes on head does not block', async (t) => {
  const s = setup(t, 5);
  const out = await s.stop();
  assert.equal(s.seen.length, 1);
  assert.equal(s.seen[0].tests.length, 1);
  assert.deepEqual(s.seen[0].tests[0].runs.map((u) => u.status), ['pass']);
  assert.notEqual(out?.decision, 'block');
  assert.doesNotMatch(out?.systemMessage ?? '', /could not check/);
});

test('with core/run\'s runSide, a changed test that fails on head blocks', async (t) => {
  const s = setup(t, 6);
  const out = await s.stop();
  assert.equal(s.seen[0].tests.length, 1);
  assert.notEqual(s.seen[0].tests[0].runs[0].status, 'pass');
  assert.equal(out?.decision, 'block');
  assert.match(out.reason, /1 changed test fails on a fresh run/);
});

test('a problem core/run reports for the run is shown to the user once and does not block', async (t) => {
  const s = setup(t, 5, async () => ({ tests: [], problem: { reason: 'runner', detail: 'node-test report had no tests' }, runner: 'node-test' }));
  const first = await s.stop();
  assert.notEqual(first?.decision, 'block');
  assert.match(first?.systemMessage ?? '', /The changed tests could not run \(runner\): node-test report had no tests/);
  const second = await s.stop();
  assert.doesNotMatch(second?.systemMessage ?? '', /could not run/);
});
