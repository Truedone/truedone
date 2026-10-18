// WEB-10-AC01: tools/build-legal.mjs renders a document into a page with the site's shell and the title rule, with no
// script or inline style, knows the markdown the two documents use, rewrites their links for the site, and fails,
// naming the line, on any markdown it does not know.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, page, build, LEGAL, MarkdownError } from '../build-legal.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DOC = '# Privacy\n\nOne line\nwraps on.\n\n## What we read\n\n- **The site.** Reads `a.yml` and\n  [the terms](terms.md).\n- Two & three > two.\n';

test('a page has the site shell, the title "<heading> - truedone", and no script or inline style', () => {
  const html = page(DOC, 'x.md', '/privacy');
  assert.match(html, /^<!doctype html>\n<html lang="en">/);
  assert.match(html, /<title>Privacy - truedone<\/title>/);
  assert.match(html, /<link rel="stylesheet" href="\/style\.css">/);
  assert.match(html, /<header class="site-header">\n<p class="name"><a href="\/">truedone<\/a><\/p>\n<p class="tagline">Checks whether a pull request's tests prove its change/);
  const footer = html.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)[1];
  assert.deepEqual([...footer.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]), [['Why', '/why'], ['Privacy', '/privacy'], ['Terms', '/terms'], ['GitHub', 'https://github.com/Truedone/truedone'], ['Sign in with GitHub', '/signin?return=%2Fprivacy']]);
  assert.doesNotMatch(html, /<script|<style|\sstyle\s*=|\son[a-z]+\s*=|javascript:/i);
});

test('headings, wrapped paragraphs, lists with continuation lines, bold, code and links', () => {
  const { h1, body } = render(DOC, 'x.md');
  assert.equal(h1, 'Privacy');
  assert.equal(body, [
    '<h1>Privacy</h1>',
    '<p>One line wraps on.</p>',
    '<h2>What we read</h2>',
    '<ul>\n<li><strong>The site.</strong> Reads <code>a.yml</code> and <a href="/terms">the terms</a>.</li>\n<li>Two &amp; three &gt; two.</li>\n</ul>',
  ].join('\n'));
});

test('links: the two documents are site pages, other repository files are on github.com, https stays', () => {
  const link = (target) => render(`# T\n\n[x](${target})\n`, 'x.md').body.match(/href="([^"]+)"/)[1];
  assert.equal(link('privacy.md'), '/privacy');
  assert.equal(link('terms.md'), '/terms');
  assert.equal(link('../LICENSE'), 'https://github.com/Truedone/truedone/blob/main/LICENSE');
  assert.equal(link('../SECURITY.md'), 'https://github.com/Truedone/truedone/blob/main/SECURITY.md');
  assert.equal(link('https://docs.github.com/apps'), 'https://docs.github.com/apps');
  for (const bad of ['http://example.com', 'javascript:alert(1)', 'mailto:x@y.z', '//evil.example', '../../outside']) {
    assert.throws(() => link(bad), MarkdownError, bad);
  }
});

test('markdown it does not know is an error naming its line', () => {
  for (const line of ['### Deeper', '> a quote', '1. first', '| a | b |', '```', '<b>raw</b>', 'text with <b>raw</b> inside', '![image](a.png)', '* star item', '+ plus item', '---', 'some _emphasis_ here', 'some *emphasis* here', 'a [link without a target]', '  indented text']) {
    assert.throws(() => render(`# T\n\n${line}\n`, 'x.md'), (e) => e instanceof MarkdownError && /x\.md:3/.test(e.message), line);
  }
  assert.throws(() => render('# One\n\n# Two\n', 'x.md'), /a second # heading/);
  assert.throws(() => render('Only text\n', 'x.md'), /no # heading/);
});

test('both documents render, and build() writes each page the generator makes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [doc, out] of LEGAL) {
    fs.mkdirSync(path.join(dir, path.dirname(doc)), { recursive: true });
    fs.mkdirSync(path.join(dir, path.dirname(out)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, doc), path.join(dir, doc));
  }
  build(dir);
  for (const [doc, out, sitePath] of LEGAL) {
    assert.equal(fs.readFileSync(path.join(dir, out), 'utf8'), page(fs.readFileSync(path.join(ROOT, doc), 'utf8'), doc, sitePath), out);
  }
});
