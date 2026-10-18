// WEB-08-AC04 (#78): the rate-limit page says when GitHub's limit resets, from x-ratelimit-reset, in the visitor's local
// time; with no such header, or one that is not a number, it names no time. The time zone is set here, so the clock is
// known: the reset is 08:30 UTC on 2026-10-18, which is 04:30 in New York.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from '../lib/page.mjs';
import { rateLimitView } from '../lib/view.mjs';
import { build } from '../lib/dom.mjs';
import { fakeFetch, fakeDoc, textOf, classify, verdict, recorded } from './lib/fakes.mjs';

process.env.TZ = 'UTC';
const PR = 'https://api.github.com/repos/octo/demo/pulls/7';
const RESET = Date.UTC(2026, 9, 18, 8, 30) / 1000;
async function limited(headers) {
  const { doc, root } = fakeDoc();
  await page({ pathname: recorded.pr }, { fetch: fakeFetch({ [PR]: { status: 403, body: '{"message":"API rate limit exceeded"}', headers } }).fetch, doc, root, analyse: () => verdict(), classify });
  return textOf(root);
}

test('a rate limit with x-ratelimit-reset says when the limit resets', async () => {
  const text = await limited({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(RESET) });
  assert.match(text, /hourly limit for anonymous reads is used up/);
  assert.match(text, /The limit resets at 0?8[:.]30( ?[AaPp]\.?[Mm]\.?)?, your local time\./);
});

test('the time is the visitor\'s local time', (t) => {
  t.after(() => { process.env.TZ = 'UTC'; });
  process.env.TZ = 'America/New_York';
  const { doc } = fakeDoc();
  assert.match(textOf(build(rateLimitView(recorded.pr, RESET), doc)), /The limit resets at 0?4[:.]30/);
});

test('a 429 with no x-ratelimit-reset names no time', async () => {
  const { doc, root } = fakeDoc();
  await page({ pathname: recorded.pr }, { fetch: fakeFetch({ [PR]: { status: 429, body: '{}', headers: { 'retry-after': '60' } } }).fetch, doc, root, analyse: () => verdict(), classify });
  assert.match(textOf(root), /hourly limit for anonymous reads is used up/);
  assert.doesNotMatch(textOf(root), /resets at/);
});

test('a reset that is not a number names no time', async () => {
  assert.doesNotMatch(await limited({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'soon' }), /resets at/);
  const { doc } = fakeDoc();
  assert.doesNotMatch(textOf(build(rateLimitView(recorded.pr, null), doc)), /resets at/);
});
