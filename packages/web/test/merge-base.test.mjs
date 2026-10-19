// CORE-12-AC01 (D24): the site reads a changed file's base content at the pull request's merge base, named by one
// compare call in the base repository, so a test the base branch gained after the pull request branched is not called
// removed. The answers are sindresorhus/ky#883's, recorded on 2026-10-19 with gh api (fixtures/ky-883: the pull
// request, its file page, the compare answer, and test/hooks.ts and test/main.ts at the base branch's tip c2ac4a1, the
// merge base d27ad21 and the head 045fdd7). GitHub lists that pull request as test/hooks.ts +33 -0 and test/main.ts
// +52 -0. Read at the tip, nine tests the base branch gained later read as removed and the verdict is tampered; read at
// the merge base, no test is removed. The site's own bundled core gives the verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { page } from '../lib/page.mjs';
import { loadPR, GitHubError } from '../lib/github.mjs';
import { analyse, classify } from '../core.mjs';
import { fakeDoc, find } from './lib/fakes.mjs';

const DIR = fileURLToPath(new URL('./fixtures/ky-883/', import.meta.url));
const recorded = JSON.parse(fs.readFileSync(DIR + 'index.json', 'utf8'));
const TIP = 'c2ac4a1ac858cd8b423756c6c686b64071e834eb';
const MERGE_BASE = 'd27ad21266d162ee218d4ea69dce192b84b6f967';
const HEAD = '045fdd745bf8ce5111fa48309057da5cab2876cc';
const COMPARE = `https://api.github.com/repos/sindresorhus/ky/compare/${TIP}...${HEAD}`;

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
const target = { owner: 'sindresorhus', repo: 'ky', number: 883 };

test('ky#883 read at its merge base: no test is removed, and the verdict is not tampered', async () => {
  const f = recordedFetch();
  const got = await loadPR(target, { fetch: f.fetch, classify });
  const result = analyse(got.input);
  assert.deepEqual(result.reasons.filter((r) => r.check === 'deleted').map((r) => r.message), [], 'no test reads as removed');
  assert.notEqual(result.verdict, 'tampered');
  assert.equal(result.verdict, 'unrun', 'added tests with no run: Tests changed: not run');
  assert.deepEqual(f.raw().filter((p) => !p.includes(`/${HEAD}/`)).sort(), [`/sindresorhus/ky/${MERGE_BASE}/test/hooks.ts`, `/sindresorhus/ky/${MERGE_BASE}/test/main.ts`]);
  assert.equal(got.pr.base, MERGE_BASE);
});

test('the merge base is read with one compare call in the base repository, and the page names it as the base', async () => {
  const f = recordedFetch();
  const { doc, root } = fakeDoc();
  const r = await page({ pathname: recorded.pr }, { fetch: f.fetch, doc, root, analyse, classify });
  assert.deepEqual(f.log.filter((x) => x.url.includes('/compare/')).map((x) => x.url), [COMPARE]);
  assert.equal(r.calls, 3, 'the pull request, its one file page and the compare call');
  const report = find(root, (e) => e.tag === 'a' && /\/issues\/new\?/.test(e.attrs?.href ?? ''));
  assert.equal(report.length, 1, 'one wrong-verdict link');
  const q = new URL(report[0].attrs.href).searchParams;
  assert.equal(q.get('base'), MERGE_BASE);
  assert.equal(q.get('head'), HEAD);
  assert.notEqual(q.get('verdict'), 'tampered');
});

test('a compare call that fails throws, and nothing is read at the base branch tip instead', async () => {
  for (const bad of [{ status: 500, body: '{"message":"Server Error"}' }, { status: 200, body: '{"status":"diverged"}' }]) {
    const f = recordedFetch({ [COMPARE]: bad });
    await assert.rejects(loadPR(target, { fetch: f.fetch, classify }), GitHubError);
    assert.deepEqual(f.raw().filter((p) => p.includes(`/${TIP}/`)), [], `no read at the tip after ${bad.status}`);
  }
});
