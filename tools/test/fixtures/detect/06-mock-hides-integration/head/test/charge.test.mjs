import test from 'node:test';
import assert from 'node:assert/strict';
import { charge } from '../src/charge.mjs';

test('the charge reaches the provider', async () => {
  const calls = [];
  const provider = { post: async (path, body) => { calls.push({ path, body }); return { ok: true }; } };
  const result = await charge(provider, 12);
  assert.equal(result.ok, true);
  assert.equal(calls[0].path, '/charges');
});
