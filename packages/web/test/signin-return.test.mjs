// WEB-08-AC01 (#74): no sign-in link returns to /signin or /signin/callback, and a failed callback's page offers sign-in
// back to the page the visitor came from, the value start() kept. The walk's case: a visitor who signed in from the
// callback's error page landed on that page again, with the state used, and read that the sign-in did not match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from '../lib/page.mjs';
import { signinHref } from '../lib/view.mjs';
import { start, finish } from '../lib/signin.mjs';
import { fakeDoc, find, classify, verdict } from './lib/fakes.mjs';

const session = (items = {}) => { const m = new Map(Object.entries(items)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const loc = (pathname, search = '') => { const l = { pathname, search, went: [] }; l.assign = (u) => l.went.push(['assign', u]); l.replace = (u) => l.went.push(['replace', u]); return l; };
const STATE = 'st-0123456789abcdef';
const KEPT = '/octo/demo/pull/7';
const returns = (root) => find(root, (e) => e.tag === 'a' && /^\/signin\?/.test(e.attrs.href ?? '')).map((e) => new URLSearchParams(e.attrs.href.split('?')[1]).get('return'));
// every way the callback fails: what start() kept, the callback's query, the exchange's answer
const FAILS = {
  'no state kept': [{}, `?state=${STATE}&code=abc`, null],
  'a wrong state': [{ 'truedone.state': STATE }, '?state=st-other-0000000000&code=abc', null],
  'a cancel on GitHub': [{ 'truedone.state': STATE }, `?error=access_denied&state=${STATE}`, null],
  'no code': [{ 'truedone.state': STATE }, `?state=${STATE}`, null],
  'GitHub refusing the code': [{ 'truedone.state': STATE }, `?state=${STATE}&code=abc`, async () => new Response('{"error":"bad_verification_code"}', { status: 502 })],
  'the Worker not answering': [{ 'truedone.state': STATE }, `?state=${STATE}&code=abc`, async () => { throw new TypeError('Failed to fetch'); }],
};
async function callback(items, search, fetch) {
  const { doc, root } = fakeDoc();
  await page(loc('/signin/callback', search), { fetch: fetch ?? (async () => { throw new Error('no exchange expected'); }), doc, root, analyse: () => verdict(), classify, storage: session(items) });
  return root;
}

test('signinHref sends the sign-in pages back to /, and every other path to itself', () => {
  for (const p of ['/signin', '/signin/callback', '/signin/anything']) assert.equal(signinHref(p), '/signin?return=%2F', p);
  for (const p of ['/octo/demo/pull/7', '/why', '/signins', '/']) assert.equal(signinHref(p), `/signin?return=${encodeURIComponent(p)}`, p);
});

for (const [name, [items, search, fetch]] of Object.entries(FAILS)) {
  test(`a callback that fails on ${name}: every sign-in link on its page goes back to the kept page`, async () => {
    const r = returns(await callback({ ...items, 'truedone.return': KEPT }, search, fetch));
    assert.ok(r.length >= 2, `the start-again link and the footer's, got ${JSON.stringify(r)}`);
    assert.deepEqual([...new Set(r)], [KEPT]);
  });
}

test('with nothing kept, a failed callback\'s sign-in links go to /, never to the callback', async () => {
  const r = returns(await callback({}, '?state=x&code=abc'));
  assert.ok(r.length >= 2, JSON.stringify(r));
  assert.deepEqual([...new Set(r)], ['/']);
});

test('the walk\'s case: signing in from the callback\'s error page brings the visitor back to the page they came from', async () => {
  // a sign-in started on the PR page fails, and the callback shows its error page
  const root = await callback({ 'truedone.state': STATE, 'truedone.return': KEPT }, '?state=st-other-0000000000&code=abc');
  const [footer] = find(root, (e) => e.tag === 'footer');
  const [link] = find(footer, (e) => e.tag === 'a' && /^\/signin\?/.test(e.attrs.href ?? ''));
  // the visitor follows the footer's link; start() keeps its return value, and GitHub sends them back with a code
  const s = session();
  start(loc('/signin', `?${link.attrs.href.split('?')[1]}`), s, () => STATE);
  const back = loc('/signin/callback', `?code=abc123&state=${STATE}`);
  assert.deepEqual(await finish(back, s, async () => new Response('{"token":"ghu_new"}', { status: 200 })), { ok: true });
  assert.deepEqual(back.went, [['replace', KEPT]]);
});
