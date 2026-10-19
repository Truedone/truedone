// CORE-14-AC01 (D24): the site reads the head content of a pull request from a forked repository in the base repository,
// at the head sha, so a head repository that is deleted or private no longer makes every added test read as removed. The
// answers are sindresorhus/ky#871's, recorded on 2026-10-19 with gh api (fixtures/ky-871: the pull request, its file
// page, the compare answer, and test/hooks.ts at the merge base b101251 in the base repository, at the head 1da35ba in
// the base repository, and the 14-byte 404 that the head repository mahirhir/ky, now private, answers for it). GitHub
// lists that pull request as source/core/Ky.ts +37 -2 and test/hooks.ts +59 -0. Read in the head repository, the head
// is missing, every test in test/hooks.ts reads as removed and the verdict is tampered; read in the base repository, no
// test is removed. A head file the base repository cannot serve is an error the page states, never a removed test: the
// error carries the path in its own property, never in its message, which the App logs (S8). The site's own bundled core
// gives the verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { page } from '../lib/page.mjs';
import { loadPR, GitHubError } from '../lib/github.mjs';
import { analyse, classify } from '../core.mjs';
import { fakeDoc, find, textOf } from './lib/fakes.mjs';

const DIR = fileURLToPath(new URL('./fixtures/ky-871/', import.meta.url));
const recorded = JSON.parse(fs.readFileSync(DIR + 'index.json', 'utf8'));
const MERGE_BASE = 'b1012515602768026ae6f27adb76b7bc657764e1';
const HEAD = '1da35ba2a08038025b4245a83d812b368bbcad97';
const HEAD_FILE = `https://raw.githubusercontent.com/sindresorhus/ky/${HEAD}/test/hooks.ts`;
const NOT_FOUND = fs.readFileSync(DIR + 'raw/003.txt', 'utf8');   // the head repository's recorded answer

// GitHub as recorded: api.github.com and raw.githubusercontent.com answer from the index, anything else is a 404;
// override answers a full URL first
function recordedFetch(override = {}) {
  const log = [];
  const answer = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => JSON.parse(body), text: async () => body });
  const fetch = async (url, init = {}) => {
    log.push({ url, headers: { ...(init.headers ?? {}) } });
    if (override[url]) return answer(override[url].status, override[url].body ?? '');
    const u = new URL(url);
    const table = u.host === 'api.github.com' ? recorded.api : u.host === 'raw.githubusercontent.com' ? recorded.raw : null;
    const hit = table?.[u.pathname + u.search];
    return hit ? answer(hit.status, fs.readFileSync(DIR + hit.file, 'utf8')) : answer(404, '{"message":"Not Found"}');
  };
  const raw = () => log.map((r) => new URL(r.url)).filter((u) => u.host === 'raw.githubusercontent.com').map((u) => u.pathname);
  return { fetch, log, raw };
}
const target = { owner: 'sindresorhus', repo: 'ky', number: 871 };

test('ky#871 read in the base repository: no test is removed, and the verdict is not tampered', async () => {
  const f = recordedFetch();
  const got = await loadPR(target, { fetch: f.fetch, classify });
  const result = analyse(got.input);
  assert.deepEqual(result.reasons.filter((r) => r.check === 'deleted').map((r) => r.message), [], 'no test reads as removed');
  assert.notEqual(result.verdict, 'tampered');
  assert.equal(result.verdict, 'unrun', 'added tests with no run: Tests changed: not run');
  assert.deepEqual(f.raw().sort(), [`/sindresorhus/ky/${HEAD}/test/hooks.ts`, `/sindresorhus/ky/${MERGE_BASE}/test/hooks.ts`]);
  assert.deepEqual(f.raw().filter((p) => p.startsWith('/mahirhir/')), [], 'nothing is read in the head repository');
  assert.equal(Buffer.byteLength(got.input.files.find((x) => x.path === 'test/hooks.ts').head), 120436, 'the head as the base repository serves it');
});

test('the page for ky#871 shows a verdict that is not tampered, at the head commit', async () => {
  const f = recordedFetch();
  const { doc, root } = fakeDoc();
  await page({ pathname: recorded.pr }, { fetch: f.fetch, doc, root, analyse, classify });
  assert.doesNotMatch(textOf(root), /Verdict:\s*Tampered/);
  const report = find(root, (e) => e.tag === 'a' && /\/issues\/new\?/.test(e.attrs?.href ?? ''));
  assert.equal(report.length, 1, 'one wrong-verdict link');
  const q = new URL(report[0].attrs.href).searchParams;
  assert.equal(q.get('head'), HEAD);
  assert.equal(q.get('verdict'), 'unrun');
});

test('a head file the base repository cannot serve is an error the page states, never a removed test', async () => {
  const f = recordedFetch({ [HEAD_FILE]: { status: 404, body: NOT_FOUND } });
  const e = await loadPR(target, { fetch: f.fetch, classify }).then(() => null, (x) => x);
  assert.ok(e instanceof GitHubError, 'the read throws');
  assert.equal(e.path, 'test/hooks.ts');
  assert.equal(e.answer, 404);
  assert.doesNotMatch(e.message, /hooks\.ts/, 'the message holds no path');
  const { doc, root } = fakeDoc();
  await page({ pathname: recorded.pr }, { fetch: recordedFetch({ [HEAD_FILE]: { status: 404, body: NOT_FOUND } }).fetch, doc, root, analyse, classify });
  const text = textOf(root);
  assert.match(text, /This page could not be shown/);
  assert.match(text, /The head of test\/hooks\.ts could not be read: GitHub answered 404\./);
  assert.doesNotMatch(text, /Verdict:/, 'no verdict is shown');
});
