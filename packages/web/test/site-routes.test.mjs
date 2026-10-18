// WEB-13 (#110): https://truedone.pages.dev/no/such-page answered 200 with the not-found view, because Pages serves the
// app shell for every path when a site has no 404.html, and /favicon.ico answered that page too. _redirects now
// rewrites only the app's routes, with 200, to /, where Pages serves index.html, with no catch-all, so Pages serves
// 404.html, with 404, for every other path. A rewrite to /index.html or /index answers 308 to / (Pages' pretty URLs,
// measured with wrangler pages dev), which would send every PR page and the sign-in home. A placeholder does not
// match a trailing slash, so each form route() takes with one has its own rule. Every kind of route lib/route.mjs
// returns has a rule or a file Pages serves, so a new route cannot be left out. 404.html is the not-found view in the site's shell: its header, heading and footer stand before app.mjs
// runs, and app.mjs then mounts the view over them for the visitor's path, with the next rung as release.mjs has it,
// so a release flip needs no edit here. Every page links the logo, /favicon.svg, as its icon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { route } from '../lib/route.mjs';
import { page } from '../lib/page.mjs';
import { notFoundView, titleOf, FOOTER_LINKS, signinHref } from '../lib/view.mjs';
import { fakeFetch, fakeDoc, textOf, classify, verdict } from './lib/fakes.mjs';

const web = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, web), 'utf8');
const exists = (p) => fs.existsSync(new URL(p, web));

// the rules as Pages reads them: source, target and status on each line that is not blank or a comment
const rules = () => read('_redirects').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.trim().split(/\s+/));
// a source as Pages matches it: a :placeholder takes one path segment, a * takes the rest
const matcher = (from) => new RegExp(`^${from.split('/').map((s) => (s.startsWith(':') ? '[^/]+' : s === '*' ? '.*' : s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);
const ruleFor = (path) => rules().find(([from]) => matcher(from).test(path));

// one address of each kind route() returns, and what Pages serves for it
const SAMPLES = {
  pr: ['/octo/demo/pull/7', 'rule'],
  precomputed: ['/p/octo/demo', 'rule'],
  signin: ['/signin', 'rule'],
  callback: ['/signin/callback', 'rule'],
  home: ['/', 'index.html'],
  not_found: ['/no/such-page', '404.html'],
};

test('the routes file rewrites exactly the app\'s routes to / with 200, and has no catch-all', () => {
  assert.deepEqual(rules(), [
    ['/signin', '/', '200'],
    ['/signin/callback', '/', '200'],
    ['/:owner/:repo/pull/:number', '/', '200'],
    ['/:owner/:repo/pull/:number/', '/', '200'],
    ['/p/:owner/:repo', '/', '200'],
    ['/p/:owner/:repo/', '/', '200'],
  ]);
  for (const [from] of rules()) assert.doesNotMatch(from, /\*/, `${from} is a splat`);
  for (const path of ['/no/such-page', '/a', '/a/b', '/a/b/c', '/a/b/pull/7/files', '/why', '/style.css', '/favicon.ico', '/precomputed/o--r.json']) {
    assert.equal(ruleFor(path), undefined, `${path} is rewritten`);
  }
});

test('every kind of route lib/route.mjs returns has a rule or a file Pages serves, with and without a trailing slash', () => {
  const kinds = [...new Set([...read('lib/route.mjs').matchAll(/kind: '([a-z_]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(kinds, Object.keys(SAMPLES).sort(), 'a sample address for every kind');
  for (const [kind, [path, by]] of Object.entries(SAMPLES)) {
    assert.equal(route(path).kind, kind, path);
    if (by === 'rule') {
      assert.deepEqual(ruleFor(path)?.slice(1), ['/', '200'], `${path} is rewritten to the app`);
      if (route(`${path}/`).kind === kind) assert.deepEqual(ruleFor(`${path}/`)?.slice(1), ['/', '200'], `${path}/ is rewritten to the app`);
    } else {
      assert.equal(ruleFor(path), undefined, `${path} has no rule`);
      assert.ok(exists(by), `${by} exists for ${path}`);
    }
  }
});

test('404.html is the not-found view in the site\'s shell, which app.mjs mounts over for the visitor\'s path', async () => {
  const html = read('404.html');
  const view = notFoundView();
  const block = (h, tag) => h.match(new RegExp(`<${tag} class="site-${tag}">([\\s\\S]*?)</${tag}>`))?.[1];
  assert.equal(html.match(/<title>([^<]*)<\/title>/)?.[1], titleOf(view));
  assert.equal(block(html, 'header'), block(read('why.html'), 'header'));
  const footer = [...FOOTER_LINKS.map(([text, href]) => `<li><a href="${href}">${text}</a></li>`), `<li class="signin-item"><a href="${signinHref('/')}">Sign in with GitHub</a></li>`].join('');
  assert.equal(block(html, 'footer'), `\n<ul>${footer}</ul>\n`);
  const main = html.match(/<main>([\s\S]*?)<\/main>/)?.[1];
  assert.equal(main, `\n<h1>${view.children[0].text}</h1>\n<p>${view.children[1].text}</p>\n`);
  // the static view sits in #app, which page.mjs replaces; the next rung comes from app.mjs, so release.mjs alone flips it
  assert.match(html, /<body>\n<div id="app"><div class="page">\n<header class="site-header">/);
  assert.doesNotMatch(html, /Not released yet|Next rung/);
  assert.deepEqual(html.match(/<script[^>]*>[^<]*<\/script>/g), ['<script type="module" src="/app.mjs"></script>']);
  assert.match(html, /<link rel="stylesheet" href="\/style\.css">/);
  assert.doesNotMatch(html, /<style|\sstyle\s*=|\son[a-z]+\s*=|javascript:/i);
  const { doc, root } = fakeDoc();
  await page({ pathname: SAMPLES.not_found[0] }, { fetch: fakeFetch().fetch, doc, root, analyse: () => verdict(), classify });
  const text = textOf(root);
  for (const line of [view.children[0].text, view.children[1].text, 'Next rung: run the PR\'s own tests on your machine']) assert.ok(text.includes(line), line);
});

test('every page links /favicon.svg as its icon, and the file is the logo', () => {
  const pages = fs.readdirSync(web).filter((f) => f.endsWith('.html')).sort();
  assert.deepEqual(pages, ['404.html', 'index.html', 'privacy.html', 'terms.html', 'why.html']);
  for (const p of pages) {
    const head = read(p).match(/<head>([\s\S]*?)<\/head>/)[1];
    assert.equal(head.split('<link rel="icon" href="/favicon.svg" type="image/svg+xml">').length - 1, 1, `${p} links the icon once`);
  }
  const svg = read('favicon.svg');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" [^>]*viewBox="0 0 512 512">\n/);
  assert.match(svg, /<\/svg>\n$/);
  for (const colour of ['#0d1117', '#cf222e', '#2da44e', '#ffffff']) assert.ok(svg.includes(`"${colour}"`), `the logo's ${colour}`);
  assert.doesNotMatch(svg, /<script|<foreignObject|href=|\son[a-z]+\s*=/i, 'nothing an image cannot hold');
});
