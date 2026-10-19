// Reads one pull request for core.analyse (WEB-01, D24). The PR, its file list and its merge base come from
// api.github.com: one call for the PR, then the file pages of 100 and one compare call, fetched together, so a PR of 300
// files takes 5 calls. Contents come from raw.githubusercontent.com, which needs no API quota: base (at the merge base,
// CORE-12) and head of each file core classifies as a test, setup, runner-config, workflow or truedone config file, up to
// the static limit of 100 fetched files. Both are read in the base repository, which holds the head commit of a pull
// request from a forked repository (refs/pull/<n>/head) even once the head repository is deleted or private (CORE-14). A
// head file that cannot be read throws HeadUnreadable, never reads as empty, so its tests never read as removed.
// A rate-limit response throws RateLimited, so the page can offer sign-in. After sign-in (WEB-02) the token goes to
// api.github.com only, never to raw.githubusercontent.com (S8).
export const API = 'https://api.github.com';
export const RAW = 'https://raw.githubusercontent.com';
export const LIMITS = { files: 300, lines: 20000, fetched: 100 };   // docs/spec.md, Limits (static)
const CONTENT = new Set(['test', 'setup', 'runner_config', 'workflow', 'truedone_config']);
const STATUS = { added: 'added', removed: 'removed', modified: 'modified', renamed: 'renamed', copied: 'added', changed: 'modified', unchanged: 'modified' };

export class RateLimited extends Error {
  constructor(reset) { super('GitHub API rate limit reached'); this.name = 'RateLimited'; this.reset = reset ? Number(reset) : null; }
}
export class GitHubError extends Error {
  constructor(status) { super(`GitHub answered ${status}`); this.name = 'GitHubError'; this.status = status; }
}
// CORE-14: a changed file's head that GitHub does not serve. The message holds no path, since the App logs it and a path
// comes from the pull request (S8); path names the file for the page, and answer is GitHub's status.
export class HeadUnreadable extends GitHubError {
  constructor(answer, path) { super(`${answer} for a file at the head commit`); this.name = 'HeadUnreadable'; this.answer = answer; this.path = path; }
}

// GitHub's two rate-limit answers: 429, or 403 with no requests remaining
export function isRateLimit(res) {
  return res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');
}

const rawPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// The commit GitHub takes a pull request's file list from (CORE-12, D24): the merge base of its base and head, named by
// one compare call in the base repository, which also holds a fork's head commit. pr.base.sha is the base branch's tip,
// where a test the base branch gained after the pull request branched would read as one the pull request removed. A
// failed call throws, as every other read does, and so does an answer whose merge base is missing or is not one path
// segment of the raw address; nothing falls back to the tip.
export async function mergeBase(get, api, baseRepo, pr) {
  const sha = (await get(`${api}/repos/${baseRepo}/compare/${pr.base.sha}...${pr.head.sha}`))?.merge_base_commit?.sha;
  if (typeof sha !== 'string' || !/^[\w-]+$/.test(sha)) throw new GitHubError('without a merge base');
  return sha;
}

export async function loadPR({ owner, repo, number }, { fetch, classify, token = null, api = API, raw = RAW, limits = LIMITS }) {
  let calls = 0;
  const get = async (url) => {
    calls++;
    const headers = { accept: 'application/vnd.github+json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    if (isRateLimit(res)) throw new RateLimited(res.headers.get('x-ratelimit-reset'));
    if (!res.ok) throw new GitHubError(res.status);
    return res.json();
  };
  const text = async (url) => {
    const res = await fetch(url);
    return res.ok ? res.text() : undefined;
  };
  const prUrl = `${api}/repos/${owner}/${repo}/pulls/${number}`;
  const pr = await get(prUrl);
  const total = Math.min(Number(pr.changed_files) || 0, 3000);
  const pages = Math.max(1, Math.ceil(Math.min(total, limits.files) / 100));
  const baseRepo = pr.base?.repo?.full_name ?? `${owner}/${repo}`;
  const [listed, base] = await Promise.all([
    Promise.all(Array.from({ length: pages }, (_, k) => get(`${prUrl}/files?per_page=100&page=${k + 1}`))).then((p) => p.flat()),
    mergeBase(get, api, baseRepo, pr),
  ]);
  const files = listed.slice(0, limits.files).map((f) => {
    const out = { path: f.filename, status: STATUS[f.status] ?? 'modified' };
    if (f.previous_filename) out.previous_path = f.previous_filename;
    if (typeof f.patch === 'string') out.patch = f.patch;
    return out;
  });
  // CORE-14: a changed file's head, at the head sha in the base repository. A file GitHub lists as not removed exists at
  // the head, so a failed answer is an error: read as missing, every test in the file would read as removed.
  const headText = async (path) => {
    const res = await fetch(`${raw}/${baseRepo}/${pr.head.sha}/${rawPath(path)}`);
    if (!res.ok) throw new HeadUnreadable(res.status, path);
    return res.text();
  };
  const wanted = files.filter((f) => CONTENT.has(classify(f.path)) || (f.previous_path && CONTENT.has(classify(f.previous_path)))).slice(0, limits.fetched);
  await pool(wanted, 8, async (f) => {
    const [b, h] = await Promise.all([
      f.status === 'added' ? undefined : text(`${raw}/${baseRepo}/${base}/${rawPath(f.previous_path ?? f.path)}`),
      f.status === 'removed' ? undefined : headText(f.path),
    ]);
    if (b !== undefined) f.base = b;
    if (h !== undefined) f.head = h;
  });
  const input = {
    files,
    pr: { title: pr.title ?? '', body: pr.body ?? '', author: { login: pr.user?.login ?? '', type: pr.user?.type ?? 'User' } },
    limits,
  };
  return {
    input,
    // head and base: the commits this verdict was read at, for the wrong-verdict link (WEB-14, D39); base is the merge base
    pr: { owner, repo, number, title: pr.title ?? '', author: pr.user?.login ?? '', url: `https://github.com/${owner}/${repo}/pull/${number}`, changed_files: total, head: pr.head?.sha ?? '', base },
    calls,
    truncated: total > files.length,
  };
}
