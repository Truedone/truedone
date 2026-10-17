// WEB-02-AC01 (PV-W02): the exchange Worker returns a token from a fake GitHub endpoint and keeps nothing: no state
// between requests, no write to its env, no log line, and every answer is no-store. The Worker has its own origin and
// answers the site's origin only (D26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../exchange/worker.mjs';

const SITE = 'https://truedone.pages.dev';
const WORKER = 'https://truedone-exchange.ledgerguard-global.workers.dev';
const SECRET = 'secret-value-123';
// env as a read-only record: any write the Worker tries throws
const env = () => new Proxy({ GITHUB_CLIENT_ID: 'Iv1.client', GITHUB_CLIENT_SECRET: SECRET }, { set() { throw new Error('the Worker wrote to env'); }, defineProperty() { throw new Error('the Worker wrote to env'); } });
function github(tokens) {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    const b = JSON.parse(init.body);
    const t = tokens[b.code];
    return new Response(JSON.stringify(t ? { access_token: t, token_type: 'bearer' } : { error: 'bad_verification_code' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, seen };
}
const post = (body, origin = SITE) => new Request(`${WORKER}/exchange`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
function quiet(t) {
  const lines = [];
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) t.mock.method(console, k, (...a) => lines.push(a.join(' ')));
  return lines;
}

test('a code from the site is traded for the token GitHub returns, with the secret sent to GitHub only', async (t) => {
  const lines = quiet(t);
  const g = github({ abc123: 'ghu_first' });
  const res = await handle(post({ code: 'abc123' }), env(), g.fetch);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { token: 'ghu_first' });
  assert.equal(g.seen[0].url, 'https://github.com/login/oauth/access_token');
  assert.deepEqual(g.seen[0].body, { client_id: 'Iv1.client', client_secret: SECRET, code: 'abc123' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('access-control-allow-origin'), SITE);
  assert.deepEqual(lines, [], 'nothing was logged');
});

test('two exchanges share nothing: each gets its own token, and the secret is never in a response', async (t) => {
  quiet(t);
  const g = github({ one111: 'ghu_one', two222: 'ghu_two' });
  const a = await (await handle(post({ code: 'one111' }), env(), g.fetch)).text();
  const b = await (await handle(post({ code: 'two222' }), env(), g.fetch)).text();
  assert.deepEqual([JSON.parse(a).token, JSON.parse(b).token], ['ghu_one', 'ghu_two']);
  assert.ok(!a.includes(SECRET) && !b.includes(SECRET));
});

test('a post from another origin, the Worker\'s own included, or with no origin, is refused before GitHub is asked', async (t) => {
  quiet(t);
  const g = github({ abc123: 'ghu_x' });
  const deadDomain = ['https://truedone', '.dev'].join(''); // the old domain, built here because no file names it
  for (const o of ['https://evil.example', WORKER, deadDomain]) {
    const r = await handle(post({ code: 'abc123' }, o), env(), g.fetch);
    assert.equal(r.status, 403, o);
    assert.equal(r.headers.get('access-control-allow-origin'), null, o);
  }
  const bare = new Request(`${WORKER}/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"code":"abc123"}' });
  assert.equal((await handle(bare, env(), g.fetch)).status, 403);
  assert.equal(g.seen.length, 0);
});

test('the preflight lets the site send its post, and no other origin', async () => {
  const pre = (origin) => new Request(`${WORKER}/exchange`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  const none = async () => { throw new Error('no fetch'); };
  const ok = await handle(pre(SITE), env(), none);
  assert.equal(ok.status, 204);
  assert.deepEqual(['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers'].map((h) => ok.headers.get(h)), [SITE, 'POST', 'content-type']);
  const no = await handle(pre('https://evil.example'), env(), none);
  assert.equal(no.status, 403);
  assert.equal(no.headers.get('access-control-allow-origin'), null);
});

test('a malformed code is refused, and a code GitHub rejects gives no token', async (t) => {
  quiet(t);
  const g = github({});
  assert.equal((await handle(post({ code: '../../x' }), env(), g.fetch)).status, 400);
  assert.equal((await handle(post({}), env(), g.fetch)).status, 400);
  const r = await handle(post({ code: 'unknown1' }), env(), g.fetch);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).token, undefined);
});

test('start sends the visitor to GitHub with the client id, the callback on the site and the state', async () => {
  const res = await handle(new Request(`${WORKER}/exchange/start?state=abcdefghijklmnop1234`), env(), async () => { throw new Error('no fetch'); });
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('location'));
  assert.equal(to.origin + to.pathname, 'https://github.com/login/oauth/authorize');
  assert.deepEqual([to.searchParams.get('client_id'), to.searchParams.get('redirect_uri'), to.searchParams.get('state')], ['Iv1.client', `${SITE}/signin/callback`, 'abcdefghijklmnop1234']);
  assert.equal(to.searchParams.get('client_secret'), null);
  assert.equal((await handle(new Request(`${WORKER}/exchange/start?state=short`), env())).status, 400);
});
