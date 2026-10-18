import test from 'node:test';
import assert from 'node:assert/strict';
import { isValid } from '../src/token.mjs';

test('an expired token is rejected', () => {
  assert.equal(isValid({ expires: 10 }, 20), false);
});

test('a live token is accepted', () => {
  assert.equal(isValid({ expires: 30 }, 20), true);
});
