// WEB-07-AC01 (issue #58): a repository with no precomputed list. The site serves its single page for a missing file,
// as 200 text/html, so /p/<owner>/<repo> must say the repository has no list yet, not that reading a pull request
// failed. A real JSON list still renders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from '../lib/page.mjs';
import { fakeFetch, fakeDoc, textOf, classify, verdict } from './lib/fakes.mjs';

const load = async (answer) => {
  const { doc, root } = fakeDoc();
  const f = fakeFetch({ '/precomputed/octo--demo.json': answer });
  await page({ pathname: '/p/octo/demo' }, { fetch: f.fetch, doc, root, analyse: () => verdict(), classify });
  return textOf(root);
};

test('a text/html answer, the single-page fallback, says the repository has no list yet', async () => {
  const text = await load({ status: 200, body: '<!doctype html><html><head></head><body></body></html>', headers: { 'content-type': 'text/html; charset=utf-8' } });
  assert.match(text, /octo\/demo has no list yet/);
  assert.doesNotMatch(text, /could not be shown|Something failed|pull request\./);
});

test('a 404 for the list says the same', async () => {
  assert.match(await load({ status: 404, body: 'Not Found', headers: { 'content-type': 'text/plain' } }), /octo\/demo has no list yet/);
});

test('a JSON list still renders its rows', async () => {
  const body = JSON.stringify({ prs: [{ number: 3, title: 'Fix rounding', result: { verdict: 'unrun' } }], computed_at: '2026-10-18T00:00:00Z' });
  const text = await load({ status: 200, body, headers: { 'content-type': 'application/json' } });
  assert.match(text, /#3 Fix rounding/);
  assert.doesNotMatch(text, /has no list yet/);
});
