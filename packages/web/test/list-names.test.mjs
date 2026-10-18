// WEB-09-AC03 (#85, WCAG 1.3.1; and #app's busy state): both reasons lists on a PR page carry an accessible name, read
// from the mounted tree as a browser computes it from aria-labelledby. The reasons that give the verdict are named
// "Reasons for the verdict" by a visually hidden label; the lesser ones are named by "Also noted". #app is aria-busy in
// index.html and while page() reads the PR, and not once a view is mounted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page } from '../lib/page.mjs';
import { prView, shell } from '../lib/view.mjs';
import { build } from '../lib/dom.mjs';
import { fakeFetch, fakeDoc, find, classify, verdict, recorded } from './lib/fakes.mjs';

const pr = { owner: 'octo', repo: 'demo', number: 7, title: 't', url: 'https://github.com/octo/demo/pull/7', changed_files: 1 };
const weaker = { check: 'weakened', file: 'a.test.js', message: 'Test a has a weaker assertion on head.', verdict: 'tampered' };
const unrun = { check: 'unrun', file: 'a.test.js', message: 'Tests in a.test.js changed and have not been run.', verdict: 'unrun' };
const lists = (tree) => find(tree, (e) => e.tag === 'ul' && /\breasons\b/.test(e.attrs.class ?? ''));
// the accessible name aria-labelledby gives: the text of the element with that id
const nameOf = (tree, e) => {
  const ids = (e.attrs['aria-labelledby'] ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => { const hit = find(tree, (x) => x.attrs.id === id); assert.equal(hit.length, 1, `one element with id ${id}`); return hit[0].textContent; }).join(' ');
};

test('the reasons that give the verdict and the lesser ones are two lists, each with its own name', () => {
  const { doc } = fakeDoc();
  const tree = build(shell(prView(verdict({ verdict: 'tampered', reasons: [weaker, unrun] }), pr)), doc);
  const [first, second] = lists(tree);
  assert.equal(lists(tree).length, 2);
  assert.equal(nameOf(tree, first), 'Reasons for the verdict');
  assert.equal(nameOf(tree, second), 'Also noted');
  const [label] = find(tree, (x) => x.attrs.id === first.attrs['aria-labelledby']);
  assert.match(label.attrs.class, /\bvisually-hidden\b/, 'the first label is for screen readers only');
  const [also] = find(tree, (x) => x.attrs.id === second.attrs['aria-labelledby']);
  assert.match(also.attrs.class, /\balso\b/, 'the second is named by the visible "Also noted"');
});

test('a PR whose reasons all give the verdict has the one named list', () => {
  const { doc } = fakeDoc();
  const tree = build(shell(prView(verdict({ verdict: 'tampered', reasons: [weaker] }), pr)), doc);
  assert.deepEqual(lists(tree).map((e) => nameOf(tree, e)), ['Reasons for the verdict']);
});

test('index.html marks #app aria-busy while it shows Loading', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<div id="app" aria-busy="true"><main><p>Loading/);
});

test('#app stays aria-busy while page() reads the PR, and is not once the view is mounted', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const f = fakeFetch();
  const fetch = async (...a) => { await gate; return f.fetch(...a); };
  const { doc, root } = fakeDoc();
  root.setAttribute('aria-busy', 'true');
  const done = page({ pathname: recorded.pr }, { fetch, doc, root, analyse: () => verdict(), classify });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(root.attrs['aria-busy'], 'true', 'busy while GitHub is read');
  assert.equal(root.children.length, 0, 'nothing mounted yet');
  release();
  await done;
  assert.equal(root.attrs['aria-busy'], undefined, 'not busy after the view mounts');
  assert.ok(root.children.length > 0);
});

test('every mounted view ends the busy state: home, not found and an error', async () => {
  for (const pathname of ['/', '/nothing/here', '/octo/demo/pull/999']) {
    const { doc, root } = fakeDoc();
    root.setAttribute('aria-busy', 'true');
    await page({ pathname }, { fetch: fakeFetch().fetch, doc, root, analyse: () => verdict(), classify });
    assert.equal(root.attrs['aria-busy'], undefined, pathname);
  }
});
