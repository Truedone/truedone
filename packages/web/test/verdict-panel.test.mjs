// WEB-07-AC02 (issues #55, #57, #60, #62): the PR page's verdict panel. The verdict is a link to its section of /why
// whose text is the name alone, so a line holds one colon at most; "Verdict: " stays as a visually hidden label for
// screen readers and the tools that read the page. The label line says the app would set the label, since GitHub
// carries none from this site. A reason whose message names its file is not prefixed with it, and reasons whose own
// verdict is not the result's come after the others under "Also noted".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prView } from '../lib/view.mjs';
import { build } from '../lib/dom.mjs';
import { fakeDoc, find, textOf, verdict } from './lib/fakes.mjs';

const pr = { owner: 'octo', repo: 'demo', number: 7, title: 't', url: 'https://github.com/octo/demo/pull/7', changed_files: 2 };
const tampered = verdict({
  verdict: 'tampered', label: 'truedone:tampered',
  reasons: [
    { check: 'weakened', file: 'test/add.test.js', message: 'Test adds has a weaker assertion on head.', verdict: 'tampered' },
    { check: 'unrun', file: 'test/add.test.js', message: 'Tests in test/add.test.js changed and have not been run.', verdict: 'unrun' },
  ],
});
const panel = (result) => { const { doc } = fakeDoc(); return build(prView(result, pr), doc); };
const classes = (e) => String(e.attrs.class ?? '').split(/\s+/);

test('the verdict is a link to its section of /why, with the name alone', () => {
  for (const [v, label, href, name] of [
    ['tampered', 'truedone:tampered', '/why#truedone-tampered', 'Tampered'],
    ['unrun', 'truedone:unrun', '/why#truedone-unrun', 'Tests changed: not run'],
    ['no_evidence', 'truedone:no-evidence', '/why#truedone-no-evidence', 'No red-green evidence'],
    ['not_applicable', null, '/why', 'Not applicable'],
  ]) {
    const tree = panel(verdict({ verdict: v, label }));
    const [a] = find(tree, (e) => e.tag === 'a' && classes(e).includes('verdict'));
    assert.ok(a, v);
    assert.equal(a.attrs.href, href, v);
    assert.equal(a.textContent, name, v);
    assert.ok((a.textContent.match(/:/g) || []).length <= 1, `${v}: one colon at most`);
    const [hidden] = find(tree, (e) => classes(e).includes('visually-hidden'));
    assert.equal(hidden?.textContent, 'Verdict: ', `${v}: the hidden label`);
  }
});

test('the label line says the app would set it, and Not applicable has none', () => {
  assert.match(textOf(panel(tampered)), /^Label the app would set: truedone:tampered$/m);
  assert.doesNotMatch(textOf(panel(tampered)), /^Label: /m);
  assert.doesNotMatch(textOf(panel(verdict({ verdict: 'not_applicable', label: null }))), /Label/);
});

test('a reason whose message names its file is not prefixed; one that does not is', () => {
  const tree = panel(verdict({ verdict: 'review', label: 'truedone:review', reasons: [
    { check: 'snapshot', file: 'test/__snapshots__/a.snap', message: 'Snapshot test/__snapshots__/a.snap changed.', verdict: 'review' },
    { check: 'skip_focus', file: 'src/a.test.js', line: 3, message: 'a test is skipped', verdict: 'review' },
  ] }));
  const items = find(tree, (e) => e.tag === 'li').map((e) => e.textContent);
  assert.deepEqual(items, ['Snapshot test/__snapshots__/a.snap changed.', 'src/a.test.js:3: a test is skipped']);
});

test('a reason whose own verdict is lesser comes last, under Also noted', () => {
  const tree = panel(tampered);
  const lists = find(tree, (e) => e.tag === 'ul' && classes(e).includes('reasons'));
  assert.equal(lists.length, 2);
  assert.deepEqual(lists[0].children.map((e) => e.textContent), ['test/add.test.js: Test adds has a weaker assertion on head.']);
  assert.deepEqual(lists[1].children.map((e) => e.textContent), ['Tests in test/add.test.js changed and have not been run.']);
  const text = textOf(tree);
  assert.ok(text.indexOf('weaker assertion') < text.indexOf('Also noted') && text.indexOf('Also noted') < text.indexOf('have not been run'));
  // all reasons at the verdict's own level: no Also noted
  assert.doesNotMatch(textOf(panel(verdict({ reasons: [{ check: 'unrun', file: 'a.test.js', message: 'Tests in a.test.js changed and have not been run.', verdict: 'unrun' }] }))), /Also noted/);
});
