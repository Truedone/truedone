// WEB-01-AC01 (PV-W01, PV-W04): a PR page renders its verdict from recorded GitHub responses, with at most 4
// api.github.com calls for a PR of 300 files. Contents come from raw.githubusercontent.com, for the files core
// classifies as test, setup, config or workflow only, and PR text reaches the page through textContent only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from '../lib/page.mjs';
import { loadPR } from '../lib/github.mjs';
import { prView } from '../lib/view.mjs';
import { fakeFetch, fakeDoc, textOf, find, classify, verdict, recorded } from './lib/fakes.mjs';

const loc = { pathname: recorded.pr };

test('a PR of 300 files takes 4 api.github.com calls and renders the verdict core returns', async () => {
  const f = fakeFetch();
  const { doc, root } = fakeDoc();
  let input;
  const analyse = (i) => { input = i; return verdict({ verdict: 'no_evidence', label: 'truedone:no-evidence', reasons: [{ check: 'source_no_test', file: 'src/mod001.js', message: 'source changed and no test fails without it' }] }); };
  const r = await page(loc, { fetch: f.fetch, doc, root, analyse, classify });
  assert.equal(f.count('api.github.com'), 4);
  assert.ok(f.count('api.github.com') <= 4);
  assert.equal(r.calls, 4);
  assert.equal(input.files.length, 300);
  const text = textOf(root);
  assert.match(text, /Verdict:\s*No red-green evidence/);   // the visually hidden label, then the badge (WEB-07)
  assert.match(text, /src\/mod001\.js: source changed and no test fails without it/);
  assert.match(text, /octo\/demo#7/);
});

test('contents are fetched for test, workflow and runner-config files only, base and head as their status allows', async () => {
  const f = fakeFetch();
  const got = await loadPR({ owner: 'octo', repo: 'demo', number: 7 }, { fetch: f.fetch, classify });
  const raw = f.log.filter((x) => new URL(x.url).host === 'raw.githubusercontent.com').map((x) => new URL(x.url).pathname);
  assert.equal(raw.length, Object.keys(recorded.raw).length);
  assert.ok(raw.every((p) => !/\/src\//.test(p)), 'no source file contents');
  const by = Object.fromEntries(got.input.files.map((x) => [x.path, x]));
  assert.equal(by['test/mod000.test.js'].base, undefined, 'an added file has no base');
  assert.match(by['test/mod000.test.js'].head, /head of test\/mod000\.test\.js/);
  assert.match(by['test/mod005.test.js'].base, /base of/);
  assert.equal(by['test/old.test.js'].head, undefined, 'a removed file has no head');
  assert.match(by['.github/workflows/ci.yml'].head, /head of \.github\/workflows\/ci\.yml/);
  assert.equal(by['src/mod000.js'].head, undefined);
  assert.equal(typeof by['src/mod000.js'].patch, 'string');
});

test('the head contents of a fork PR come from the fork, and base from the base repository', async () => {
  const f = fakeFetch();
  await loadPR({ owner: 'octo', repo: 'demo', number: 7 }, { fetch: f.fetch, classify });
  const raw = f.log.map((x) => new URL(x.url)).filter((u) => u.host === 'raw.githubusercontent.com');
  assert.ok(raw.some((u) => u.pathname.startsWith('/fork-owner/demo/' + 'c'.repeat(40))));
  assert.ok(raw.some((u) => u.pathname.startsWith('/octo/demo/' + 'b'.repeat(40))));
});

test('analyse gets the PR title, body and author as data', async () => {
  const f = fakeFetch();
  const got = await loadPR({ owner: 'octo', repo: 'demo', number: 7 }, { fetch: f.fetch, classify });
  assert.deepEqual(got.input.pr.author, { login: 'helper-agent[bot]', type: 'Bot' });
  assert.match(got.input.pr.title, /^Add retry/);
  assert.equal(got.input.pr.body, 'Adds tests for retry.');
});

test('a PR title holding markup is written as text and no element is made from it', async () => {
  const f = fakeFetch();
  const { doc, root, made } = fakeDoc();
  await page(loc, { fetch: f.fetch, doc, root, analyse: () => verdict(), classify });
  const title = find(root, (e) => e.attrs?.class === 'title')[0];
  assert.equal(title.textContent, 'Add retry <img src=x onerror=alert(1)> to the client');
  assert.equal(made.filter((e) => e.tag === 'img').length, 0);
});

test('only https and same-site links are written; any other href is dropped', async () => {
  const { build } = await import('../lib/dom.mjs');
  const { doc } = fakeDoc();
  const a = build({ tag: 'a', text: 'x', attrs: { href: 'javascript:alert(1)' } }, doc);
  const b = build({ tag: 'a', text: 'x', attrs: { href: '//evil.example/' } }, doc);
  const c = build({ tag: 'a', text: 'x', attrs: { href: 'https://github.com/octo/demo/pull/7' } }, doc);
  assert.deepEqual([a.attrs.href, b.attrs.href, c.attrs.href], [undefined, undefined, 'https://github.com/octo/demo/pull/7']);
});

test('a PR over the 300-file limit reads 3 pages and is shown as partial', async () => {
  const big = { title: 'big', body: '', user: { login: 'u', type: 'User' }, base: { sha: 'b'.repeat(40), repo: { full_name: 'octo/demo' } }, head: { sha: 'c'.repeat(40), repo: { full_name: 'octo/demo' } }, changed_files: 1200 };
  const f = fakeFetch({ 'https://api.github.com/repos/octo/demo/pulls/7': { status: 200, body: JSON.stringify(big) } });
  const { doc, root } = fakeDoc();
  await page(loc, { fetch: f.fetch, doc, root, analyse: () => verdict(), classify });
  assert.equal(f.count('api.github.com'), 4);
  assert.match(textOf(root), /\(partial\)/);
  assert.match(textOf(root), /Analysed 300 of the 1200 changed files/);
});

test('a reason with no file is its message alone, and one with a file and a line says where', () => {
  const pr = { owner: 'octo', repo: 'demo', number: 7, title: 't', url: 'https://github.com/octo/demo/pull/7', changed_files: 1 };
  const tree = prView(verdict({ reasons: [{ check: 'partial', file: '', message: 'Only part of the change was read.' }, { check: 'skip_focus', file: 'src/a.test.js', line: 3, message: 'a test is skipped' }] }), pr);
  const items = (function walk(n) { return [...(n.tag === 'li' ? [n.text] : []), ...(n.children || []).flatMap(walk)]; })(tree);
  assert.deepEqual(items, ['Only part of the change was read.', 'src/a.test.js:3: a test is skipped']);
});
