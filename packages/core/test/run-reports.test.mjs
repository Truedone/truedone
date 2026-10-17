import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { baseToken, headToken, outcome } from '../run/outcome.mjs';
import { parseReport } from '../run/parse.mjs';

const index = JSON.parse(readFileSync(new URL('./fixtures/reports/index.json', import.meta.url), 'utf8'));

function read(name) {
  return readFileSync(new URL(`./fixtures/reports/${name}`, import.meta.url), 'utf8');
}

function token(runner, kind, side) {
  const symbols = kind === 'missing' ? [index.symbol] : [];
  const parsed = parseReport(read(runner[kind]), runner.reporter, symbols);
  assert.equal(parsed.length, 1);
  return side === 'head' ? headToken(parsed[0]) : baseToken(parsed[0]);
}

for (const runner of index.runners) {
  for (const kind of ['assertion', 'missing', 'pass', 'error']) {
    test(`${runner.runner} recorded ${kind} parses`, () => {
      const symbols = kind === 'missing' ? [index.symbol] : [];
      const parsed = parseReport(read(runner[kind]), runner.reporter, symbols);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].name, 'adds');
      if (kind === 'pass') {
        assert.equal(parsed[0].status, 'pass');
        assert.equal(parsed[0].failure, null);
      } else {
        assert.equal(parsed[0].status, 'fail');
        assert.equal(parsed[0].failure, kind);
      }
    });
  }

  test(`${runner.runner} missing shape without an added symbol stays an error`, () => {
    const parsed = parseReport(read(runner.missing), runner.reporter, []);
    assert.equal(parsed[0].failure, 'error');
  });

  for (const row of index.rows) {
    test(`${runner.runner} ${row.name}`, () => {
      const got = outcome({
        base: row.base.map((kind) => token(runner, kind, 'base')),
        head: row.head.map((kind) => token(runner, kind, 'head')),
        condition: row.condition,
        asserts_new_symbol: row.named,
        errorType: 'SyntaxError',
      });
      assert.equal(got.result, row.result);
      if (row.reason) assert.equal(got.reason, row.reason);
    });
  }

  test(`${runner.runner} a run past the limit is timed out`, () => {
    const got = outcome({
      base: ['timeout', 'pass'],
      head: ['pass', 'pass', 'pass'],
      condition: 'none',
      asserts_new_symbol: false,
    });
    assert.equal(got.result, 'Could not run: timed out');
    assert.equal(got.reason, 'timeout');
  });
}
