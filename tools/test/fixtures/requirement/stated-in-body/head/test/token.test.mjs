import test from 'node:test';
import assert from 'node:assert/strict';
import { isValid, stamp } from '../src/token.mjs';

test('rejects an expired token', () => {
  assert.equal(isValid({ expires: 10 }, 20), false);
});

test('the log line carries the date', () => {
  assert.equal(stamp(0), '1970-01-01');
});
