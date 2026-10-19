// WEB-02-AC05 (S8): with a token in sessionStorage, the recorded requests carry it to api.github.com only, never to
// raw.githubusercontent.com or any other host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from '../lib/page.mjs';
import { fakeFetch, fakeDoc, classify, verdict, recorded } from './lib/fakes.mjs';

const session = (items) => { const m = new Map(Object.entries(items)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('every api.github.com request carries the session token, and no other request does', async () => {
  const f = fakeFetch();
  const { doc, root } = fakeDoc();
  await page({ pathname: recorded.pr }, { fetch: f.fetch, doc, root, analyse: () => verdict(), classify, storage: session({ 'truedone.token': 'ghu_session' }) });
  const api = f.log.filter((r) => new URL(r.url).host === 'api.github.com');
  const other = f.log.filter((r) => new URL(r.url).host !== 'api.github.com');
  assert.equal(api.length, 5);
  assert.ok(other.length > 0, 'contents were read from raw');
  for (const r of api) assert.equal(r.headers.authorization, 'Bearer ghu_session', r.url);
  for (const r of other) assert.equal(r.headers.authorization, undefined, r.url);
  assert.ok(f.log.every((r) => !JSON.stringify(r).includes('ghu_session') || new URL(r.url).host === 'api.github.com'), 'the token appears in no other request, URL included');
});

test('with no token in the session, no request carries one', async () => {
  const f = fakeFetch();
  const { doc, root } = fakeDoc();
  await page({ pathname: recorded.pr }, { fetch: f.fetch, doc, root, analyse: () => verdict(), classify, storage: session({}) });
  assert.ok(f.log.every((r) => r.headers.authorization === undefined));
});
