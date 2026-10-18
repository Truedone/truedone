#!/usr/bin/env node
// node tools/misses/snapshot.mjs <issue number> --out <dir> [--repo <owner/name>] (COLLECT-01, D39): one wrong-verdict
// report, kept for analysis. It reads the issue the form .github/ISSUE_TEMPLATE/wrong-verdict.yml filed, refuses a report
// without both 40-hex commits, and reads the public pull request at exactly those commits: the files the comparison of base
// and head changes (with their patches), the base and head text of each changed file and of the test and runner
// configuration in the directories above each changed test, the pull request's title, body and author (the core's claim and
// bot checks read them), and the check runs on the head. It writes one case directory, case.json plus base/ and head/
// trees, with the report's kind as the expected outcome and the verdict the current core gives at those commits. The case
// is for the private repository Truedone/truedone-misses: --out must lie outside this repository, so another project's code
// never enters it (docs/ops/misses.md). GitHub reads go through an injectable fetch; GITHUB_TOKEN is sent to api.github.com
// only when the environment has one, never to raw.githubusercontent.com.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse } from '../../packages/core/core.mjs';
import { classify } from '../../packages/core/src/classify.mjs';

export const SCHEMA = 'truedone.miss/1';
export const API = 'https://api.github.com';
export const RAW = 'https://raw.githubusercontent.com';
export const REPO = 'Truedone/truedone';
export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
// the form's choices, as the report records them, and the outcome each one expects
export const KINDS = {
  'a false alarm': 'false_alarm',
  'a missed tamper': 'missed_tamper',
  'missed evidence': 'missed_evidence',
  'the wrong class': 'wrong_class',
};
// the form's field labels, as GitHub renders an issue form's body (### <label>, a blank line, the value); the field ids
// (pr, head, base, verdict, reasons, kind, version, note) are what the site's, the command line's and the App's links fill
export const FIELDS = { pr: 'Pull request', head: 'Head commit', base: 'Base commit', verdict: 'Verdict shown', reasons: 'Reason codes', kind: 'What is wrong', version: 'truedone version', note: 'Note' };
const SHA = /^[0-9a-f]{40}$/;
const CONFIG = new Set(['runner_config', 'setup']);
const MANIFESTS = new Set(['package.json', 'pyproject.toml']);
const STATUS = { added: 'added', removed: 'removed', modified: 'modified', renamed: 'renamed', copied: 'added', changed: 'modified', unchanged: 'modified' };
const MAX_FILES = 300;

// the rendered form body to its fields; "_No response_" is an empty optional field
export function parseReport(body) {
  const out = {};
  const sections = String(body ?? '').split(/^### /m).slice(1);
  for (const s of sections) {
    const nl = s.indexOf('\n');
    const label = (nl < 0 ? s : s.slice(0, nl)).trim();
    const value = (nl < 0 ? '' : s.slice(nl + 1)).trim();
    const key = Object.keys(FIELDS).find((k) => FIELDS[k] === label);
    if (key) out[key] = value === '_No response_' ? '' : value;
  }
  return out;
}

// a pull request link on github.com or on the public page, to its owner, repository and number
export function parsePrLink(link) {
  const m = /^https:\/\/(?:github\.com|truedone\.pages\.dev)\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(String(link ?? '').trim());
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

// the report's problems, or none; a report without both commits is refused
export function problems(report) {
  const out = [];
  if (!parsePrLink(report.pr)) out.push('the pull request is not a link to github.com/<owner>/<repo>/pull/<n>');
  if (!SHA.test(report.head ?? '')) out.push('the head commit is not 40 hexadecimal characters');
  if (!SHA.test(report.base ?? '')) out.push('the base commit is not 40 hexadecimal characters');
  if (!Object.hasOwn(KINDS, report.kind ?? '')) out.push('what is wrong is not one of the form\'s choices');
  return out;
}

export function makeClient({ fetch: fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN || null, api = API, raw = RAW } = {}) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'truedone-misses' };
  if (token) headers.authorization = `Bearer ${token}`;
  return {
    async get(p) {
      const url = p.startsWith('https://') ? p : `${api}${p}`;
      const res = await fetchImpl(url, { headers });
      if (!res.ok) throw Object.assign(new Error(`GitHub ${res.status} on ${url}`), { status: res.status });
      return res.json();
    },
    // a file's text at a commit, or undefined when the commit has no such file
    async text(fullName, sha, file) {
      const res = await fetchImpl(`${raw}/${fullName}/${sha}/${file.split('/').map(encodeURIComponent).join('/')}`, { headers: { 'user-agent': 'truedone-misses' } });
      return res.ok ? res.text() : undefined;
    },
  };
}

const ancestors = (file) => {
  const parts = file.split('/').slice(0, -1);
  return Array.from({ length: parts.length + 1 }, (_, i) => parts.slice(0, i).join('/'));
};
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

// the test and runner configuration in each directory above a changed test, from the tree at a commit
export function configsAbove(treePaths, changedTests) {
  const dirs = new Set(changedTests.flatMap(ancestors));
  return treePaths.filter((p) => dirs.has(dirOf(p)) && (CONFIG.has(classify(p)) || MANIFESTS.has(p.split('/').pop()))).sort();
}

export async function snapshot({ issue, repo = REPO, client = makeClient(), now = new Date() }) {
  const item = await client.get(`/repos/${repo}/issues/${issue}`);
  const report = parseReport(item.body);
  const bad = problems(report);
  if (bad.length) throw Object.assign(new Error(`issue ${issue} is not a usable report: ${bad.join('; ')}`), { problems: bad });
  const { owner, repo: name, number } = parsePrLink(report.pr);
  const pr = await client.get(`/repos/${owner}/${name}/pulls/${number}`);
  const baseRepo = pr.base?.repo?.full_name ?? `${owner}/${name}`;
  const headRepo = pr.head?.repo?.full_name ?? baseRepo;
  const compare = await client.get(`/repos/${owner}/${name}/compare/${report.base}...${report.head}`);
  const files = (compare.files || []).slice(0, MAX_FILES).map((f) => {
    const out = { path: f.filename, status: STATUS[f.status] ?? 'modified' };
    if (f.previous_filename) out.previous_path = f.previous_filename;
    if (typeof f.patch === 'string') out.patch = f.patch;
    return out;
  });
  const tests = files.filter((f) => classify(f.path) === 'test').map((f) => f.path);
  const [baseTree, headTree] = await Promise.all([report.base, report.head].map((sha) => client.get(`/repos/${owner}/${name}/git/trees/${sha}?recursive=1`)));
  const blobs = (t) => (t.tree || []).filter((e) => e.type === 'blob').map((e) => e.path);
  const changed = new Set(files.map((f) => f.path));
  const configs = [...new Set([...configsAbove(blobs(baseTree), tests), ...configsAbove(blobs(headTree), tests)])].filter((p) => !changed.has(p)).sort();
  const base = {};
  const head = {};
  for (const f of files) {
    if (f.status !== 'added') { const t = await client.text(baseRepo, report.base, f.previous_path ?? f.path); if (t !== undefined) { base[f.previous_path ?? f.path] = t; f.base = t; } }
    if (f.status !== 'removed') { const t = await client.text(headRepo, report.head, f.path); if (t !== undefined) { head[f.path] = t; f.head = t; } }
  }
  for (const p of configs) {
    const [b, h] = await Promise.all([client.text(baseRepo, report.base, p), client.text(headRepo, report.head, p)]);
    if (b !== undefined) base[p] = b;
    if (h !== undefined) head[p] = h;
  }
  const runs = await client.get(`/repos/${owner}/${name}/commits/${report.head}/check-runs?per_page=100`);
  const prText = { title: pr.title ?? '', body: pr.body ?? '', author: { login: pr.user?.login ?? '', type: pr.user?.type ?? 'User' } };
  const now_ = analyse({ files, pr: prText, releases: [] });
  const id = `${issue}-${owner}-${name}-${number}`;
  return {
    id,
    base,
    head,
    record: {
      schema: SCHEMA,
      id,
      issue: Number(issue),
      issue_url: item.html_url ?? `https://github.com/${repo}/issues/${issue}`,
      reported_at: item.created_at ?? null,
      snapshot_at: now.toISOString(),
      report: { verdict: report.verdict, reasons: (report.reasons ?? '').split(/[\s,]+/).filter(Boolean), kind: report.kind, version: report.version, note: report.note ?? '' },
      expected: { outcome: KINDS[report.kind] },
      pr: { owner, repo: name, number, url: `https://github.com/${owner}/${name}/pull/${number}`, ...prText },
      commits: { base: report.base, head: report.head },
      files: files.map(({ path: p, status, previous_path, patch }) => ({ path: p, status, ...(previous_path ? { previous_path } : {}), ...(patch !== undefined ? { patch } : {}) })),
      configs,
      check_runs: (runs.check_runs || []).map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion ?? null, title: r.output?.title ?? null })),
      truedone_now: { verdict: now_.verdict, reasons: (now_.reasons || []).map((r) => ({ check: r.check, file: r.file, verdict: r.verdict })) },
    },
  };
}

// the case directory, outside this repository
export function write(outDir, snap) {
  const out = path.resolve(outDir);
  const rel = path.relative(fs.realpathSync(ROOT), fs.existsSync(out) ? fs.realpathSync(out) : out);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error(`--out ${outDir} is inside this repository; a snapshot goes to the private repository Truedone/truedone-misses`);
  const dir = path.join(out, snap.id);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [side, tree] of [['base', snap.base], ['head', snap.head]]) {
    for (const [p, t] of Object.entries(tree)) {
      const abs = path.join(dir, side, p);
      if (!abs.startsWith(path.join(dir, side) + path.sep)) throw new Error(`refusing a path outside the case: ${p}`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, t);
    }
  }
  fs.writeFileSync(path.join(dir, 'case.json'), `${JSON.stringify(snap.record, null, 2)}\n`);
  return dir;
}

export function args(argv) {
  const out = { issue: null, out: null, repo: REPO };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--repo') out.repo = argv[++i];
    else if (/^\d+$/.test(argv[i]) && out.issue === null) out.issue = Number(argv[i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!out.issue || !out.out) throw new Error('usage: node tools/misses/snapshot.mjs <issue number> --out <dir outside this repository> [--repo <owner/name>]');
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const a = args(argv);
  const snap = await snapshot({ issue: a.issue, repo: a.repo });
  const dir = write(a.out, snap);
  console.log(JSON.stringify({ issue: a.issue, case: dir, expected: snap.record.expected.outcome, truedone_now: snap.record.truedone_now.verdict, files: snap.record.files.length, configs: snap.record.configs.length }));
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error(`snapshot: ${e.message}`); process.exit(1); });
}
