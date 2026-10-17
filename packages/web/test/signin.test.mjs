// WEB-02: sign-in keeps its state and the token in sessionStorage only, refuses a callback whose state does not
// match, returns to a same-site path only, and talks to the exchange Worker on its own origin (D26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, finish, safeReturn } from '../lib/signin.mjs';

const session = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const loc = (search = '') => { const l = { search, went: [] }; l.assign = (u) => l.went.push(['assign', u]); l.replace = (u) => l.went.push(['replace', u]); return l; };

test('start keeps the state and the return path, then hands over to the Worker\'s /exchange/start', () => {
  const s = session(), l = loc('?return=%2Focto%2Fdemo%2Fpull%2F7');
  start(l, s, () => 'state-abcdefghijklmnop');
  assert.equal(s.getItem('truedone.state'), 'state-abcdefghijklmnop');
  assert.equal(s.getItem('truedone.return'), '/octo/demo/pull/7');
  assert.deepEqual(l.went, [['assign', 'https://truedone-exchange.ledgerguard-global.workers.dev/exchange/start?state=state-abcdefghijklmnop']]);
});

test('a matching callback posts the code to the Worker\'s /exchange, keeps the token in the session and goes back', async () => {
  const s = session(); s.setItem('truedone.state', 'st-0123456789abcdef'); s.setItem('truedone.return', '/octo/demo/pull/7');
  const sent = [];
  const fetch = async (url, init) => { sent.push([url, init.method, JSON.parse(init.body)]); return new Response('{"token":"ghu_new"}', { status: 200 }); };
  const l = loc('?code=abc123&state=st-0123456789abcdef');
  assert.deepEqual(await finish(l, s, fetch), { ok: true });
  assert.deepEqual(sent, [['https://truedone-exchange.ledgerguard-global.workers.dev/exchange', 'POST', { code: 'abc123' }]]);
  assert.equal(s.getItem('truedone.token'), 'ghu_new');
  assert.equal(s.getItem('truedone.state'), null);
  assert.deepEqual(l.went, [['replace', '/octo/demo/pull/7']]);
});

test('a callback whose state does not match exchanges nothing', async () => {
  const s = session(); s.setItem('truedone.state', 'st-0123456789abcdef');
  let called = false;
  // the stand-in answers like the exchange would, so a missing state check reaches the assertions below
  const r = await finish(loc('?code=abc123&state=st-other-0000000000'), s, async () => { called = true; return new Response('{"token":"ghu_stolen"}', { status: 200 }); });
  assert.equal(r.ok, false);
  assert.equal(called, false);
  assert.equal(s.getItem('truedone.token'), null);
});

test('a callback whose exchange does not answer keeps no token and stays on the page', async () => {
  const s = session(); s.setItem('truedone.state', 'st-0123456789abcdef');
  const l = loc('?code=abc123&state=st-0123456789abcdef');
  // what a browser's fetch to another origin does when the Worker is down or refuses the preflight
  const r = await finish(l, s, async () => { throw new TypeError('Failed to fetch'); });
  assert.equal(r.ok, false);
  assert.equal(s.getItem('truedone.token'), null);
  assert.deepEqual(l.went, []);
});

test('only a same-site path is a return target', () => {
  for (const p of ['/octo/demo/pull/7', '/']) assert.equal(safeReturn(p), p);
  for (const p of ['//evil.example', 'https://evil.example/', 'javascript:alert(1)', '/\\evil', null]) assert.equal(safeReturn(p), '/', String(p));
});
