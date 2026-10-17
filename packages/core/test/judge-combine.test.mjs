import assert from 'node:assert/strict';
import test from 'node:test';
import { judge } from '../src/judge.mjs';

function report(tests, attempt) {
  return {
    schema: 'truedone.report/1',
    attempt,
    tests,
  };
}

const proven = {
  file: 'a.test.js',
  name: 'adds',
  base: ['fail:assertion', 'fail:assertion'],
  head: ['pass', 'pass', 'pass'],
  condition: 'lines',
  asserts_new_symbol: false,
};

const flaky = {
  file: 'b.test.js',
  name: 'other',
  base: ['fail:assertion', 'pass'],
  head: ['pass', 'pass', 'pass'],
  condition: 'lines',
  asserts_new_symbol: false,
};

test('a report cannot override tampered or review', () => {
  const reports = [report([proven])];
  assert.equal(judge({ verdict: 'tampered' }, reports).verdict, 'tampered');
  assert.equal(judge({ verdict: 'review' }, reports).verdict, 'review');
});

test('mixed tests follow the best result, and could not run only when nothing reached one', () => {
  assert.equal(judge({ verdict: 'unrun' }, [report([flaky, proven])]).verdict, 'proven');
  assert.equal(judge({ verdict: 'unrun' }, [report([flaky])]).verdict, 'could_not_run');
  const weak = { ...proven, condition: 'none' };
  const none = {
    ...proven,
    base: ['pass', 'pass'],
    condition: 'none',
  };
  assert.equal(judge({ verdict: 'unrun' }, [report([none, weak])]).verdict, 'proven_weak');
});

test('the first report of the latest attempt that reached a result counts', () => {
  const missed = report([flaky], 2);
  const hit = report([proven], 2);
  const older = report([proven], 1);
  assert.equal(judge({ verdict: 'unrun' }, [missed, hit, older]).verdict, 'proven');
});
