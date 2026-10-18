import assert from 'node:assert/strict';
import test from 'node:test';
import { outcome } from '../src/outcome.mjs';
import { judge } from '../src/judge.mjs';

const pr = { title: '', body: '', author: { login: 'a', type: 'User' } };

test('two base assertion failures and three head passes are Proven when coverage holds', () => {
  const row = outcome({
    base: ['fail:assertion', 'fail:assertion'],
    head: ['pass', 'pass', 'pass'],
    condition: 'lines',
  });
  assert.equal(row.result, 'Proven');
});

test('the same passes without coverage are Proven (weak)', () => {
  const row = outcome({
    base: ['fail:assertion', 'fail:assertion'],
    head: ['pass', 'pass', 'pass'],
    condition: 'none',
  });
  assert.equal(row.result, 'Proven (weak)');
});

test('two base passes and three head passes are No red-green evidence', () => {
  const row = outcome({
    base: ['pass', 'pass'],
    head: ['pass', 'pass', 'pass'],
  });
  assert.equal(row.result, 'No red-green evidence');
});

test('judge uses that table for a covered change', () => {
  const report = {
    schema: 'truedone.report/1',
    attempt: 1,
    job: 'unit',
    tests: [{
      file: 'a.test.js',
      name: 'adds',
      base: ['fail:assertion', 'fail:assertion'],
      head: ['pass', 'pass', 'pass'],
      condition: 'lines',
      asserts_new_symbol: false,
    }],
  };
  const got = judge({ verdict: 'no_evidence', reasons: [], partial: false }, [report]);
  assert.equal(got.verdict, 'proven');
  assert.equal(got.schema, 'truedone.verdict/1');
  assert.equal(got.reasons[0].check, 'red_green');
  assert.equal(pr.author.login, 'a');
});
