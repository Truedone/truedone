// Reads one pull request for core.analyse, for npx truedone <PR> (CLI-01, D24). It does what the truedone.pages.dev page's reader does:
// the PR and its file pages of 100 (fetched together) from api.github.com, so a PR of 300 files takes 4 calls, and
// base and head contents of the files core classifies as test, setup, runner config, workflow or truedone config from
// raw.githubusercontent.com, up to the static limit of 100 fetched files. GITHUB_TOKEN, when set, goes to
// api.github.com only. Nothing is cloned and no process is started.
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

export async function loadPR({ owner, repo, number }, { fetch, classify, token = null, limits = LIMITS }) {
  const c = client(fetch, token);
  const prUrl = `${API}/repos/${owner}/${repo}/pulls/${number}`;
  const pr = await c.get(prUrl);
  const total = Math.min(Number(pr.changed_files) || 0, 3000);
  const pages = Math.max(1, Math.ceil(Math.min(total, limits.files) / 100));
  const listed = (await Promise.all(Array.from({ length: pages }, (_, k) => c.get(`${prUrl}/files?per_page=100&page=${k + 1}`)))).flat();
  const files = listed.slice(0, limits.files).map((f) => {
    const out = { path: f.filename, status: STATUS[f.status] ?? 'modified' };
    if (f.previous_filename) out.previous_path = f.previous_filename;
    if (typeof f.patch === 'string') out.patch = f.patch;
    return out;
  });
  const baseRepo = pr.base?.repo?.full_name ?? `${owner}/${repo}`;
  const headRepo = pr.head?.repo?.full_name ?? baseRepo;
  const text = async (url) => { const res = await fetch(url); return res.ok ? res.text() : undefined; };   // no token to raw
  const wanted = files.filter((f) => CONTENT.has(classify(f.path)) || (f.previous_path && CONTENT.has(classify(f.previous_path)))).slice(0, limits.fetched);
  await pool(wanted, 8, async (f) => {
    const [b, h] = await Promise.all([
      f.status === 'added' ? undefined : text(`${RAW}/${baseRepo}/${pr.base.sha}/${rawPath(f.previous_path ?? f.path)}`),
      f.status === 'removed' ? undefined : text(`${RAW}/${headRepo}/${pr.head.sha}/${rawPath(f.path)}`),
    ]);
    if (b !== undefined) f.base = b;
    if (h !== undefined) f.head = h;
  });
  return {
    input: { files, pr: { title: pr.title ?? '', body: pr.body ?? '', author: { login: pr.user?.login ?? '', type: pr.user?.type ?? 'User' } }, limits },
    calls: c.calls(),
  };
}
