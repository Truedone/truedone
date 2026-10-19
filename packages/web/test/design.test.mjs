// WEB-05: the site's design. Every view lib/view.mjs builds sits between a header with the name and what truedone does,
// and a footer with Why, Privacy, Terms and GitHub; page.mjs mounts every view that way; the verdict badge's class
// names the verdict's label; /why uses the same badges; both pages link the one stylesheet, which styles every badge
// and has a dark scheme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page } from '../lib/page.mjs';
import { prView, precomputedView, homeView, rateLimitView, errorView, notFoundView, shell, VERDICTS } from '../lib/view.mjs';
import { build } from '../lib/dom.mjs';
import { fakeFetch, fakeDoc, find, classify, verdict, recorded } from './lib/fakes.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const pr = { owner: 'octo', repo: 'demo', number: 7, title: 't', url: 'https://github.com/octo/demo/pull/7', changed_files: 1 };
const FOOTER = [['Why', '/why'], ['Privacy', '/privacy'], ['Terms', '/terms'], ['GitHub', 'https://github.com/Truedone/truedone']];
// each verdict, its label, and the badge class that label gives (Not applicable sets no label)
const LABELS = {
  tampered: 'truedone:tampered', review: 'truedone:review', could_not_run: 'truedone:could-not-run', proven: 'truedone:yes',
  proven_new: 'truedone:yes', proven_weak: 'truedone:weak', no_evidence: 'truedone:no-evidence', pending: 'truedone:pending',
  unrun: 'truedone:unrun', not_applicable: null,
};
const badgeOf = (label) => `verdict-${label ? label.replace(/^truedone:/, '') : 'none'}`;
const classes = (e) => String(e.attrs.class ?? '').split(/\s+/).filter(Boolean);

// a mounted tree: the header with the name linked home and a tagline, the footer with the four links in order
function chrome(tree, what, path = '/') {
  const [header] = find(tree, (e) => e.tag === 'header');
  assert.ok(header, `${what}: a header`);
  assert.ok(find(header, (e) => e.tag === 'a' && e.attrs.href === '/' && e.textContent === 'truedone').length, `${what}: the name, linked home`);
  assert.ok(find(header, (e) => classes(e).includes('tagline') && /tests prove its change/.test(e.textContent)).length, `${what}: one line on what it does`);
  const [footer] = find(tree, (e) => e.tag === 'footer');
  assert.ok(footer, `${what}: a footer`);
  // the four links, on the home and PR pages the link for coding agents (AGENT-02), then sign-in back to the page (WEB-07)
  const agents = path === '/' || /^\/[^/]+\/[^/]+\/pull\/\d+$/.test(path) ? [['For coding agents', '/llms.txt']] : [];
  assert.deepEqual(find(footer, (e) => e.tag === 'a').map((a) => [a.textContent, a.attrs.href]), [...FOOTER, ...agents, ['Sign in with GitHub', `/signin?return=${encodeURIComponent(path)}`]], `${what}: the footer links`);
  const kids = tree.tag === 'div' ? tree.children.map((c) => c.tag) : [];
  assert.deepEqual(kids, ['header', 'main', 'footer'], `${what}: header, then the view, then the footer`);
}

test('every view, put in the shell, has the header and the footer with Why, Privacy, Terms and GitHub', () => {
  const views = {
    pr: prView(verdict(), pr),
    precomputed: precomputedView({ prs: [{ number: 1, title: 'a', result: verdict() }] }, 'octo', 'demo'),
    home: homeView(), 'rate limit': rateLimitView('/x'), error: errorView('x'), 'not found': notFoundView(),
  };
  for (const [name, v] of Object.entries(views)) {
    const { doc } = fakeDoc();
    chrome(build(shell(v), doc), name);
  }
});

test('page() mounts the home page, a PR page and a missing page in the shell', async () => {
  for (const [what, pathname] of [['home', '/'], ['PR', recorded.pr], ['not found', '/nothing/here']]) {
    const { doc, root } = fakeDoc();
    await page({ pathname }, { fetch: fakeFetch().fetch, doc, root, analyse: () => verdict(), classify });
    chrome(root.children[0], what, pathname);
  }
});

test('the verdict badge of every verdict has the class verdict and the class its label names', () => {
  assert.deepEqual(Object.keys(LABELS).sort(), Object.keys(VERDICTS).sort(), 'every verdict is covered');
  for (const [v, label] of Object.entries(LABELS)) {
    const { doc } = fakeDoc();
    const [badge] = find(build(prView(verdict({ verdict: v, label }), pr), doc), (e) => classes(e).includes('verdict'));
    assert.deepEqual(classes(badge), ['verdict', badgeOf(label)], v);
    assert.equal(badge.textContent, VERDICTS[v], v);   // the name alone; "Verdict: " is a visually hidden label (WEB-07)
    const row = build(precomputedView({ prs: [{ number: 1, title: 'a', result: verdict({ verdict: v, label }) }] }, 'o', 'r'), doc);
    assert.deepEqual(classes(find(row, (e) => classes(e).includes('verdict'))[0]), ['verdict', badgeOf(label)], `${v} in the precomputed list`);
  }
});

test('/why shows each label section with the same badges, between the same header and footer', () => {
  const html = read('why.html');
  const sections = [...html.matchAll(/<section id="truedone-([a-z-]+)">([\s\S]*?)<\/section>/g)];
  assert.equal(sections.length, 8);
  for (const [, label, body] of sections) {
    const badges = [...body.matchAll(/<h3 class="([^"]+)">/g)].map((m) => m[1]);
    assert.ok(badges.length >= 1, label);
    for (const b of badges) assert.equal(b, `verdict verdict-${label}`, label);
  }
  assert.match(html, /<header class="site-header">[\s\S]*<a href="\/">truedone<\/a>[\s\S]*class="tagline"[\s\S]*<\/header>\s*<main/);
  const footer = html.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)?.[1] ?? '';
  assert.deepEqual([...footer.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]), [...FOOTER, ['Sign in with GitHub', '/signin?return=%2Fwhy']]);
});

test('both pages link the one stylesheet, which styles every badge and has a dark scheme', () => {
  for (const p of ['index.html', 'why.html']) assert.match(read(p), /<link rel="stylesheet" href="\/style\.css">/, p);
  const css = read('style.css');
  for (const label of new Set(Object.values(LABELS))) assert.match(css, new RegExp(`\\.${badgeOf(label)}\\b`), badgeOf(label));
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.doesNotMatch(css, /@import|url\(|https?:/, 'no external font, image or sheet');
});
