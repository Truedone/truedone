import test from 'node:test';
import assert from 'node:assert/strict';
import { lookup } from '../src/lookup.mjs';

test('refuses a blank name', () => {
  assert.throws(() => lookup({ a: 1 }, '  '));
});

test('finds a known name with spaces around it', () => {
  assert.equal(lookup({ a: 1 }, ' a '), 1);
});
