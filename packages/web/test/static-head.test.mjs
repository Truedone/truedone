// WEB-15: measured 2026-10-19, https://truedone.pages.dev/ answered a body of <p>Loading…</p> with no meta description
// and no og tags, so a directory that reads the address, a crawler or an agent that fetches the page without running
// its script saw nothing. deploy.yml publishes packages/web as it is, and no rule in _redirects takes /, /why or
// /logo.png, so these files' bytes are what such a reader gets. Both pages carry llms.txt's opening sentence as their
// description, the og tags and twitter:card, with the App's logo at /logo.png as og:image. The home page's #app holds a
// static page in the site's shell, which app.mjs replaces when it runs: the summary, a link for each way in, /why and
// /llms.txt for coding agents. It states no release status, so it cannot disagree with release.mjs, and asks no one to
// install, recommend or spread truedone (D40). No inline script or style is added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page } from '../lib/page.mjs';
import { FOOTER_LINKS, signinHref } from '../lib/view.mjs';
import { fakeFetch, fakeDoc, textOf, classify, verdict } from './lib/fakes.mjs';

const web = new URL('../', import.meta.url);
const bytes = (p) => fs.readFileSync(new URL(p, web));
const read = (p) => bytes(p).toString('utf8');
const SITE = 'https://truedone.pages.dev';
const SUMMARY = "truedone checks whether a pull request's tests prove its change: a test should fail without the change and pass with it.";
const attr = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// markup as text: tags dropped, entities decoded, white space collapsed
const text = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const headOf = (h) => h.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';

const PAGES = {
  'index.html': { path: '/', title: 'truedone' },
  'why.html': { path: '/why', title: 'What each truedone label means - truedone' },
};
const TAGS = (p) => [
  ['name', 'description', SUMMARY],
  ['property', 'og:title', PAGES[p].title],
  ['property', 'og:description', SUMMARY],
  ['property', 'og:url', `${SITE}${PAGES[p].path}`],
  ['property', 'og:type', 'website'],
  ['property', 'og:image', `${SITE}/logo.png`],
  ['name', 'twitter:card', 'summary'],
];

// the home page's #app as served, and the main of its static page
const home = read('index.html');
const app = home.match(/<div id="app" aria-busy="true">([\s\S]*)<\/div>\n<\/body>/)?.[1] ?? '';
const main = app.match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? '';
const block = (h, tag) => h.match(new RegExp(`<${tag} class="site-${tag}">([\\s\\S]*?)</${tag}>`))?.[1];

test('the description is llms.txt\'s opening sentence', () => {
  const first = read('llms.txt').split('\n').find((l) => l.trim() && !l.startsWith('#'));
  assert.equal(first, SUMMARY);
});

test('each page\'s served head holds the description, the og tags and twitter:card once, with exact values', () => {
  for (const p of Object.keys(PAGES)) {
    const head = headOf(read(p));
    assert.equal(head.match(/<title>([^<]*)<\/title>/)?.[1], PAGES[p].title, `${p} title`);
    for (const [kind, key, value] of TAGS(p)) {
      assert.equal(head.split(`<meta ${kind}="${key}" `).length - 1, 1, `${p} has one ${key}`);
      assert.ok(head.includes(`<meta ${kind}="${key}" content="${attr(value)}">`), `${p} ${key} is ${value}`);
    }
    assert.equal(head.match(/<meta (?:name|property)="(?:description|(?:og|twitter):[\w:.-]+)"/g).length, TAGS(p).length, `${p} has no other og or twitter tag`);
  }
});

test('og:image is the App\'s logo, a PNG Pages serves at /logo.png', () => {
  const logo = bytes('logo.png');
  assert.deepEqual([...logo.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  assert.ok(logo.equals(fs.readFileSync(new URL('../app/logo.png', web))), 'the same bytes as packages/app/logo.png');
  // the rules as Pages reads them; a :placeholder takes one path segment, a * the rest (site-routes.test.mjs)
  const rules = read('_redirects').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.trim().split(/\s+/));
  const matcher = (from) => new RegExp(`^${from.split('/').map((s) => (s.startsWith(':') ? '[^/]+' : s === '*' ? '.*' : s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);
  for (const path of ['/logo.png', '/', '/why']) assert.equal(rules.find(([from]) => matcher(from).test(path)), undefined, `${path} is rewritten`);
});

test('the home page\'s #app holds a static page in the site\'s shell, before any script runs', () => {
  assert.equal(home.split('id="app"').length - 1, 1, 'one #app');
  assert.match(app, /^<div class="page">\n<header class="site-header">[\s\S]*<\/footer>\n<\/div>$/);
  assert.equal(block(app, 'header'), block(read('why.html'), 'header'));
  const footer = [...FOOTER_LINKS.map(([t, href]) => `<li><a href="${href}">${t}</a></li>`), `<li class="signin-item"><a href="${signinHref('/')}">Sign in with GitHub</a></li>`].join('');
  assert.equal(block(app, 'footer'), `\n<ul>${footer}</ul>\n`);
});

test('the static page holds the summary, a link for each way in, /why and /llms.txt for coding agents', () => {
  assert.ok(main.includes(`<p>${SUMMARY}</p>`), 'the summary');
  const links = [...main.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(links, [
    ['/Truedone/truedone-sandbox/pull/31', 'truedone.pages.dev/Truedone/truedone-sandbox/pull/31'],
    ['https://www.npmjs.com/package/truedone', 'npx truedone'],
    ['https://github.com/apps/truedone', 'github.com/apps/truedone'],
    ['https://github.com/Truedone/truedone/blob/main/packages/cli/plugin/README.md', 'truedone for Claude Code'],
    ['https://github.com/Truedone/truedone/blob/main/packages/cli/README.md#as-a-tool-for-agents-mcp', 'npx truedone mcp'],
    ['/why', 'What each verdict and label means'],
    ['/llms.txt', '/llms.txt'],
  ]);
  assert.equal(main.split(/<a /).length - 1, links.length, 'every link is a plain href');
  // the repository files two links name are on main: the plugin's README with its commands, the cli README's MCP heading
  const repo = (p) => fs.readFileSync(new URL(`../../${p}`, web), 'utf8');
  assert.match(repo('packages/cli/README.md'), /^## As a tool for agents \(MCP\)$/m);
  for (const c of ['/plugin marketplace add Truedone/truedone', '/plugin install truedone@truedone']) assert.ok(repo('packages/cli/plugin/README.md').includes(c), c);
  // the five ways in, one item and one link each, in order
  const items = main.match(/<ul>([\s\S]*?)<\/ul>/)?.[1].match(/<li>[\s\S]*?<\/li>/g) ?? [];
  assert.deepEqual(items.map((li) => text(li).split(':')[0]), ['A pull request on this site', 'The command line', 'The GitHub App', 'The Claude Code plugin', 'The MCP server']);
  for (const li of items) assert.equal(li.split('<a ').length - 1, 1, text(li));
  const t = text(main);
  assert.ok(t.includes('replace github.com with truedone.pages.dev in its address'), 'how to form a pull request\'s address');
  assert.ok(t.includes('npx truedone <PR link> checks a pull request'));
  assert.ok(main.includes('<code>/plugin marketplace add Truedone/truedone</code>, then <code>/plugin install truedone@truedone</code>'), 'the plugin\'s two install commands');
  assert.ok(t.includes('npx truedone mcp serves the check to an agent over the Model Context Protocol'));
  assert.ok(t.includes('For coding agents: /llms.txt says what truedone checks and how to run it.'));
});

test('the static page states no release status and asks no one to install, recommend or spread truedone (D40)', () => {
  const t = text(app);
  assert.doesNotMatch(t, /releas|not yet|coming|preview|\blive\b|available|\bbeta\b|Next rung/i);
  // a command the reader runs for their own use is quoted as code, and is documentation, not a request (D40)
  const prose = text(app.replace(/<code>[^<]*<\/code>/g, ' '));
  assert.doesNotMatch(prose, /recommend|spread|\bshare\b|invite|tell (?:other|your)|\bstar\b|pass (?:it|truedone) on|\binstall (?:it|truedone)\b/i);
});

test('no inline script or style: home loads only app.mjs, /why loads no script', () => {
  for (const p of Object.keys(PAGES)) {
    const h = read(p);
    assert.doesNotMatch(h, /<style|\sstyle\s*=|\son[a-z]+\s*=|javascript:/i, p);
    assert.match(h, /<link rel="stylesheet" href="\/style\.css">/, p);
  }
  assert.deepEqual(home.match(/<script[^>]*>[^<]*<\/script>/g), ['<script type="module" src="/app.mjs"></script>']);
  assert.equal(home.split('<script').length - 1, 1);
  assert.doesNotMatch(read('why.html'), /<script/i);
});

test('app.mjs mounts into #app, and the home view replaces the static page', async () => {
  assert.match(read('app.mjs'), /root: document\.getElementById\('app'\)/);
  const { doc, root } = fakeDoc();
  root.setAttribute('aria-busy', 'true');
  root.appendChild({ tag: 'div', attrs: { class: 'page' }, children: [], textContent: SUMMARY });
  await page({ pathname: '/' }, { fetch: fakeFetch().fetch, doc, root, analyse: () => verdict(), classify });
  assert.equal(root.children.length, 1);
  const t = textOf(root);
  assert.ok(!t.includes(SUMMARY), 'the static page is gone');
  assert.ok(t.includes('Check a pull request'), 'the home view is mounted');
  assert.equal(root.attrs['aria-busy'], undefined);
});
