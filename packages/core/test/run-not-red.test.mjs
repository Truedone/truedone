import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { baseToken, headToken, outcome } from '../run/outcome.mjs';
import { parseReport } from '../run/parse.mjs';

const index = JSON.parse(readFileSync(new URL('./fixtures/reports/index.json', import.meta.url), 'utf8'));

function token(runner, kind, side) {
  const parsed = parseReport(readFileSync(new URL(`./fixtures/reports/${runner[kind]}`, import.meta.url), 'utf8'), runner.reporter, []);
  return side === 'head' ? headToken(parsed[0]) : baseToken(parsed[0]);
}

for (const runner of index.runners) {
  test(`${runner.runner} an import or collection error on base is not red`, () => {
    const got = outcome({
      base: [token(runner, 'error', 'base'), token(runner, 'error', 'base')],
      head: [token(runner, 'pass', 'head'), token(runner, 'pass', 'head'), token(runner, 'pass', 'head')],
      condition: 'lines',
      asserts_new_symbol: true,
      errorType: 'SyntaxError',
    });
    assert.equal(got.reason, 'error');
    assert.equal(got.result.startsWith('Proven'), false);
  });
}
