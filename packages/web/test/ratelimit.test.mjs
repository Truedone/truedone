// WEB-01-AC02 (PV-W03): on GitHub's rate-limit answer (403 with no requests remaining, or 429) the PR page offers
// sign-in, with a link back to the same PR, instead of an error. Any other 403 is still an error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from '../lib/page.mjs';
import { fakeFetch, fakeDoc, textOf, find, classify, verdict, recorded } from './lib/fakes.mjs';

const PR = 'https://api.github.com/repos/octo/demo/pulls/7';
const loc = { pathname: recorded.pr };
const signIn = (root) => find(root, (e) => e.tag === 'a' && e.attrs.class === 'signin');

for (const [name, answer] of [
  ['a 403 with x-ratelimit-remaining 0', { status: 403, body: '{"message":"API rate limit exceeded"}', headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1760716800' } }],
  ['a 429', { status: 429, body: '{"message":"secondary rate limit"}', headers: { 'retry-after': '60' } }],
]) {
  test(`${name} offers sign-in that returns to the PR, and shows no error`, async () => {
    const f = fakeFetch({ [PR]: answer });
    const { doc, root } = fakeDoc();
    let ran = false;
    await page(loc, { fetch: f.fetch, doc, root, analyse: () => { ran = true; return verdict(); }, classify });
    const links = signIn(root);
    assert.equal(links.length, 1);
    assert.equal(links[0].attrs.href, `/signin?return=${encodeURIComponent(recorded.pr)}`);
    assert.doesNotMatch(textOf(root), /could not be shown|failed/i);
    assert.equal(ran, false, 'nothing was analysed');
  });
}

test('a rate limit on a file page, after the PR read, also offers sign-in', async () => {
  const f = fakeFetch({ [`${PR}/files?per_page=100&page=2`]: { status: 403, body: '{}', headers: { 'x-ratelimit-remaining': '0' } } });
  const { doc, root } = fakeDoc();
  await page(loc, { fetch: f.fetch, doc, root, analyse: () => verdict(), classify });
  assert.equal(signIn(root).length, 1);
});

test('a 403 that is not a rate limit is an error, with no sign-in offer', async () => {
  const f = fakeFetch({ [PR]: { status: 403, body: '{"message":"Resource not accessible"}', headers: { 'x-ratelimit-remaining': '41' } } });
  const { doc, root } = fakeDoc();
  await page(loc, { fetch: f.fetch, doc, root, analyse: () => verdict(), classify });
  assert.equal(signIn(root).length, 0);
  assert.match(textOf(root), /could not be shown/);
});
