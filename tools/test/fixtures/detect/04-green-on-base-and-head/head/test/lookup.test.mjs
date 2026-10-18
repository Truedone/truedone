import test from 'node:test';
import assert from 'node:assert/strict';
import { lookup } from '../src/lookup.mjs';

test('a known name', () => {
  assert.equal(lookup({ a: 1 }, 'a'), 1);
});

test('an unknown name is null', () => {
  assert.equal(lookup({ a: 1 }, 'b'), null);
});
