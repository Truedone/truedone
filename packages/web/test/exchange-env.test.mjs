// WEB-06-AC01: the exchange Worker reads its client as CLIENT_ID and CLIENT_SECRET, the names the deploy set on it
// (docs/ops/apps.md); while either is missing, its two routes fail closed with 500, and the old GITHUB_CLIENT_ names do
// not count; any other path or method answers 404, with or without the client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../exchange/worker.mjs';

const SITE = 'https://truedone.pages.dev';
const WORKER = 'https://truedone-exchange.ledgerguard-global.workers.dev';
const SECRET = 'secret-value-456';
const CLIENT = { CLIENT_ID: 'Iv1.prod', CLIENT_SECRET: SECRET };
const none = async () => { throw new Error('no fetch'); };
const start = () => new Request(`${WORKER}/exchange/start?state=abcdefghijklmnop1234`);
const post = (body) => new Request(`${WORKER}/exchange`, { method: 'POST', headers: { origin: SITE, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('start and the code exchange use CLIENT_ID and CLIENT_SECRET', async () => {
  const s = await handle(start(), { ...CLIENT }, none);
  assert.equal(s.status, 302);
  assert.equal(new URL(s.headers.get('location')).searchParams.get('client_id'), 'Iv1.prod');
  const sent = [];
  const github = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ access_token: 'ghu_prod' }), { status: 200 }); };
  const r = await handle(post({ code: 'abc123' }), { ...CLIENT }, github);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { token: 'ghu_prod' });
  assert.deepEqual(sent, [{ client_id: 'Iv1.prod', client_secret: SECRET, code: 'abc123' }]);
});

test('without CLIENT_ID or CLIENT_SECRET the two routes fail closed, and the old names do not count', async () => {
  for (const env of [{}, { CLIENT_ID: 'Iv1.prod' }, { CLIENT_SECRET: SECRET }, { GITHUB_CLIENT_ID: 'Iv1.prod', GITHUB_CLIENT_SECRET: SECRET }]) {
    const s = await handle(start(), env, none);
    assert.equal(s.status, 500, JSON.stringify(env));
    assert.deepEqual(await s.json(), { error: 'not configured' });
    assert.equal((await handle(post({ code: 'abc123' }), env, none)).status, 500, JSON.stringify(env));
  }
});

test('another path, or another method, is 404 whether or not the client is set', async () => {
  for (const env of [{ ...CLIENT }, {}]) {
    for (const [method, p] of [['GET', '/'], ['GET', '/favicon.ico'], ['GET', '/exchange'], ['POST', '/exchange/start'], ['GET', '/exchange/start/x'], ['PUT', '/exchange']]) {
      const r = await handle(new Request(`${WORKER}${p}`, { method, headers: { origin: SITE } }), env, none);
      assert.equal(r.status, 404, `${method} ${p} ${Object.keys(env).length ? 'with' : 'without'} the client`);
    }
  }
});
