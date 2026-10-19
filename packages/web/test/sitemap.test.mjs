// WEB-16: packages/web/sitemap.xml lists the pages the site serves at https://truedone.pages.dev and /llms.txt, and
// robots.txt lets every crawler in and names the sitemap. The pages are read as the site's 404 test reads them, every
// .html file in packages/web, so a page added later without a sitemap line fails here: index.html is /, 404.html is
// the not-found page with no address of its own, and every other page is its name without .html, the address Pages
// serves it at and the footer links. No rule in _redirects takes /sitemap.xml, /robots.txt or a page in the sitemap,
// and _headers sets no type, so Pages serves each as the file it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FOOTER_LINKS } from '../lib/view.mjs';

const web = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, web), 'utf8');
const exists = (p) => fs.existsSync(new URL(p, web));
const SITE = 'https://truedone.pages.dev';

// the rules as Pages reads them, and a source as Pages matches it, as the site's 404 test has them
const rules = () => read('_redirects').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.trim().split(/\s+/));
const matcher = (from) => new RegExp(`^${from.split('/').map((s) => (s.startsWith(':') ? '[^/]+' : s === '*' ? '.*' : s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);
const ruleFor = (path) => rules().find(([from]) => matcher(from).test(path));

// the pages the site serves, each at its address: every .html file the 404 test lists but 404.html
const pages = () => fs.readdirSync(web).filter((f) => f.endsWith('.html') && f !== '404.html').map((f) => (f === 'index.html' ? '/' : `/${f.slice(0, -'.html'.length)}`)).sort();
const locs = () => [...read('sitemap.xml').matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);

test('sitemap.xml is a urlset of one loc for each page the site serves and one for /llms.txt, and nothing else', () => {
  assert.ok(exists('sitemap.xml'), 'packages/web/sitemap.xml exists');
  const xml = read('sitemap.xml');
  const head = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  assert.ok(xml.startsWith(head), 'the XML declaration and the sitemap namespace');
  assert.ok(xml.endsWith('</urlset>\n'), 'the urlset closes the file');
  const body = xml.slice(head.length, -'</urlset>\n'.length);
  assert.equal(body.replace(/^ {2}<url><loc>[^<]*<\/loc><\/url>\n/gm, ''), '', 'only url lines, each one loc');
  assert.equal(new Set(locs()).size, locs().length, 'no address twice');
  assert.deepEqual([...locs()].sort(), [...pages(), '/llms.txt'].map((p) => `${SITE}${p}`).sort());
  // each page the footer links is in the sitemap at the address the footer gives it
  for (const [, href] of FOOTER_LINKS.filter(([, h]) => h.startsWith('/'))) assert.ok(locs().includes(`${SITE}${href}`), `${href} is in the sitemap`);
});

test('robots.txt lets every crawler in and names the sitemap', () => {
  const lines = read('robots.txt').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(lines, ['User-agent: *', 'Allow: /', `Sitemap: ${SITE}/sitemap.xml`]);
});

test('Pages serves sitemap.xml, robots.txt and every address in the sitemap as files, with no rule rewriting them', () => {
  for (const f of ['sitemap.xml', 'robots.txt', 'llms.txt']) {
    assert.ok(exists(f), `packages/web/${f} exists`);
    assert.equal(ruleFor(`/${f}`), undefined, `/${f} is rewritten`);
  }
  for (const p of pages()) assert.equal(ruleFor(p), undefined, `${p} is rewritten`);
  for (const [from] of rules()) assert.doesNotMatch(from, /\*/, `${from} is a splat`);
  assert.doesNotMatch(read('_headers'), /^\s*Content-Type\s*:/im, '_headers sets no type, so Pages types each file by its name');
});
