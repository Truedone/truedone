// WEB-09-AC01 (#82, WCAG 2.4.2): every route page() mounts sets document.title to name its view, ending " - truedone";
// a PR page names its verdict and owner/repo#n, so a visitor with several PR tabs can tell them apart. Each route runs
// through page() with recorded GitHub responses; the static /why follows the same rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page } from '../lib/page.mjs';
import { VERDICTS } from '../lib/view.mjs';
import { fakeFetch, fakeDoc, classify, verdict, recorded } from './lib/fakes.mjs';

const PR = 'https://api.github.com/repos/octo/demo/pulls/7';
const session = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
async function title(pathname, { fetch = fakeFetch().fetch, result = verdict(), search = '' } = {}) {
  const { doc, root } = fakeDoc();
  await page({ pathname, search, assign() {}, replace() {} }, { fetch, doc, root, analyse: () => result, classify, storage: session() });
  return doc.title;
}

test('a PR page is titled with its verdict and owner/repo#n, for every verdict', async () => {
  for (const [id, name] of Object.entries(VERDICTS)) {
    assert.equal(await title(recorded.pr, { result: verdict({ verdict: id }) }), `${name}: octo/demo#7 - truedone`, id);
  }
});

test('every other route is titled with its heading', async () => {
  const precomputed = { prs: [{ number: 1, title: 'a', result: verdict() }] };
  const routes = [
    ['home', '/', {}, 'Check a pull request - truedone'],
    ['not found', '/nothing/here', {}, 'Not a truedone.pages.dev page - truedone'],
    ['a PR GitHub does not have', recorded.pr, { fetch: fakeFetch({ [PR]: { status: 404, body: '{"message":"Not Found"}' } }).fetch }, 'This page could not be shown - truedone'],
    ['the rate limit', recorded.pr, { fetch: fakeFetch({ [PR]: { status: 403, body: '{}', headers: { 'x-ratelimit-remaining': '0' } } }).fetch }, 'GitHub\'s hourly limit for anonymous reads is used up - truedone'],
    ['a repository with no list', '/p/octo/demo', { fetch: fakeFetch({ '/precomputed/octo--demo.json': { status: 404, body: '' } }).fetch }, 'octo/demo has no list yet - truedone'],
    ['a precomputed list', '/p/octo/demo', { fetch: fakeFetch({ '/precomputed/octo--demo.json': { status: 200, body: JSON.stringify(precomputed), headers: { 'content-type': 'application/json' } } }).fetch }, 'octo/demo: the last 1 PRs - truedone'],
    ['a sign-in that did not complete', '/signin/callback', { search: '?state=x&code=y' }, 'The sign-in did not complete - truedone'],
  ];
  for (const [what, pathname, opts, want] of routes) assert.equal(await title(pathname, opts), want, what);
});

test('the static /why is titled the same way, with its heading', () => {
  const html = fs.readFileSync(new URL('../why.html', import.meta.url), 'utf8');
  const h1 = html.match(/<h1>([^<]+)<\/h1>/)[1];
  assert.equal(html.match(/<title>([^<]+)<\/title>/)[1], `${h1} - truedone`);
  assert.equal(h1, 'What each truedone label means');
});
