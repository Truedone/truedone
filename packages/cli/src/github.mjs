// Reads one pull request for core.analyse, for npx truedone <PR> (CLI-01, D24). It does what the truedone.pages.dev page's reader does:
// the PR, then its file pages of 100 and one compare call for its merge base (fetched together) from api.github.com, so
// a PR of 300 files takes 5 calls, and base (at the merge base, CORE-12) and head contents of the files core classifies
// as test, setup, runner config, workflow or truedone config from raw.githubusercontent.com, up to the static limit of
// 100 fetched files. Both are read in the base repository, which holds the head commit of a pull request from a forked
// repository (refs/pull/<n>/head) even once the head repository is deleted or private (CORE-14). A head file that cannot
// be read throws HeadUnreadable, never reads as empty, so its tests never read as removed. GITHUB_TOKEN, when
// set, goes to api.github.com only. Nothing is cloned and no process is started.
import { CONTENT, LIMITS } from './constants.mjs';

export const API = 'https://api.github.com';
export const RAW = 'https://raw.githubusercontent.com';
// The repository whose tags are the published action releases (D18)
export const RELEASES_REPO = 'Truedone/truedone-action';
const STATUS = { added: 'added', removed: 'removed', modified: 'modified', renamed: 'renamed', copied: 'added', changed: 'modified', unchanged: 'modified' };

export class RateLimited extends Error {
  constructor() { super('GitHub API rate limit reached'); this.name = 'RateLimited'; }
}
export class GitHubError extends Error {
  constructor(status) { super(`GitHub answered ${status}`); this.name = 'GitHubError'; this.status = status; }
}
// CORE-14: a changed file's head that GitHub does not serve, as the site's reader throws it: no path in the message (S8),
// path names the file, and answer is GitHub's status.
export class HeadUnreadable extends GitHubError {
  constructor(answer, path) { super(`${answer} for a file at the head commit`); this.name = 'HeadUnreadable'; this.answer = answer; this.path = path; }
}
export const isRateLimit = (res) => res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');

const rawPath = (p) => p.split('/').map(encodeURIComponent).join('/');
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } }));
}

function client(fetch, token) {
  let calls = 0;
  const get = async (url) => {
    calls++;
    const headers = { accept: 'application/vnd.github+json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    if (isRateLimit(res)) throw new RateLimited();
    if (!res.ok) throw new GitHubError(res.status);
    return res.json();
  };
  return { get, calls: () => calls };
}

// The SHAs of the published action releases, from the tags of RELEASES_REPO (D18); [] when there are none
export async function fetchReleases({ fetch, token = null }) {
  try {
    const tags = await client(fetch, token).get(`${API}/repos/${RELEASES_REPO}/tags?per_page=100`);
    return Array.isArray(tags) ? tags.map((t) => t?.commit?.sha).filter((s) => typeof s === 'string') : [];
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return [];
    throw e;
  }
}

// The branch a PR targets, for --run's merge-base on the clone (CLI-03, D6): one API call
export async function fetchPullBase({ owner, repo, number }, { fetch, token = null }) {
  const pr = await client(fetch, token).get(`${API}/repos/${owner}/${repo}/pulls/${number}`);
  const baseRef = pr?.base?.ref;
  if (typeof baseRef !== 'string' || !/^[A-Za-z0-9._\/-]+$/.test(baseRef) || baseRef.includes('..')) throw new GitHubError('without a usable base branch');
  return { baseRef };
}

// The commit GitHub takes a pull request's file list from (CORE-12, D24): the merge base of its base and head, named by
// one compare call in the base repository, which also holds a fork's head commit. pr.base.sha is the base branch's tip,
// where a test the base branch gained after the pull request branched would read as one the pull request removed. A
// failed call throws, as every other read does, and so does an answer whose merge base is missing or is not one path
// segment of the raw address; nothing falls back to the tip.
export async function mergeBase(get, baseRepo, pr) {
  const sha = (await get(`${API}/repos/${baseRepo}/compare/${pr.base.sha}...${pr.head.sha}`))?.merge_base_commit?.sha;
  if (typeof sha !== 'string' || !/^[\w-]+$/.test(sha)) throw new GitHubError('without a merge base');
  return sha;
}

export async function loadPR({ owner, repo, number }, { fetch, classify, token = null, limits = LIMITS }) {
  const c = client(fetch, token);
  const prUrl = `${API}/repos/${owner}/${repo}/pulls/${number}`;
  const pr = await c.get(prUrl);
  const total = Math.min(Number(pr.changed_files) || 0, 3000);
  const pages = Math.max(1, Math.ceil(Math.min(total, limits.files) / 100));
  const baseRepo = pr.base?.repo?.full_name ?? `${owner}/${repo}`;
  const [listed, base] = await Promise.all([
    Promise.all(Array.from({ length: pages }, (_, k) => c.get(`${prUrl}/files?per_page=100&page=${k + 1}`))).then((p) => p.flat()),
    mergeBase(c.get, baseRepo, pr),
  ]);
  const files = listed.slice(0, limits.files).map((f) => {
    const out = { path: f.filename, status: STATUS[f.status] ?? 'modified' };
    if (f.previous_filename) out.previous_path = f.previous_filename;
    if (typeof f.patch === 'string') out.patch = f.patch;
    return out;
  });
  const text = async (url) => { const res = await fetch(url); return res.ok ? res.text() : undefined; };   // no token to raw
  // CORE-14: a changed file's head, at the head sha in the base repository. A file GitHub lists as not removed exists at
  // the head, so a failed answer is an error: read as missing, every test in the file would read as removed.
  const headText = async (path) => {
    const res = await fetch(`${RAW}/${baseRepo}/${pr.head.sha}/${rawPath(path)}`);
    if (!res.ok) throw new HeadUnreadable(res.status, path);
    return res.text();
  };
  const wanted = files.filter((f) => CONTENT.has(classify(f.path)) || (f.previous_path && CONTENT.has(classify(f.previous_path)))).slice(0, limits.fetched);
  await pool(wanted, 8, async (f) => {
    const [b, h] = await Promise.all([
      f.status === 'added' ? undefined : text(`${RAW}/${baseRepo}/${base}/${rawPath(f.previous_path ?? f.path)}`),
      f.status === 'removed' ? undefined : headText(f.path),
    ]);
    if (b !== undefined) f.base = b;
    if (h !== undefined) f.head = h;
  });
  return {
    input: { files, pr: { title: pr.title ?? '', body: pr.body ?? '', author: { login: pr.user?.login ?? '', type: pr.user?.type ?? 'User' } }, limits },
    calls: c.calls(),
    head: pr.head?.sha ?? null,   // the commits a wrong-verdict report names (D39); base is the merge base
    base,
  };
}
