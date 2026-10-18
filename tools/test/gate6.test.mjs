// GATE-06: tools/gate6.mjs reads the watch list, keeps the feed entries since the last check that mention red-green,
// fail on base, test tamper, a weakened test or a skipped test, and writes the research file with their links. The
// feeds come from the fixtures under tools/test/fixtures/gate6/ through a stand-in fetch, so no test touches the
// network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSources, readFeed, matches, research, main } from '../gate6.mjs';

const fx = (f) => fs.readFileSync(new URL(`fixtures/gate6/${f}`, import.meta.url), 'utf8');
const FEEDS = {
  'https://feeds.example/changelog.rss': 'changelog.rss',
  'https://feeds.example/tool/releases.atom': 'releases.atom',
  'https://feeds.example/tool/commits.atom': 'commits.atom',
};
function stand(asked = []) {
  return async (url) => {
    asked.push(url);
    if (!(url in FEEDS)) return new Response('not found', { status: 404 });
    return new Response(fx(FEEDS[url]), { status: 200 });
  };
}
const since = new Date('2026-10-10T00:00:00Z');
const now = new Date('2026-10-18T00:00:00Z');

test('the sources table gives each row its feeds, and a row without one is marked', () => {
  const s = readSources(fx('sources.md'));
  assert.deepEqual(s.map((r) => [r.name, r.feeds.length, r.none]), [['Example changelog', 1, false], ['Example tool', 2, false], ['Quiet vendor', 0, true], ['Broken feed', 1, false]]);
});

test('RSS items and Atom entries give a title, a link and a date', () => {
  const rss = readFeed(fx('changelog.rss'));
  assert.deepEqual([rss[0].title, rss[0].link, rss[0].date.toISOString()], ['Code review now runs a red-green check on new tests', 'https://example.com/changelog/red-green', '2026-10-15T10:00:00.000Z']);
  const atom = readFeed(fx('releases.atom'));
  assert.deepEqual([atom[0].title, atom[0].link, atom[0].date.toISOString()], ['v2.0.0', 'https://example.com/tool/releases/v2.0.0', '2026-10-16T09:00:00.000Z']);
});

test('each watch term matches its phrase, and near misses do not', () => {
  const m = (title) => matches({ title, text: '' });
  assert.deepEqual(m('Runs a red-green check'), ['red-green']);
  assert.deepEqual(m('Flags a test that fails on the merge base'), ['fail on base']);
  assert.deepEqual(m('Detects test tampering'), ['test tamper']);
  assert.deepEqual(m('Blocks a change that weakens assertions'), ['weakened test']);
  assert.deepEqual(m('Counts skipped tests'), ['skipped test']);
  for (const t of ['Docs: red, green and blue themes', 'Faster runners', 'Skip to content', 'Weakened the cache']) assert.deepEqual(m(t), [], t);
});

test('the research keeps only matching entries since the last check, newest first, with their links', async () => {
  const asked = [];
  const { text, found } = await research({ release: 'w2', sources: readSources(fx('sources.md')), since, now, fetch: stand(asked) });
  assert.equal(found, 4);
  assert.match(text, /^Checked: 2026-10-18, for entries since 2026-10-10\.$/m);
  const tool = text.split('## Example tool')[1].split('## ')[0];
  assert.ok(tool.indexOf('v2.0.0') < tool.indexOf('Flag skipped tests'), 'newest first');
  assert.match(text, /- 2026-10-15 \[Code review now runs a red-green check on new tests\]\(https:\/\/example\.com\/changelog\/red-green\): red-green/);
  assert.match(text, /- 2026-10-13 \[Review comments\]\(https:\/\/example\.com\/changelog\/comments\): fail on base/);
  assert.match(text, /- 2026-10-16 \[v2\.0\.0\]\(https:\/\/example\.com\/tool\/releases\/v2\.0\.0\): weakened test/);
  assert.match(text, /- 2026-10-11 \[Flag skipped tests in Python files\]\(https:\/\/example\.com\/tool\/commit\/abc\): skipped test/);
  for (const gone of ['Faster runners', 'An old red-green note', 'red, green and blue', 'v1.9.0']) assert.ok(!text.includes(gone), gone);
  assert.deepEqual(asked.sort(), [...Object.keys(FEEDS), 'https://feeds.example/missing.rss'].sort());
});

test('a source with no changelog is said to have none, a feed that fails is reported, and no Window line is written', async () => {
  const { text } = await research({ release: 'w2', sources: readSources(fx('sources.md')), since, now, fetch: stand() });
  assert.match(text.split('## Quiet vendor')[1], /^\s*Ryan may add one\.\s+No public changelog found\./);
  const broken = text.split('## Broken feed')[1];
  assert.match(broken, /- Could not read https:\/\/feeds\.example\/missing\.rss: HTTP 404/);
  assert.ok(!broken.includes('Nothing matched'), 'an unread feed is not reported as quiet');
  assert.doesNotMatch(text, /^Window:/m);
});

test('a feed whose oldest entry is after the cut says how far back it reaches, and one that reaches back does not', async () => {
  const { text } = await research({ release: 'w2', sources: readSources(fx('sources.md')), since, now, fetch: stand() });
  assert.match(text, /- https:\/\/feeds\.example\/tool\/releases\.atom reaches back only to 2026-10-12; earlier entries are not covered\./);
  assert.match(text, /- https:\/\/feeds\.example\/tool\/commits\.atom reaches back only to 2026-10-11; earlier entries are not covered\./);
  assert.ok(!text.includes('changelog.rss reaches back'), 'the changelog fixture reaches back to 2026-09-21');
});

test('the command reads the last Checked date of an earlier research file and writes docs/gates/gate6-<release>-research.md', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate6-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs/gates'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/gates/gate6-sources.md'), fx('sources.md'));
  fs.writeFileSync(path.join(root, 'docs/gates/gate6-w1-research.md'), '# Gate 6 research for w1\n\nChecked: 2026-10-14, for entries since 2026-09-01.\n');
  assert.equal(await main(['w2'], { root, fetch: stand(), now }), 0);
  const out = fs.readFileSync(path.join(root, 'docs/gates/gate6-w2-research.md'), 'utf8');
  assert.match(out, /for entries since 2026-10-14\./);
  assert.ok(out.includes('v2.0.0') && out.includes('red-green check') && !out.includes('Review comments'), 'only entries after 2026-10-14');
  assert.equal(await main([], { root, fetch: stand(), now }), 2);
  assert.equal(await main(['../x'], { root, fetch: stand(), now }), 2);
});
