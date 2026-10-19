// WEB-14-AC01 (D38, D39): a PR page offers the App's install for its repository, marked not released until release.mjs
// flips, and "This verdict is wrong", the wrong-verdict form filled with the PR's link, its head and base commits, the
// verdict, the reasons' check codes and this site as the version, with no PR title, body, author or reason message;
// llms.txt tells an agent how to run truedone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page } from '../lib/page.mjs';
import * as view from '../lib/view.mjs';
import { RELEASED } from '../lib/release.mjs';
import { fakeFetch, fakeDoc, find, classify, verdict, recorded } from './lib/fakes.mjs';

const reasons = [
  { check: 'weakened', file: 'test/retry.test.js', message: 'assertion on the retry count was replaced by toBeDefined', verdict: 'tampered' },
  { check: 'source_no_test', file: 'src/retry.js', message: 'source changed and no test fails without it', verdict: 'no_evidence' },
  { check: 'weakened', file: 'test/other.test.js', message: 'a second weakened assertion', verdict: 'tampered' },
];
const render = async () => {
  const { doc, root } = fakeDoc();
  await page({ pathname: recorded.pr }, { fetch: fakeFetch().fetch, doc, root, analyse: () => verdict({ verdict: 'tampered', label: 'truedone:tampered', reasons }), classify });
  return root;
};
const link = (root, text) => find(root, (e) => e.tag === 'a' && e.textContent === text)[0];

test('a PR page links the install page for its repository, marked not released while the App is not', async () => {
  const root = await render();
  const install = link(root, 'Install on octo/demo');
  assert.ok(install, 'an Install on octo/demo link');
  assert.equal(install.attrs.href, 'https://github.com/apps/truedone/installations/new');
  const note = find(root, (e) => String(e.attrs?.class ?? '').includes('not-released-app'));
  assert.equal(note.length > 0, RELEASED.app === false, 'the not-released note follows release.mjs');
});

test('a PR page links the wrong-verdict form filled with the PR, its commits, the verdict, the codes and the version', async () => {
  const root = await render();
  const report = link(root, 'This verdict is wrong');
  assert.ok(report, 'a This verdict is wrong link');
  const u = new URL(report.attrs.href);
  assert.equal(`${u.origin}${u.pathname}`, 'https://github.com/Truedone/truedone/issues/new');
  const q = Object.fromEntries(u.searchParams);
  assert.deepEqual(q, {
    template: 'wrong-verdict.yml',
    pr: 'https://github.com/octo/demo/pull/7',
    head: 'cccccccccccccccccccccccccccccccccccccccc',
    base: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    verdict: 'tampered',
    reasons: 'weakened,source_no_test',
    version: 'truedone.pages.dev',
  });
});

test('the wrong-verdict link carries no pull request text and no reason message', async () => {
  const root = await render();
  const href = decodeURIComponent(link(root, 'This verdict is wrong').attrs.href.replace(/\+/g, ' '));
  for (const text of ['Add retry', 'onerror', 'Adds tests for retry', 'helper-agent', 'toBeDefined', 'source changed']) {
    assert.ok(!href.includes(text), `the link holds no "${text}"`);
  }
});

test('reportHref fills the form from the result and the PR alone', () => {
  assert.equal(typeof view.reportHref, 'function');
  const href = view.reportHref({ verdict: 'no_evidence', reasons: [] }, { url: 'https://github.com/a/b/pull/3', head: 'h', base: 'b' });
  assert.equal(new URL(href).searchParams.get('reasons'), '');
  assert.equal(new URL(href).searchParams.get('verdict'), 'no_evidence');
});

test('llms.txt tells an agent what truedone checks and how to run it', () => {
  const t = fs.readFileSync(new URL('../llms.txt', import.meta.url), 'utf8');
  for (const needle of ['npx truedone', '--pr-line', 'init --global', 'npx truedone mcp', 'https://github.com/apps/truedone/installations/new', ...(RELEASED.action ? ['Truedone/truedone-action@v0.1.0'] : [])]) {
    assert.ok(t.includes(needle), `llms.txt names ${needle}`);
  }
  // the action's uses: line only once release.mjs has it released; until then its line says so (AGENT-02, D40)
  if (!RELEASED.action) assert.match(t, /^- The GitHub Action\b.*: not released yet\.$/m);
  assert.match(t, /fail without the change and pass with it/);
});
