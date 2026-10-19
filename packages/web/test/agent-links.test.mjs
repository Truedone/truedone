// AGENT-02 (D40): the home page, /why and the pull request page name /llms.txt for coding agents, once in the head as
// <link rel="alternate" type="text/plain" href="/llms.txt"> and once in the footer as "For coding agents". The PR page is
// index.html served for its path (_redirects), so its head is the home page's; its footer is the one app.mjs mounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page } from '../lib/page.mjs';
import { fakeFetch, fakeDoc, find, classify, verdict, recorded } from './lib/fakes.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ALTERNATE = '<link rel="alternate" type="text/plain" href="/llms.txt">';

test('the home page and /why name /llms.txt in their head, once', () => {
  for (const p of ['index.html', 'why.html']) {
    const html = read(p);
    const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
    assert.equal(head.split(ALTERNATE).length - 1, 1, `${p} head`);
    assert.equal(html.split('rel="alternate"').length - 1, 1, `${p} has no other alternate`);
  }
  assert.match(read('_redirects'), /^\/:owner\/:repo\/pull\/:number \/ 200$/m, 'a PR page is index.html');
});

test('the home page\'s footer, as served and as mounted, and the PR page\'s, link /llms.txt as For coding agents', async () => {
  const footer = read('index.html').match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)?.[1] ?? '';
  assert.equal(footer.split('<li><a href="/llms.txt">For coding agents</a></li>').length - 1, 1, 'index.html footer');
  for (const pathname of ['/', recorded.pr]) {
    const { doc, root } = fakeDoc();
    await page({ pathname }, { fetch: fakeFetch().fetch, doc, root, analyse: () => verdict(), classify });
    const [foot] = find(root, (e) => e.tag === 'footer');
    assert.deepEqual(find(foot, (e) => e.tag === 'a' && e.attrs.href === '/llms.txt').map((a) => a.textContent), ['For coding agents'], pathname);
  }
});
