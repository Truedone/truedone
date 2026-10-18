// WEB-12-AC01 (#92): every page told a visitor to run npx truedone, add the truedone step and use the plugin, and none
// is released. With every surface false in lib/release.mjs, each view that names the command, the step or the plugin
// says "Not released yet" with the link to follow the first release; flipping one surface removes its notice and no
// other. The static /why carries the same line exactly while all four are false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RELEASED, FOLLOW } from '../lib/release.mjs';
import { prView, precomputedView, homeView, rateLimitView, errorView, notFoundView, noListView, signinErrorView } from '../lib/view.mjs';
import { build } from '../lib/dom.mjs';
import { fakeDoc, find, textOf, verdict } from './lib/fakes.mjs';

const pr = { owner: 'octo', repo: 'demo', number: 7, title: 't', url: 'https://github.com/octo/demo/pull/7', changed_files: 1 };
const VIEWS = {
  'a PR page': () => prView(verdict(), pr),
  home: () => homeView(),
  'the precomputed list': () => precomputedView({ prs: [{ number: 1, title: 'a', result: verdict() }] }, 'octo', 'demo'),
  'the rate-limit page': () => rateLimitView('/octo/demo/pull/7'),
  'an error page': () => errorView('x'),
  'the not-found page': () => notFoundView(),
  'the no-list page': () => noListView('octo', 'demo'),
  'the sign-in error': () => signinErrorView('The sign-in did not match this tab.', '/'),
};
const tree = (view) => { const { doc } = fakeDoc(); return build(view(), doc); };
const classes = (e) => String(e.attrs.class ?? '').split(/\s+/).filter(Boolean);
const notices = (root) => find(root, (e) => e.tag === 'p' && classes(e).includes('not-released')).map((e) => classes(e).find((c) => c.startsWith('not-released-')).slice('not-released-'.length));
function flip(t, surface) {
  RELEASED[surface] = true;
  t.after(() => { RELEASED[surface] = false; });
}

test('every surface is unreleased today', () => {
  assert.deepEqual(RELEASED, { cli: false, action: false, app: false, plugin: false });
  assert.equal(FOLLOW, 'https://github.com/mgillr/truedone');
});

for (const [name, view] of Object.entries(VIEWS)) {
  test(`${name}: the command and the plugin line each say Not released yet with the follow link`, () => {
    const root = tree(view);
    const n = notices(root);
    assert.ok(n.includes('cli') && n.includes('plugin'), `${name}: ${n}`);
    for (const p of find(root, (e) => e.tag === 'p' && classes(e).includes('not-released'))) {
      assert.match(textOf(p).replace(/\n/g, ''), /^Not released yet: follow the first release\.$/);
      assert.equal(find(p, (e) => e.tag === 'a')[0].attrs.href, FOLLOW);
    }
    // the cli notice follows the command, the plugin notice the plugin line
    const [section] = find(root, (e) => e.tag === 'section' && classes(e).includes('next'));
    const kinds = section.children.map((c) => (c.tag === 'pre' ? 'command' : classes(c).includes('not-released') ? notices(c)[0] : /plugin/.test(c.textContent ?? '') ? 'plugin line' : classes(c).includes('warning') ? 'warning' : c.tag));
    assert.deepEqual(kinds.slice(-5), ['command', 'cli', 'warning', 'plugin line', 'plugin'], 'the red-green warning stays');
  });
}

test('the step: PR pages and home say Not released yet after the green line', () => {
  for (const view of [VIEWS['a PR page'], VIEWS.home]) {
    const root = tree(view);
    const p = find(root, (e) => e.tag === 'p' && (classes(e).includes('green-line') || classes(e).includes('not-released-action')));
    assert.deepEqual(p.map((e) => (classes(e).includes('green-line') ? 'green line' : 'action')), ['green line', 'action']);
  }
});

for (const surface of ['cli', 'plugin', 'action']) {
  test(`flipping ${surface} in the release state removes its notice and no other`, (t) => {
    const before = notices(tree(VIEWS['a PR page']));
    flip(t, surface);
    const after = notices(tree(VIEWS['a PR page']));
    assert.deepEqual(after, before.filter((s) => s !== surface));
  });
}

test('/why says the four are not released, in one line, exactly while all four are false', () => {
  const html = fs.readFileSync(new URL('../why.html', import.meta.url), 'utf8');
  const line = /<p class="not-released">The command line, the action, the App and the plugin are not released yet: <a href="https:\/\/github\.com\/mgillr\/truedone">follow the first release<\/a>\.<\/p>/;
  assert.equal(line.test(html), Object.values(RELEASED).every((v) => !v), 'update /why when a surface is released');
  assert.match(html, /add the truedone step \(not released yet\)/);
});
