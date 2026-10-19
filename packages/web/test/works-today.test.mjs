// WEB-12-AC02 (#92): home lists what works today: this site checks any public pull request now, and the surfaces
// lib/release.mjs still holds false come with the first release, with the link to follow it. A surface that flips
// moves to "now".
// REL-P4 (D35): the walk released the command line, the App and the plugin. The tests of the unreleased state set every
// surface false for themselves and put the release state back after; the committed state lists those three as released
// now and the action as coming with the first release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELEASED, FOLLOW } from '../lib/release.mjs';
import { homeView } from '../lib/view.mjs';
import { build } from '../lib/dom.mjs';
import { fakeDoc, find, textOf } from './lib/fakes.mjs';

const NONE = { cli: false, action: false, app: false, plugin: false };
// sets the release state for one test, and puts back what it was after the test
function state(t, values) {
  const was = { ...RELEASED };
  Object.assign(RELEASED, values);
  t.after(() => { Object.assign(RELEASED, was); });
}
const classes = (e) => String(e.attrs.class ?? '').split(/\s+/).filter(Boolean);
function list() {
  const { doc } = fakeDoc();
  const main = build(homeView(), doc);
  const i = main.children.findIndex((c) => c.tag === 'h2' && c.textContent === 'What works today');
  assert.ok(i >= 0, 'a What works today heading');
  const ul = main.children[i + 1];
  assert.ok(classes(ul).includes('works-today'));
  return ul.children.map((li) => ({ text: textOf(li).replace(/\n/g, ''), href: find(li, (e) => e.tag === 'a')[0]?.attrs.href ?? null }));
}

test('home lists this site as working now and the four surfaces as coming with the first release', (t) => {
  state(t, NONE);
  assert.deepEqual(list(), [
    { text: 'This site checks any public pull request now.', href: null },
    { text: 'The command line (npx truedone), the GitHub Action, the GitHub App and the Claude Code plugin come with the first release: follow it on GitHub.', href: FOLLOW },
  ]);
});

test('a released surface moves to now; with all four released, nothing is left to come', (t) => {
  state(t, NONE);
  RELEASED.app = true;
  assert.deepEqual(list().map((x) => x.text), [
    'This site checks any public pull request now, and the GitHub App is released.',
    'The command line (npx truedone), the GitHub Action and the Claude Code plugin come with the first release: follow it on GitHub.',
  ]);
  for (const k of Object.keys(RELEASED)) RELEASED[k] = true;
  assert.deepEqual(list().map((x) => x.text), ['This site checks any public pull request now, and the command line (npx truedone), the GitHub Action, the GitHub App and the Claude Code plugin are released.']);
});

test('as released: home lists the command line, the App and the plugin as released now, and the action as coming', () => {
  assert.deepEqual(list(), [
    { text: 'This site checks any public pull request now, and the command line (npx truedone), the GitHub App and the Claude Code plugin are released.', href: null },
    { text: 'The GitHub Action comes with the first release: follow it on GitHub.', href: FOLLOW },
  ]);
});
