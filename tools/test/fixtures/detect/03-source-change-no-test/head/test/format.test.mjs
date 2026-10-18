import test from 'node:test';
import assert from 'node:assert/strict';
import { format } from '../src/format.mjs';

test('two decimals', () => {
  assert.equal(format(3), '3.00');
});
