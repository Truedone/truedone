import test from 'node:test';
import assert from 'node:assert/strict';
import { mul } from '../src/math.mjs';

test('multiplies two numbers', () => {
  assert.equal(mul(2, 3), 6);
});
