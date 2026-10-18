// WEB-08-AC02 (#75, #77): GitHub answers a visitor who cancels on its authorization page with error=access_denied, the
// right state and no code. After the state check that gets its own line; a wrong state keeps the mismatch line. GitHub's
// other error values are named only from a fixed list, so nothing else from the URL reaches the page. Every line a
// failed callback shows carries, in the same paragraph, the link to start the sign-in again with the kept page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finish } from '../lib/signin.mjs';
import { page } from '../lib/page.mjs';
import { fakeDoc, find, classify, verdict } from './lib/fakes.mjs';

const session = (items = {}) => { const m = new Map(Object.entries(items)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const loc = (pathname, search = '') => { const l = { pathname, search, went: [] }; l.assign = (u) => l.went.push(['assign', u]); l.replace = (u) => l.went.push(['replace', u]); return l; };
const STATE = 'st-0123456789abcdef';
const KEPT = '/octo/demo/pull/7';
const MISMATCH = 'The sign-in did not match this tab.';
const CANCELLED = 'The sign-in was cancelled on GitHub.';
// GitHub's redirect after a cancel on its authorization page
const CANCEL = `?error=access_denied&error_description=The+user+has+denied+your+application+access.&error_uri=https%3A%2F%2Fdocs.github.com%2Fapps&state=${STATE}`;
const noExchange = () => { const f = async () => { f.called = true; return new Response('{"token":"ghu_x"}', { status: 200 }); }; return f; };

test('a cancel on GitHub with the right state reads as cancelled, and exchanges nothing', async () => {
  const s = session({ 'truedone.state': STATE, 'truedone.return': KEPT });
  const fetch = noExchange();
  const r = await finish(loc('/signin/callback', CANCEL), s, fetch);
  assert.equal(r.ok, false);
  assert.equal(r.why, CANCELLED);
  assert.equal(fetch.called, undefined);
  assert.equal(s.getItem('truedone.token'), null);
});

test('the state is checked first: a cancel with a wrong state, or none kept, is still a mismatch', async () => {
  const wrong = CANCEL.replace(`state=${STATE}`, 'state=st-other-0000000000');
  assert.equal((await finish(loc('/signin/callback', wrong), session({ 'truedone.state': STATE }), noExchange())).why, MISMATCH);
  assert.equal((await finish(loc('/signin/callback', CANCEL), session(), noExchange())).why, MISMATCH);
});

test('the right state with no code and no error is a mismatch', async () => {
  assert.equal((await finish(loc('/signin/callback', `?state=${STATE}`), session({ 'truedone.state': STATE }), noExchange())).why, MISMATCH);
});

test('GitHub\'s other error values are named from a fixed list; a value off the list is not shown', async () => {
  const why = async (error) => (await finish(loc('/signin/callback', `?error=${encodeURIComponent(error)}&state=${STATE}`), session({ 'truedone.state': STATE }), noExchange())).why;
  assert.equal(await why('redirect_uri_mismatch'), 'GitHub stopped the sign-in (redirect_uri_mismatch).');
  assert.equal(await why('application_suspended'), 'GitHub stopped the sign-in (application_suspended).');
  assert.equal(await why('Your account is locked, call 555-0100'), 'GitHub stopped the sign-in.');
});

// each failure, the line it shows
const LINES = [
  ['a wrong state', { 'truedone.state': STATE }, '?state=st-other-0000000000&code=abc', null, MISMATCH],
  ['a cancel on GitHub', { 'truedone.state': STATE }, CANCEL, null, CANCELLED],
  ['an error off the list', { 'truedone.state': STATE }, `?error=temporarily_unavailable&state=${STATE}`, null, 'GitHub stopped the sign-in.'],
  ['no code', { 'truedone.state': STATE }, `?state=${STATE}`, null, MISMATCH],
  ['GitHub refusing the code', { 'truedone.state': STATE }, `?state=${STATE}&code=abc`, async () => new Response('{"error":"bad_verification_code"}', { status: 502 }), 'GitHub did not complete the sign-in.'],
  ['the Worker not answering', { 'truedone.state': STATE }, `?state=${STATE}&code=abc`, async () => { throw new TypeError('Failed to fetch'); }, 'The sign-in service did not answer.'],
];
for (const [name, items, search, fetch, line] of LINES) {
  test(`on ${name}, the page shows its line with the start-again link to the kept page in the same paragraph`, async () => {
    const { doc, root } = fakeDoc();
    await page(loc('/signin/callback', search), { fetch: fetch ?? noExchange(), doc, root, analyse: () => verdict(), classify, storage: session({ ...items, 'truedone.return': KEPT }) });
    const para = find(root, (e) => e.tag === 'p' && e.children.some((c) => c.tag === 'span' && c.textContent === `${line} `));
    assert.equal(para.length, 1, `one paragraph with "${line}"`);
    const [a] = find(para[0], (e) => e.tag === 'a');
    assert.equal(a?.textContent, 'Start it again');
    assert.equal(a?.attrs.href, `/signin?return=${encodeURIComponent(KEPT)}`);
  });
}
