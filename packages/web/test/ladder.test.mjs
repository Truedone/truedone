// WEB-11-AC01 (#88): nothing on the site showed a clear green. A PR page now shows the verdict ladder under its badge:
// the four rungs the diff and a red-green run can give, Tampered, Test changes: review, Tests changed: not run and
// Proven, in that order, with this PR's rung marked by aria-current and a visible "(this PR)", and Proven always in the
// green badge style. Under it, a line says green comes from running the tests and links /why#truedone-yes; home carries
// the same line beside its examples, and /why's Proven section opens with the same ladder, Proven green at its top.
// Not applicable pages, and the precomputed list, show no ladder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page } from '../lib/page.mjs';
import { homeView } from '../lib/view.mjs';
import { build } from '../lib/dom.mjs';
import { fakeFetch, fakeDoc, find, textOf, classify, verdict, recorded } from './lib/fakes.mjs';

const RUNGS = ['Tampered', 'Test changes: review', 'Tests changed: not run', 'Proven'];
const classes = (e) => String(e.attrs.class ?? '').split(/\s+/).filter(Boolean);
async function prPage(v) {
  const { doc, root } = fakeDoc();
  await page({ pathname: recorded.pr }, { fetch: fakeFetch().fetch, doc, root, analyse: () => verdict({ verdict: v }), classify });
  return root;
}
const ladders = (root) => find(root, (e) => e.tag === 'ol' && classes(e).includes('ladder'));
const rungs = (ol) => ol.children.map((li) => ({ name: li.children[0].textContent, current: li.attrs['aria-current'] ?? null, cls: classes(li.children[0]), mark: li.children[1]?.textContent ?? null }));
const greenLine = (root) => find(root, (e) => e.tag === 'p' && classes(e).includes('green-line'));

for (const [v, at, badge] of [['tampered', 0, 'verdict-tampered'], ['review', 1, 'verdict-review'], ['unrun', 2, 'verdict-unrun'], ['proven', 3, 'verdict-yes']]) {
  test(`a ${v} PR page shows the four rungs in order, its own rung marked, Proven green`, async () => {
    const root = await prPage(v);
    const [ol] = ladders(root);
    assert.ok(ol, 'a ladder');
    assert.equal(ol.attrs['aria-label'], 'The verdict ladder');
    const r = rungs(ol);
    assert.deepEqual(r.map((x) => x.name), RUNGS);
    assert.deepEqual(r.map((x) => x.current), RUNGS.map((_, i) => (i === at ? 'step' : null)), 'aria-current on its rung only');
    assert.equal(r[at].mark, ' (this PR)', 'marked in text, not by colour alone');
    assert.deepEqual(r[at].cls, ['verdict', badge]);
    assert.ok(r[3].cls.includes('verdict-yes'), 'Proven in the green badge style');
    // the ladder sits right under the verdict line
    const [main] = find(root, (e) => e.tag === 'main');
    const at1 = main.children.findIndex((c) => classes(c).includes('verdict-line'));
    assert.ok(classes(main.children[at1 + 1]).includes('ladder-block'));
  });
}

test('under the ladder, the line says where green comes from and links /why#truedone-yes', async () => {
  const [line] = greenLine(await prPage('unrun'));
  assert.equal(textOf(line).replace(/\n/g, ''), 'Green comes from running the tests: add the truedone step');
  const [a] = find(line, (e) => e.tag === 'a');
  assert.equal(a.attrs.href, '/why#truedone-yes');
  assert.equal(a.textContent, 'add the truedone step');
});

test('home carries the same line right after its examples', () => {
  const { doc } = fakeDoc();
  const main = build(homeView(), doc);
  const i = main.children.findIndex((c) => classes(c).includes('examples'));
  assert.ok(i >= 0);
  assert.ok(classes(main.children[i + 1]).includes('green-line'));
  assert.equal(find(main.children[i + 1], (e) => e.tag === 'a')[0].attrs.href, '/why#truedone-yes');
});

test('a Not applicable page shows no ladder and no green line', async () => {
  const root = await prPage('not_applicable');
  assert.equal(ladders(root).length, 0);
  assert.equal(greenLine(root).length, 0);
});

test('Proven (new behaviour) marks the Proven rung; a verdict on no rung shows the ladder with none marked', async () => {
  assert.deepEqual(rungs(ladders(await prPage('proven_new'))[0]).map((x) => x.current), [null, null, null, 'step']);
  for (const v of ['no_evidence', 'could_not_run', 'pending', 'proven_weak']) {
    const [ol] = ladders(await prPage(v));
    assert.ok(ol, v);
    assert.deepEqual(rungs(ol).map((x) => x.current), [null, null, null, null], v);
    assert.ok(rungs(ol)[3].cls.includes('verdict-yes'), v);
  }
});

test('the precomputed list shows no ladder', async () => {
  const { doc, root } = fakeDoc();
  const body = JSON.stringify({ prs: [{ number: 1, title: 'a', result: verdict() }] });
  await page({ pathname: '/p/octo/demo' }, { fetch: fakeFetch({ '/precomputed/octo--demo.json': { status: 200, body, headers: { 'content-type': 'application/json' } } }).fetch, doc, root, analyse: () => verdict(), classify });
  assert.equal(ladders(root).length, 0);
});

test('/why\'s Proven section opens with the static ladder, Proven green at its top, and the line', () => {
  const html = fs.readFileSync(new URL('../why.html', import.meta.url), 'utf8');
  const section = html.match(/<section id="truedone-yes">([\s\S]*?)<\/section>/)[1];
  assert.match(section, /^\n<h2>truedone:yes<\/h2>\n<ol class="ladder" aria-label="The verdict ladder">/);
  const ol = section.match(/<ol class="ladder"[^>]*>([\s\S]*?)<\/ol>/)[1];
  const r = [...ol.matchAll(/<li><span class="([^"]+)">([^<]+)<\/span><\/li>/g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(r, [['Tampered', 'rung'], ['Test changes: review', 'rung'], ['Tests changed: not run', 'rung'], ['Proven', 'verdict verdict-yes']]);
  // WEB-12 adds the release note while the action is not released
  assert.match(section, /<p class="green-line">Green comes from running the tests: add the truedone step \(not released yet\)\.<\/p>/);
});
