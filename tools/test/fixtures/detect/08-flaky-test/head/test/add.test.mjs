import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { add } from '../src/add.mjs';

// a counter in the working directory: the test fails on every even-numbered run, so it is flaky by its turn, not by chance
const file = '.run-count';
const n = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 0;
fs.writeFileSync(file, String(n + 1));

test('adds two numbers', () => {
  assert.equal(n % 2, 1);
  assert.equal(add(2, 2), 4);
});
