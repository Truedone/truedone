// PLG-01: what the hook reads. The claim comes from the last message; the tool-call order from the transcript, which
// counts only when it already holds that message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimsTestsPass, toolCalls, ranTestsAfterLastEdit, holdsFinalMessage } from '../src/plugin/transcript.mjs';

const a = (content) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content } });
const use = (name, input) => a([{ type: 'tool_use', id: 'x', name, input }]);

test('a claim that the tests pass, in its usual forms', () => {
  for (const m of ['All tests pass.', 'The tests now pass', '42 tests passed.', 'Tests are green.', 'The test suite passes.', 'Done: all the tests are passing.']) assert.equal(claimsTestsPass(m), true, m);
});

test('a sentence saying the tests fail, or were not run, is not a claim', () => {
  for (const m of ['The tests do not pass yet.', "Tests don't pass on Windows.", 'I have not run the tests.', 'Two tests fail.', '', null]) assert.equal(claimsTestsPass(m), false, String(m));
});

test('edits and test commands are read in transcript order', () => {
  const t = [use('Edit', { file_path: '/r/a.js' }), use('Bash', { command: 'npm test' }), use('Write', { file_path: '/r/b.js' }), use('Bash', { command: 'git status' })].join('\n');
  assert.deepEqual(toolCalls(t).map((c) => c.kind), ['edit', 'test', 'edit', 'other']);
  assert.equal(ranTestsAfterLastEdit(toolCalls(t)), false);
  assert.equal(ranTestsAfterLastEdit(toolCalls(t + '\n' + use('Bash', { command: 'cd pkg && npx vitest run' }))), true);
  assert.equal(ranTestsAfterLastEdit(toolCalls(use('Bash', { command: 'npm test' }))), null, 'no edit at all');
});

test('each runner and package-manager test command counts as a test run; truedone counts only with --run', () => {
  for (const c of ['pytest -q', 'python -m pytest tests', 'node --test test/', 'pnpm test', 'yarn run test', 'npx jest a.test.js', 'npx truedone --run']) assert.equal(toolCalls(use('Bash', { command: c }))[0].kind, 'test', c);
  for (const c of ['npx truedone', 'cat test/a.test.js', 'grep -r jest docs']) assert.notEqual(toolCalls(use('Bash', { command: c }))[0].kind, 'test', c);
});

test('the transcript counts only when its last assistant text is the Stop input message', () => {
  const t = [use('Bash', { command: 'npm test' }), a([{ type: 'text', text: 'All tests pass.' }])].join('\n');
  assert.equal(holdsFinalMessage(t, 'All tests pass.'), true);
  assert.equal(holdsFinalMessage(t, 'Something newer.'), false);
  assert.equal(holdsFinalMessage(use('Bash', { command: 'npm test' }), 'All tests pass.'), false);
});
