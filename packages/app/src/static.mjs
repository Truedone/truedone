// The static stage (APP-03): on pull_request opened/synchronize/reopened, analyse the
// diff and post one check run and one label. Built against core.analyse's interface
// (docs/spec.md, core section); @truedone/core is wired in when lane-a's branch lands.
import { VERDICT_LABEL, LABELS } from "./labels.mjs";
import { parseConfig } from "./posting.mjs";

const API = "https://api.github.com";

function esc(text) {
  // S7: PR content is data. Markdown is escaped, @mentions neutralised.
  return String(text)
    .replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\*/g, "\\*").replace(/_/g, "\\_")
    .replace(/@/g, "@`").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

export function makeStatic(env) {
  async function api(path, init = {}) {
    const r = await fetch(API + path, {
      ...init,
      headers: {
        authorization: `Bearer ${env.INSTALLATION_TOKEN}`,
        accept: "application/vnd.github+json",
        "user-agent": "truedone-app",
        ...init.headers,
      },
    });
    if (!r.ok) throw Object.assign(new Error(`${r.status} ${path}`), { status: r.status });
    return r.json();
  }

  async function prFiles(owner, repo, number) {
    const files = [];
    let page = 1;
    for (;;) {
      const part = await api(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
      files.push(...part);
      if (part.length < 100) return files;
      page++;
    }
  }

  // D18: the published truedone release SHAs come from the tags of truedone/action, cached.
  async function publishedShas() {
    if (env.RELEASE_SHA_CACHE) return env.RELEASE_SHA_CACHE;
    const r = await fetch(`${API}/repos/truedone/action/tags?per_page=100`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "truedone-app" },
    });
    const tags = r.ok ? await r.json() : [];
    const shas = tags.map((t) => t.commit?.sha).filter(Boolean);
    env.RELEASE_SHA_CACHE = shas;
    return shas;
  }

  async function rawFile(owner, repo, ref, path) {
    const r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`, {
      headers: { "user-agent": "truedone-app" },
    });
    return r.ok ? await r.text() : undefined;
  }

  // The path-shaped pre-filter for content fetching (the spec's File classification
  // table): core classifies authoritatively, but only these paths' contents are ever
  // fetched, so a plain source file's contents never leave the repository.
  const CONTENT_PATHS = [
    /(^|\/)([^/]+\.(test|spec)\.[cm]?[jt]sx?)$/,
    /(^|\/)__(tests|mocks)__\//,
    /(^|\/)tests?\//,
    /(^|\/)test_[^/]*\.py$/, /(^|\/)[^/]*_test\.py$/,
    /(^|\/)jest\.config\./, /(^|\/)vitest\.config\./, /(^|\/)vite\.config\./,
    /(^|\/)\.mocharc\./, /(^|\/)pytest\.ini$/, /(^|\/)tox\.ini$/, /(^|\/)setup\.cfg$/,
    /(^|\/)pyproject\.toml$/, /(^|\/)jest\.setup\./, /(^|\/)vitest\.setup\./, /(^|\/)setup-tests\./,
    /(^|\/)conftest\.py$/,
    /(^|\/)\.github\/workflows\//, /(^|\/)\.github\/truedone\.yml$/,
  ];
  const needsContents = (p) => CONTENT_PATHS.some((re) => re.test(p));

  async function analyse(env2, owner, repo, head, files, prMeta) {
    // Base and head contents are fetched only for test, setup, runner-config and
    // workflow files (core.analyse's input contract). 100 fetched files is the cap.
    const fetched = [];
    for (const f of files) {
      if (f.status === "removed" || !needsContents(f.path)) continue;
      if (fetched.length >= 100) break;
      fetched.push({
        path: f.path,
        status: f.status,
        previous_path: f.previous_filename,
        patch: f.patch,
        base: await rawFile(owner, repo, f.status === "added" ? head : "base", f.path).catch(() => undefined),
        head: await rawFile(owner, repo, head, f.path).catch(() => undefined),
      });
    }
    const releases = await publishedShas();
    return env2.core.analyse({
      files: fetched,
      pr: prMeta,
      releases,
      limits: { files: 300, lines: 20000, fetched: 100 },
    });
  }

  function summary(result, prMeta) {
    const lines = [];
    lines.push(`**${result.verdict.replace(/_/g, " ")}${result.partial ? " (partial)" : ""}**`);
    for (const r of result.reasons.slice(0, 10)) {
      lines.push(`- ${esc(r.message)}${r.file ? ` (${esc(r.file)}${r.line ? ":" + r.line : ""})` : ""}`);
    }
    if (result.reasons.length > 10) lines.push(`- and ${result.reasons.length - 10} more`);
    if (result.next) lines.push(``, `What would change this: ${esc(result.next)}`);
    lines.push("", `Why: https://truedone.dev/${prMeta.owner}/${prMeta.repo}/pull/${prMeta.number}`);
    return lines.join("\n");
  }

  async function postCheck(owner, repo, head, result, prMeta) {
    const body = {
      name: "truedone",
      head_sha: head,
      status: "completed",
      conclusion: "neutral",
      output: { title: `truedone: ${result.verdict.replace(/_/g, " ")}${result.partial ? " (partial)" : ""}`, summary: summary(result, prMeta) },
    };
    const existing = await api(`/repos/${owner}/${repo}/commits/${head}/check-runs?check_name=truedone`).catch(() => null);
    const found = existing?.check_runs?.[0];
    if (found) return api(`/repos/${owner}/${repo}/check-runs/${found.id}`, { method: "PATCH", body: JSON.stringify(body) });
    return api(`/repos/${owner}/${repo}/check-runs`, { method: "POST", body: JSON.stringify(body) });
  }

  async function postLabel(owner, repo, number, result, prMeta) {
    const key = VERDICT_LABEL[result.verdict];
    const wanted = key ?? null;
    const current = (await api(`/repos/${owner}/${repo}/issues/${number}/labels`)).map((l) => l.name).filter((n) => n.startsWith("truedone:"));
    for (const name of current) {
      if (name !== wanted) await api(`/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => {});
    }
    if (!wanted || current.includes(wanted)) return;
    const all = await api(`/repos/${owner}/${repo}/labels`).catch(() => []);
    if (!all.some((l) => l.name === wanted)) {
      const l = LABELS.find((x) => x.name === key);
      await api(`/repos/${owner}/${repo}/labels`, { method: "POST", body: JSON.stringify({ name: l.name, color: l.color, description: l.description }) }).catch(() => {});
    }
    await api(`/repos/${owner}/${repo}/issues/${number}/labels`, { method: "POST", body: JSON.stringify({ labels: [wanted] }) });
  }

  return async function onPullRequest(delivery) {
    const { payload } = delivery;
    const { repository, pull_request: pr } = payload;
    const owner = repository.owner.login, repo = repository.name;
    const meta = { owner, repo, number: pr.number, title: pr.title, body: pr.body, author: pr.user };
    const cfg = parseConfig(await rawFile(owner, repo, pr.head.ref, ".github/truedone.yml"));
    if (cfg.enabled === "false") return { skipped: "repo_disabled" };

    const t0 = Date.now();
    const files = await prFiles(owner, repo, pr.number);
    const result = await analyse(env, owner, repo, pr.head.sha, files, meta);
    await postCheck(owner, repo, pr.head.sha, result, meta);
    await postLabel(owner, repo, pr.number, result, meta);
    // S8: timings and identifiers only, never diff content or PR text.
    env.LOG?.({ installation: payload.installation?.id, repository: repository.id, pr: pr.number, verdict: result.verdict, ms: Date.now() - t0 });
    return { verdict: result.verdict };
  };
}
