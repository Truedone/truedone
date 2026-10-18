// WEB-08-AC03 (#76): a token GitHub no longer accepts, such as an expired sign-in, made every PR page in the tab read
// "GitHub answered 401", with no sign-out. With a token kept, GitHub's recorded 401 (fixtures/api/bad-credentials.json,
// its answer to a rejected token on 2026-10-18) drops the token; the PR is read again with no authorization, and the
// page says the sign-in expired, with a sign-in link back to the PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page } from '../lib/page.mjs';
import { fakeFetch, fakeDoc, textOf, find, classify, verdict, recorded } from './lib/fakes.mjs';

const BAD = fs.readFileSync(new URL('./fixtures/api/bad-credentials.json', import.meta.url), 'utf8');
const PR = 'https://api.github.com/repos/octo/demo/pulls/7';
const session = (items = {}) => { const m = new Map(Object.entries(items)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const signIn = (root) => find(root, (e) => e.tag === 'a' && e.attrs.class === 'signin');
// GitHub refuses every request that carries the token; without it, the recorded PR (or `anonymous`, a fakeFetch override)
function rejecting(anonymous = {}) {
  const f = fakeFetch(anonymous);
  const log = [];
  const fetch = async (url, init = {}) => {
    const auth = init.headers?.authorization ?? null;
    log.push({ url, auth });
    if (auth) return new Response(BAD, { status: 401, headers: { 'content-type': 'application/json; charset=utf-8' } });
    return f.fetch(url, init);
  };
  return { fetch, log };
}
async function load(fetch, storage) {
  const { doc, root } = fakeDoc();
  let ran = false;
  await page({ pathname: recorded.pr }, { fetch, doc, root, analyse: () => { ran = true; return verdict(); }, classify, storage });
  return { root, ran: () => ran };
}

test('a 401 with a kept token: the token is dropped, the PR is read again anonymously, and the page says the sign-in expired', async () => {
  const storage = session({ 'truedone.token': 'ghu_expired' });
  const g = rejecting();
  const { root, ran } = await load(g.fetch, storage);
  assert.equal(storage.getItem('truedone.token'), null, 'the token is gone from the tab');
  assert.equal(g.log[0].auth, 'Bearer ghu_expired');
  assert.ok(g.log.length > 1 && g.log.slice(1).every((r) => r.auth === null), 'every later request goes with no authorization');
  assert.ok(ran(), 'the PR was analysed');
  const text = textOf(root);
  assert.match(text, /octo\/demo#7/);
  assert.match(text, /Your GitHub sign-in has expired, so this page was read without it\./);
  assert.doesNotMatch(text, /could not be shown|answered 401/);
  assert.deepEqual(signIn(root).map((a) => a.attrs.href), [`/signin?return=${encodeURIComponent(recorded.pr)}`]);
});

test('a 401 with no token is still the error it is, and the PR is not read twice', async () => {
  const f = fakeFetch({ [PR]: { status: 401, body: BAD } });
  const { root, ran } = await load(f.fetch, session());
  assert.match(textOf(root), /GitHub answered 401/);
  assert.equal(f.log.filter((r) => r.url === PR).length, 1);
  assert.equal(ran(), false);
});

test('if the anonymous read meets the rate limit, the page offers sign-in, and the token stays dropped', async () => {
  const storage = session({ 'truedone.token': 'ghu_expired' });
  const g = rejecting({ [PR]: { status: 403, body: '{"message":"API rate limit exceeded"}', headers: { 'x-ratelimit-remaining': '0' } } });
  const { root } = await load(g.fetch, storage);
  assert.equal(storage.getItem('truedone.token'), null);
  assert.match(textOf(root), /hourly limit for anonymous reads is used up/);
  assert.doesNotMatch(textOf(root), /sign-in has expired/);
});

test('a token GitHub accepts is kept and used, with no notice', async () => {
  const storage = session({ 'truedone.token': 'ghu_good' });
  const f = fakeFetch();
  const { root } = await load(f.fetch, storage);
  assert.equal(storage.getItem('truedone.token'), 'ghu_good');
  assert.ok(f.log.filter((r) => r.url.startsWith('https://api.github.com/')).every((r) => r.headers.authorization === 'Bearer ghu_good'));
  assert.doesNotMatch(textOf(root), /sign-in has expired/);
});
