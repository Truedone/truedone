import test from 'node:test';
import assert from 'node:assert/strict';
import { discount } from '../src/discount.mjs';

test('no items, no discount', () => {
  assert.equal(discount(0), 0);
});

test('a large order', () => {
  assert.equal(discount(20), 0.1);
});

test('a single item', () => {
  assert.equal(discount(1), 0);
});
