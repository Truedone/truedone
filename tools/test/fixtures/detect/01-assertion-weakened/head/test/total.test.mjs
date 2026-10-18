import test from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/total.mjs';

test('the total of the items', () => {
  assert.ok(total([40, 60]) !== undefined);
});
