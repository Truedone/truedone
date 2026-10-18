// WEB-07-AC03 (issues #59, #61, #63): the home page links one example pull request page per verdict the diff alone can
// give; every page's footer offers Sign in with GitHub, back to the page; and the next rung claims a reading of the
// diff only on a page that shows a verdict, while staying on every page (PV-W05) under its new heading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page } from '../lib/page.mjs';
import { homeView, prView, errorView, notFoundView, rateLimitView } from '../lib/view.mjs';
import { build } from '../lib/dom.mjs';
import { fakeFetch, fakeDoc, find, textOf, classify, verdict, recorded } from './lib/fakes.mjs';

const pr = { owner: 'octo', repo: 'demo', number: 7, title: 't', url: 'https://github.com/octo/demo/pull/7', changed_files: 1 };
const tree = (v) => { const { doc } = fakeDoc(); return build(v, doc); };
const DIFF = /This page reads the diff only/;
const HEADING = /Next rung: run the PR's own tests on your machine/;

test('home links one example pull request page per verdict, each a public PR page of this site', () => {
  const links = find(tree(homeView()), (e) => e.tag === 'a' && /^\/[^/]+\/[^/]+\/pull\/\d+$/.test(e.attrs.href ?? ''));
  const names = links.map((a) => a.textContent);
  assert.equal(links.length, 5, `${links.length} example links`);
  assert.equal(new Set(names).size, names.length, 'one per verdict');
  assert.deepEqual(names, ['Tampered', 'Test changes: review', 'No red-green evidence', 'Tests changed: not run', 'Not applicable']);
});

test('every page offers Sign in with GitHub in its footer, returning to that page', async () => {
  for (const pathname of ['/', recorded.pr, '/nothing/here']) {
    const { doc, root } = fakeDoc();
    await page({ pathname }, { fetch: fakeFetch().fetch, doc, root, analyse: () => verdict(), classify });
    const [footer] = find(root, (e) => e.tag === 'footer');
    const [signin] = find(footer, (e) => e.tag === 'a' && e.textContent === 'Sign in with GitHub');
    assert.equal(signin?.attrs.href, `/signin?return=${encodeURIComponent(pathname)}`, pathname);
  }
  const why = fs.readFileSync(new URL('../why.html', import.meta.url), 'utf8').match(/<footer[\s\S]*<\/footer>/)?.[0] ?? '';
  assert.match(why, /<a href="\/signin\?return=%2Fwhy">Sign in with GitHub<\/a>/);
});

test('the next rung claims a reading of the diff only where a verdict is shown, and keeps its heading everywhere', () => {
  const withVerdict = textOf(tree(prView(verdict(), pr)));
  assert.match(withVerdict, DIFF);
  assert.match(withVerdict, HEADING);
  for (const [name, v] of [['home', homeView()], ['error', errorView('x')], ['not found', notFoundView()], ['rate limit', rateLimitView('/x')]]) {
    const text = textOf(tree(v));
    assert.doesNotMatch(text, DIFF, name);
    assert.match(text, HEADING, name);
    assert.match(text, /npx truedone .*--run/, name);
  }
});
