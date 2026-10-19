// CORE-14-AC02 (D24): npx truedone <PR> reads the head content of a pull request from a forked repository in the base
// repository, at the head sha, so a head repository that is deleted or private no longer makes every added test read
// as removed. The answers are sindresorhus/ky#871's, recorded on 2026-10-19 with gh api (fixtures/ky-871: the pull
// request, its file page, the compare answer, and test/hooks.ts at the merge base b101251 in the base repository, at the
// head 1da35ba in the base repository, and the 14-byte 404 that the head repository mahirhir/ky, now private, answers
// for it). GitHub lists that pull request as source/core/Ky.ts +37 -2 and test/hooks.ts +59 -0. Read in the head
// repository, the head is missing, every test in test/hooks.ts reads as removed and the verdict is tampered; read in the
// base repository, no test is removed. A head file the base repository cannot serve ends the run with exit 3, no verdict
// and an error naming the file and GitHub's answer, never a removed test. main() runs in-process with core's real
// analyse and classify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.mjs';
import { analyse, classify } from '../../core/core.mjs';

const DIR = fileURLToPath(new URL('./fixtures/ky-871/', import.meta.url));
const recorded = JSON.parse(fs.readFileSync(DIR + 'index.json', 'utf8'));
const MERGE_BASE = 'b1012515602768026ae6f27adb76b7bc657764e1';
const HEAD = '1da35ba2a08038025b4245a83d812b368bbcad97';
const HEAD_FILE = `https://raw.githubusercontent.com/sindresorhus/ky/${HEAD}/test/hooks.ts`;
const NOT_FOUND = fs.readFileSync(DIR + 'raw/03.txt', 'utf8');   // the head repository's recorded answer
const PR = 'https://github.com/sindresorhus/ky/pull/871';

function sink() { const s = { text: '', write: (x) => { s.text += x; return true; } }; return s; }
// GitHub as recorded: api.github.com and raw.githubusercontent.com answer from the index, anything else is a 404;
// override answers a full URL first
function recordedFetch(override = {}) {
  const log = [];
  const fetch = async (url, init = {}) => {
    log.push({ url, headers: { ...(init.headers ?? {}) } });
    if (override[url]) return new Response(override[url].body, { status: override[url].status });
    const u = new URL(url);
    const table = u.host === 'api.github.com' ? recorded.api : u.host === 'raw.githubusercontent.com' ? recorded.raw : null;
    const hit = table?.[u.pathname + u.search];
    if (!hit) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(fs.readFileSync(DIR + hit.file, 'utf8'), { status: hit.status });
  };
  const raw = () => log.map((r) => new URL(r.url)).filter((u) => u.host === 'raw.githubusercontent.com').map((u) => u.pathname);
  return { fetch, log, raw };
}
async function run(argv, fetch) {
  const stdout = sink(), stderr = sink();
  const git = () => { throw new Error('PR mode ran git'); };
  const code = await main(argv, { analyse, classify, fetch, git, cwd: os.tmpdir(), env: { PATH: process.env.PATH, HOME: os.tmpdir() }, stdout, stderr });
  return { code, out: stdout.text, err: stderr.text };
}

test('npx truedone on ky#871 reads the head in the base repository: no test is removed, and the verdict is not tampered', async () => {
  const f = recordedFetch();
  const r = await run([PR, '--json'], f.fetch);
  assert.equal(r.code, 0, r.err);
  const v = JSON.parse(r.out);
  assert.deepEqual(v.reasons.filter((x) => x.check === 'deleted').map((x) => x.message), [], 'no test reads as removed');
  assert.notEqual(v.verdict, 'tampered');
  assert.equal(v.verdict, 'unrun', 'added tests with no run: Tests changed: not run');
  assert.deepEqual(f.raw().sort(), [`/sindresorhus/ky/${HEAD}/test/hooks.ts`, `/sindresorhus/ky/${MERGE_BASE}/test/hooks.ts`]);
  assert.deepEqual(f.raw().filter((p) => p.startsWith('/mahirhir/')), [], 'nothing is read in the head repository');
});

test('npx truedone report on ky#871 names the head commit and a verdict that is not tampered', async () => {
  const r = await run(['report', PR], recordedFetch().fetch);
  assert.equal(r.code, 0, r.err);
  const link = new URL(r.out.trim().split('\n').pop());
  assert.equal(link.searchParams.get('head'), HEAD);
  assert.equal(link.searchParams.get('base'), MERGE_BASE);
  assert.equal(link.searchParams.get('verdict'), 'unrun');
});

test('a head file the base repository cannot serve ends the run with that error and no verdict, never a removed test', async () => {
  const f = recordedFetch({ [HEAD_FILE]: { status: 404, body: NOT_FOUND } });
  const r = await run([PR, '--json'], f.fetch);
  assert.equal(r.code, 3, 'no verdict');
  assert.equal(r.out, '');
  assert.equal(r.err, 'truedone: the head of test/hooks.ts could not be read: GitHub answered 404\n');
  assert.doesNotMatch(r.err, /has no pull request/, 'the pull request itself was read');
});
