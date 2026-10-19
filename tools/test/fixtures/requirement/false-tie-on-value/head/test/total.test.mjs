import test from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/total.mjs';

test('rounds the total to whole units', () => {
  assert.equal(total([40.4, 60]), 101);
});
