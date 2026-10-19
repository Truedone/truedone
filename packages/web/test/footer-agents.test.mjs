// WEB-17-AC01 (D40): every page's footer names /llms.txt for coding agents, once. AGENT-02 put the link in the footer of
// the home page and the pull request page only, so /why, the legal pages and 404.html lacked it. It is now one of the
// footer links every page shares: each static page as committed, the legal pages as tools/build-legal.mjs makes them,
// and every page app.mjs mounts, whatever its path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page } from '../lib/page.mjs';
import { page as legalPage, LEGAL } from '../../../tools/build-legal.mjs';
import { fakeFetch, fakeDoc, find, classify, verdict, recorded } from './lib/fakes.mjs';

const web = new URL('../', import.meta.url);
const root = new URL('../../../', import.meta.url);
const read = (p, base = web) => fs.readFileSync(new URL(p, base), 'utf8');
const ITEM = '<li><a href="/llms.txt">For coding agents</a></li>';
const count = (s, needle) => s.split(needle).length - 1;

// a page's footer, as served: the link once, as the item for coding agents, and no other link to /llms.txt there
function holds(html, what) {
  const footers = html.match(/<footer class="site-footer">[\s\S]*?<\/footer>/g) ?? [];
  assert.equal(footers.length, 1, `${what}: one footer`);
  assert.equal(count(footers[0], ITEM), 1, `${what}: the footer links /llms.txt as For coding agents once`);
  assert.equal(count(footers[0], 'href="/llms.txt"'), 1, `${what}: the footer has one link to /llms.txt`);
}

test('every page of the site, the legal pages and 404 included, has the agents link in its footer once', () => {
  const pages = fs.readdirSync(web).filter((f) => f.endsWith('.html')).sort();
  assert.deepEqual(pages, ['404.html', 'index.html', 'privacy.html', 'terms.html', 'why.html']);
  for (const p of pages) holds(read(p), p);
});

test('the legal pages, as tools/build-legal.mjs makes them from the documents, have the agents link in the footer once', () => {
  assert.deepEqual(LEGAL.map(([, out]) => out), ['packages/web/privacy.html', 'packages/web/terms.html']);
  for (const [doc, out, sitePath] of LEGAL) holds(legalPage(read(doc, root), doc, sitePath), `${out} as generated`);
});

// a session store with nothing kept, so a callback fails on its state and shows its error page
const empty = () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
// GitHub's rate limit on every request
const limited = async () => ({ status: 429, ok: false, headers: { get: () => null }, json: async () => ({}), text: async () => '{}' });

test('every page app.mjs mounts has the agents link in its footer once, whatever its path', async () => {
  const cases = [
    ['home', '/'], ['a PR', recorded.pr], ['a PR GitHub does not have', '/octo/none/pull/1'], ['a rate limited PR', recorded.pr, limited],
    ['a repository with no list', '/p/octo/demo', fakeFetch({ '/precomputed/octo--demo.json': { status: 404 } }).fetch],
    ['a missing page', '/nothing/here'], ['a failed sign-in', '/signin/callback'],
  ];
  for (const [what, pathname, fetch = fakeFetch().fetch] of cases) {
    const { doc, root: mounted } = fakeDoc();
    await page({ pathname, search: '', assign() {}, replace() {} }, { fetch, doc, root: mounted, analyse: () => verdict(), classify, storage: empty() });
    const footers = find(mounted, (e) => e.tag === 'footer');
    assert.equal(footers.length, 1, `${what}: one footer`);
    const links = find(footers[0], (e) => e.tag === 'a' && e.attrs.href === '/llms.txt');
    assert.deepEqual(links.map((a) => a.textContent), ['For coding agents'], `${what} (${pathname})`);
  }
});
