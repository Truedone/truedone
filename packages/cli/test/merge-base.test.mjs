// CORE-12-AC02 (D24): npx truedone <PR> reads a changed file's base content at the pull request's merge base, named by
// one compare call in the base repository, so a test the base branch gained after the pull request branched is not
// called removed. The answers are sindresorhus/ky#883's, recorded on 2026-10-19 with gh api (fixtures/ky-883: the pull
// request, its file page, the compare answer, and test/hooks.ts and test/main.ts at the base branch's tip c2ac4a1, the
// merge base d27ad21 and the head 045fdd7). GitHub lists that pull request as test/hooks.ts +33 -0 and test/main.ts
// +52 -0. Read at the tip, nine tests the base branch gained later read as removed and the verdict is tampered; read at
// the merge base, no test is removed. main() runs in-process with core's real analyse and classify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.mjs';
import { analyse, classify } from '../../core/core.mjs';

const DIR = fileURLToPath(new URL('./fixtures/ky-883/', import.meta.url));
const recorded = JSON.parse(fs.readFileSync(DIR + 'index.json', 'utf8'));
const TIP = 'c2ac4a1ac858cd8b423756c6c686b64071e834eb';
const MERGE_BASE = 'd27ad21266d162ee218d4ea69dce192b84b6f967';
const HEAD = '045fdd745bf8ce5111fa48309057da5cab2876cc';
const COMPARE = `https://api.github.com/repos/sindresorhus/ky/compare/${TIP}...${HEAD}`;
const PR = 'https://github.com/sindresorhus/ky/pull/883';

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

test('npx truedone on ky#883 reads base at the merge base: no test is removed, and the verdict is not tampered', async () => {
  const f = recordedFetch();
  const r = await run([PR, '--json'], f.fetch);
  assert.equal(r.code, 0, r.err);
  const v = JSON.parse(r.out);
  assert.deepEqual(v.reasons.filter((x) => x.check === 'deleted').map((x) => x.message), [], 'no test reads as removed');
  assert.notEqual(v.verdict, 'tampered');
  assert.equal(v.verdict, 'unrun', 'added tests with no run: Tests changed: not run');
  assert.deepEqual(f.raw().filter((p) => !p.includes(`/${HEAD}/`)).sort(), [`/sindresorhus/ky/${MERGE_BASE}/test/hooks.ts`, `/sindresorhus/ky/${MERGE_BASE}/test/main.ts`]);
  assert.deepEqual(f.log.filter((x) => x.url.includes('/compare/')).map((x) => x.url), [COMPARE], 'one compare call, in the base repository');
});

test('npx truedone report names the merge base as the base commit', async () => {
  const r = await run(['report', PR], recordedFetch().fetch);
  assert.equal(r.code, 0, r.err);
  const link = new URL(r.out.trim().split('\n').pop());
  assert.equal(link.searchParams.get('base'), MERGE_BASE);
  assert.equal(link.searchParams.get('head'), HEAD);
  assert.notEqual(link.searchParams.get('verdict'), 'tampered');
});

test('a compare call that fails ends the run with an error, and nothing is read at the base branch tip instead', async () => {
  for (const bad of [{ status: 500, body: '{"message":"Server Error"}' }, { status: 200, body: '{"status":"diverged"}' }]) {
    const f = recordedFetch({ [COMPARE]: bad });
    const r = await run([PR, '--json'], f.fetch);
    assert.notEqual(r.code, 0, `no verdict after ${bad.status}`);
    assert.equal(r.out, '');
    assert.deepEqual(f.raw().filter((p) => p.includes(`/${TIP}/`)), [], `no read at the tip after ${bad.status}`);
  }
});
