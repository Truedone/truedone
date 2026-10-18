// OPS-09: the listing check names every way the public App page can differ from packages/app/app-manifest.json, and the
// manifest records the settings set on 2026-10-18 (public, one callback on the site, no setup URL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, fetchApp, checkUrls, namedUrls, MANIFEST } from '../app-listing-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
// GitHub's answer for https://api.github.com/apps/truedone, recorded without a token after the page was set up
const recorded = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/app-listing/truedone.json'), 'utf8'));

test('the recorded public answer equals the manifest', () => {
  assert.deepEqual(compare(manifest, 200, recorded), []);
});

test('a 404 says the app is not public', () => {
  const p = compare(manifest, 404, null);
  assert.equal(p.length, 1);
  assert.match(p[0], /answered 404/);
});

test('an empty description is named on its own, before any comparison', () => {
  assert.deepEqual(compare({ ...manifest, description: '' }, 200, { ...recorded, description: '' }), ['the manifest has no description']);
  assert.deepEqual(compare({ ...manifest, description: '  \n' }, 200, { ...recorded, description: '' }), ['the manifest has no description']);
});

test('a different description is named; CRLF line ends and a trailing newline are not a difference', () => {
  assert.deepEqual(compare(manifest, 200, { ...recorded, description: `${recorded.description} more` }), ['the description differs from the manifest\'s']);
  assert.deepEqual(compare(manifest, 200, { ...recorded, description: `${manifest.description.replace(/\n/g, '\r\n')}\r\n` }), []);
  assert.deepEqual(compare(manifest, 200, { ...recorded, description: manifest.description }), []);
  assert.deepEqual(compare(manifest, 200, { ...recorded, description: '' }), ['the description differs from the manifest\'s']);
});

test('a missing or changed permission is named', () => {
  const { checks, ...rest } = recorded.permissions;
  assert.equal(compare(manifest, 200, { ...recorded, permissions: rest }).length, 1);
  assert.equal(compare(manifest, 200, { ...recorded, permissions: { ...recorded.permissions, contents: 'write' } }).length, 1);
});

test('an extra or missing event is named, in any order', () => {
  assert.equal(compare(manifest, 200, { ...recorded, events: [...recorded.events, 'issues'] }).length, 1);
  assert.equal(compare(manifest, 200, { ...recorded, events: recorded.events.slice(1) }).length, 1);
  assert.deepEqual(compare(manifest, 200, { ...recorded, events: [...recorded.events].reverse() }), []);
});

test('a different homepage is named', () => {
  assert.equal(compare(manifest, 200, { ...recorded, external_url: 'https://truedone.dev' }).length, 1);
});

test('the request carries a user-agent and no token', async () => {
  const seen = [];
  const fake = async (url, init) => { seen.push({ url, init }); return { status: 404, json: async () => ({}) }; };
  const r = await fetchApp('truedone', fake);
  assert.equal(r.status, 404);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.github.com/apps/truedone');
  assert.equal(seen[0].init.headers['user-agent'], 'truedone-app-listing-check');
  assert.equal(Object.keys(seen[0].init.headers).some((h) => h.toLowerCase() === 'authorization'), false);
});

test('the manifest records the live settings: public, the site callback only, no setup URL', () => {
  assert.equal(manifest.public, true);
  assert.deepEqual(manifest.callback_urls, ['https://truedone.pages.dev/signin/callback']);
  assert.equal('setup_url' in manifest, false);
  assert.equal(manifest.setup_on_update ?? false, false);
  assert.ok(manifest.description.length > 0);
});

test('the manifest names the homepage and one callback, and no setup URL', () => {
  assert.deepEqual(namedUrls(manifest), ['https://truedone.pages.dev', 'https://truedone.pages.dev/signin/callback']);
  assert.deepEqual(namedUrls({ url: 'https://x.test', callback_urls: [] }), ['https://x.test']);
});

test('every named URL must answer 200 or a redirect, read without following redirects; a 404 or a failed read is named', async () => {
  const seen = [];
  const answer = (codes) => async (url, init) => { seen.push({ url, init }); const status = codes[url]; if (status === 'throw') throw new Error('ECONNREFUSED'); return { status }; };
  const ok = { 'https://truedone.pages.dev': 200, 'https://truedone.pages.dev/signin/callback': 302 };
  assert.deepEqual(await checkUrls(manifest, answer(ok)), []);
  assert.equal(seen.length, 2);
  assert.ok(seen.every((s) => s.init.redirect === 'manual' && s.init.headers['user-agent'] === 'truedone-app-listing-check'));
  const bad = await checkUrls(manifest, answer({ ...ok, 'https://truedone.pages.dev/signin/callback': 404 }));
  assert.equal(bad.length, 1);
  assert.match(bad[0], /signin\/callback answered 404/);
  const down = await checkUrls(manifest, answer({ ...ok, 'https://truedone.pages.dev': 'throw' }));
  assert.equal(down.length, 1);
  assert.match(down[0], /could not be read: ECONNREFUSED/);
  assert.equal((await checkUrls(manifest, answer({ ...ok, 'https://truedone.pages.dev': 500 }))).length, 1);
});
