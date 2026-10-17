import assert from 'node:assert/strict';
import test from 'node:test';
import { judge } from '../src/judge.mjs';

test('reports of another shape are refused', () => {
  assert.throws(() => judge({ verdict: 'unrun' }, [{ schema: 'other', tests: [] }]), /another shape/);
  assert.throws(() => judge({ verdict: 'unrun' }, [{ schema: 'truedone.report/1' }]), /another shape/);
  assert.throws(() => judge({ verdict: 'unrun' }, { schema: 'truedone.report/1', tests: [] }), /another shape/);
});
