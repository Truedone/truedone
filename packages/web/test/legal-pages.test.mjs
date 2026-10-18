// WEB-10: /privacy and /terms are pages of the site, generated from docs/privacy.md and docs/terms.md by
// tools/build-legal.mjs. The committed pages must be the generator's output byte for byte, so a change to a document or
// to the generator without the pages fails this suite in CI. Their header matches why.html's, their footer keeps the
// four links and sign-in back to the page, and _redirects no longer sends them off the site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page, LEGAL } from '../../../tools/build-legal.mjs';

const root = new URL('../../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');

test('the committed privacy and terms pages are what the generator makes from the documents', () => {
  for (const [doc, out, sitePath] of LEGAL) assert.equal(read(out), page(read(doc), doc, sitePath), `${out} is stale: run node tools/build-legal.mjs`);
});

test('the pages share why.html\'s header and keep the footer links and sign-in back to the page', () => {
  const header = (html) => html.match(/<header class="site-header">[\s\S]*?<\/header>/)[0];
  const why = read('packages/web/why.html');
  for (const [, out, sitePath] of LEGAL) {
    const html = read(out);
    assert.equal(header(html), header(why), out);
    const footer = html.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)[1];
    const whyFooter = why.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)[1];
    assert.equal(footer, whyFooter.replace('/signin?return=%2Fwhy', `/signin?return=${encodeURIComponent(sitePath)}`), out);
  }
});

test('_redirects no longer sends /privacy or /terms to github.com', () => {
  assert.doesNotMatch(read('packages/web/_redirects'), /^\/(privacy|terms)\s/m);
});
