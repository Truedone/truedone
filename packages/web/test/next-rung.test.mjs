// WEB-01-AC03 (PV-W05): every page shows the next rung, and the next-rung text says that red-green on someone else's
// PR executes that PR's code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from '../lib/page.mjs';
import { prView, precomputedView, homeView, rateLimitView, errorView, notFoundView } from '../lib/view.mjs';
import { build } from '../lib/dom.mjs';
import { fakeFetch, fakeDoc, textOf, classify, verdict, recorded } from './lib/fakes.mjs';

const WARNING = /red-green on someone else's PR executes that PR's code/i;
const pr = { owner: 'octo', repo: 'demo', number: 7, title: 't', url: 'https://github.com/octo/demo/pull/7', changed_files: 1 };
const views = {
  pr: prView(verdict(), pr),
  precomputed: precomputedView({ prs: [{ number: 1, title: 'a', result: verdict() }], computed_at: '2026-10-17T00:00:00Z', core_version: '0.1.0' }, 'octo', 'demo'),
  home: homeView(),
  'rate limit': rateLimitView('/octo/demo/pull/7'),
  error: errorView('x'),
  'not found': notFoundView(),
};

for (const [name, v] of Object.entries(views)) {
  test(`the ${name} page shows the next rung and the red-green warning`, () => {
    const { doc } = fakeDoc();
    const text = textOf(build(v, doc));
    assert.match(text, /Next rung/);
    assert.match(text, /npx truedone .*--run/);
    assert.match(text, WARNING);
  });
}

test('the PR page names the PR in its npx truedone command', async () => {
  const f = fakeFetch();
  const { doc, root } = fakeDoc();
  await page({ pathname: recorded.pr }, { fetch: f.fetch, doc, root, analyse: () => verdict(), classify });
  assert.match(textOf(root), /npx truedone https:\/\/github\.com\/octo\/demo\/pull\/7 --run/);
  assert.match(textOf(root), WARNING);
});
