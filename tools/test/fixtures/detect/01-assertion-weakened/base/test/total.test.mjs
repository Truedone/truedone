import test from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/total.mjs';

test('the total of the items', () => {
  assert.equal(total([40, 60]), 100);
});
