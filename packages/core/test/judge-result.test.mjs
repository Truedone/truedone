import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { analyse } from '../src/analyse.mjs';
import { judge } from '../src/judge.mjs';

const pr = { title: '', body: '', author: { login: 'a', type: 'User' } };

test('a report that ran no test is Could not run and names the reason', () => {
  const st = analyse({ files: [{ path: 'a.test.js', status: 'modified', base: 'x\n', head: 'y\n' }], pr, releases: [] });
  const o = judge(st, [{
    schema: 'truedone.report/1',
    tests: [],
    could_not_run: { reason: 'runner', detail: 'no runner found' },
    truncated: false,
  }]);
  assert.equal(o.verdict, 'could_not_run');
  assert.equal(o.label, 'truedone:could-not-run');
  assert.equal(o.next, 'Fix the named reason and run again.');
  assert.ok(o.reasons.some((r) => r.check === 'could_not_run' && /runner/.test(r.message)));
});

test('a standing Tampered keeps its lines', () => {
  const f = JSON.parse(fs.readFileSync('packages/core/test/fixtures/checks/skip_added/js.json', 'utf8'));
  const st = analyse({ files: f.files, pr, releases: [] });
  const report = {
    schema: 'truedone.report/1',
    tests: [{ file: 'a.test.js', name: 't', base: ['fail:assertion', 'fail:assertion'], head: ['pass', 'pass', 'pass'], condition: 'lines', asserts_new_symbol: false }],
    could_not_run: null,
    truncated: false,
  };
  const o = judge(st, [report]);
  assert.equal(o.verdict, 'tampered');
  assert.equal(o.label, 'truedone:tampered');
  assert.deepEqual(o.reasons, st.reasons);
});

test('a red-green result carries partial, label, next and a red_green line', () => {
  const o = judge({ verdict: 'unrun', partial: true, reasons: [] }, [{
    schema: 'truedone.report/1',
    tests: [{ file: 'a.test.js', name: 'adds', base: ['fail:assertion', 'fail:assertion'], head: ['pass', 'pass', 'pass'], condition: 'lines', asserts_new_symbol: false }],
  }]);
  assert.equal(o.schema, 'truedone.verdict/1');
  assert.equal(o.verdict, 'proven');
  assert.equal(o.label, 'truedone:yes');
  assert.equal(o.partial, true);
  assert.equal(o.next, 'Review the rest of the change as usual.');
  assert.ok(o.reasons.some((r) => r.check === 'red_green' && r.file === 'a.test.js'));
});
