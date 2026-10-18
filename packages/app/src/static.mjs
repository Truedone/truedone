// The static stage (APP-03): on pull_request opened/synchronize/reopened, analyse the
// diff and post one check run and one label. core.analyse comes in as env.core (the
// Worker's entry hands it the core engine, APP-11). The input is read by the site's own
// reader, so the App and truedone.pages.dev build the same input for the same pull
// request (APP-13).
import { VERDICT_LABEL, LABELS } from "./labels.mjs";
import { parseConfig, postingAllowed } from "./posting.mjs";
import { loadPR } from "../../web/lib/github.mjs";
import { classify } from "../../core/core.mjs";

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

  // APP-13: the input comes from loadPR (packages/web/lib/github.mjs), the site's reader:
  // path from GitHub's filename, a modified or renamed file's base at
  // pull_request.base.sha from the base repository (at the previous path for a rename),
  // its head at the head sha from the head repository, no base for an added file and no
  // head for a removed one, and core's classify choosing which contents are fetched, so a
  // plain source file's contents never leave the repository. The pull request itself is
  // the delivery's, not a second call, so the contents and the check run name the same
  // head sha. Every request carries the App's user-agent: GitHub's API answers 403
  // without one, and the site's reader sets none because a browser adds its own.
  async function analyse(env2, owner, repo, pr) {
    const prUrl = `${API}/repos/${owner}/${repo}/pulls/${pr.number}`;
    const github = (url, init = {}) => String(url) === prUrl
      ? Promise.resolve(Response.json(pr))
      : fetch(url, { ...init, headers: { "user-agent": "truedone-app", ...init.headers } });
    const { input } = await loadPR({ owner, repo, number: pr.number }, { fetch: github, classify, token: env.INSTALLATION_TOKEN });
    const releases = await publishedShas();
    return env2.core.analyse({ ...input, releases });
  }

  function summary(result, prMeta) {
    const lines = [];
    lines.push(`**${result.verdict.replace(/_/g, " ")}${result.partial ? " (partial)" : ""}**`);
    for (const r of result.reasons.slice(0, 10)) {
      lines.push(`- ${esc(r.message)}${r.file ? ` (${esc(r.file)}${r.line ? ":" + r.line : ""})` : ""}`);
    }
    if (result.reasons.length > 10) lines.push(`- and ${result.reasons.length - 10} more`);
    if (result.next) lines.push(``, `What would change this: ${esc(result.next)}`);
    lines.push("", `Why: https://truedone.pages.dev/${prMeta.owner}/${prMeta.repo}/pull/${prMeta.number}`);
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
    // The repository's setting, at the base: a pull request cannot switch truedone off
    // for itself (APP-13).
    const configText = await rawFile(owner, repo, pr.base.sha, ".github/truedone.yml");
    const allowed = await postingAllowed(env, { installationId: payload.installation?.id, repository: repository.id, configText });
    if (!allowed.allowed) return { skipped: allowed.reason };

    const t0 = Date.now();
    const result = await analyse(env, owner, repo, pr);
    await postCheck(owner, repo, pr.head.sha, result, meta);
    await postLabel(owner, repo, pr.number, result, meta);
    // S8: timings and identifiers only, never diff content or PR text.
    env.LOG?.({ installation: payload.installation?.id, repository: repository.id, pr: pr.number, verdict: result.verdict, ms: Date.now() - t0 });
    return { verdict: result.verdict };
  };
}
