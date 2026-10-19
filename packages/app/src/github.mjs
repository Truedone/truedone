// The GitHub call layer both stages share (APP-12): the same calls the static
// stage used inline, extracted so the red-green stage's environment is built
// from real code instead of copies. makeGitHub(env) keeps the env reference:
// INSTALLATION_TOKEN is read per call, so the consumer's per-message stageEnv
// carries the fresh mint.
const API = "https://api.github.com";
const RELEASE_REPO = "Truedone/truedone-action";


export function makeGitHub(env) {
  async function api(p, init = {}) {
    const r = await fetch(API + p, {
      ...init,
      headers: {
        authorization: `Bearer ${await env.INSTALLATION_TOKEN}`,
        accept: "application/vnd.github+json",
        "user-agent": "truedone-app",
        ...init.headers,
      },
    });
    if (!r.ok) throw Object.assign(new Error(`${r.status} ${p}`), { status: r.status });
    return r.json();
  }

  // D18: the published truedone release SHAs come from the tags of the release repository, Truedone/truedone-action
  // (R3, D36), cached on the env. It read truedone/action, which answers 404, so no release was ever known (APP-27).
  async function publishedShas() {
    if (env.RELEASE_SHA_CACHE) return env.RELEASE_SHA_CACHE;
    const r = await fetch(`${API}/repos/${RELEASE_REPO}/tags?per_page=100`, {
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

  // A completed check run names the pull request's page on the site as its details (the
  // App's homepage otherwise, the site root), and the times of this verdict: started_at
  // when its analysis began (prMeta.startedAt, from the stage) and completed_at now, on a
  // new run and on an update alike, since GitHub keeps an updated run's first times
  // unless they are sent again (APP-14).
  // The reads a check run write and a label write need, so a stage can start them with its other reads (APP-15): the
  // truedone run already on this head, or null; the labels on the pull request and those the repository defines.
  // APP-30 (PV-A04): with two truedone Apps on one repository (the development and the production App, both installed on
  // the organisation), the first run named truedone may be the other App's, and updating it answers 403 (sandbox, 10:47Z
  // 2026-10-19: four times, then the dead-letter queue). So the read asks only for this App's runs (app_id, the App's own
  // id) and keeps a run only when its app.id is that id; with none, postCheck creates one.
  function checkRunFor(owner, repo, head) {
    const own = Number(env.APP_ID);
    return api(`/repos/${owner}/${repo}/commits/${head}/check-runs?check_name=truedone&app_id=${own}`)
      .then((r) => (r?.check_runs ?? []).find((run) => run?.app?.id === own) ?? null, () => null);
  }
  async function labelState(owner, repo, number) {
    const [onIssue, all] = await Promise.all([
      api(`/repos/${owner}/${repo}/issues/${number}/labels`),
      api(`/repos/${owner}/${repo}/labels`).catch(() => []),
    ]);
    return { onIssue: onIssue.map((l) => l.name), all };
  }

  // found and state, when given, are checkRunFor's and labelState's answers; without them each call reads its own.
  async function postCheck(owner, repo, head, result, prMeta, found) {
    const now = new Date().toISOString();
    const body = {
      name: "truedone",
      head_sha: head,
      details_url: pageUrl(prMeta),
      status: "completed",
      conclusion: "neutral",
      started_at: prMeta.startedAt ?? now,
      completed_at: now,
      output: { title: `truedone: ${result.verdict.replace(/_/g, " ")}${result.partial ? " (partial)" : ""}`, summary: summary(result, prMeta) },
    };
    const run = found === undefined ? await checkRunFor(owner, repo, head) : found;
    if (run) return api(`/repos/${owner}/${repo}/check-runs/${run.id}`, { method: "PATCH", body: JSON.stringify(body) });
    return api(`/repos/${owner}/${repo}/check-runs`, { method: "POST", body: JSON.stringify(body) });
  }

  // The stale truedone labels go and a missing label is defined together, then
  // the wanted one is added (APP-22: the one route — the trial's other two are
  // gone). Returns the write's milliseconds, for the phase line.
  async function postLabel(owner, repo, number, result, prMeta, state) {
    const key = VERDICT_LABEL[result.verdict];
    const wanted = key ?? null;
    const { onIssue, all } = state ?? await labelState(owner, repo, number);
    const current = onIssue.filter((n) => n.startsWith("truedone:"));
    if (!wanted || current.includes(wanted)) {
      await Promise.all(current.filter((name) => name !== wanted).map((name) => api(`/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => {})));
      return { writeMs: 0 };
    }
    const started = Date.now();
    const first = current.filter((name) => name !== wanted).map((name) => api(`/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => {}));
    if (!all.some((l) => l.name === wanted)) {
      const l = LABELS.find((x) => x.name === key);
      first.push(api(`/repos/${owner}/${repo}/labels`, { method: "POST", body: JSON.stringify({ name: l.name, color: l.color, description: l.description }) }).catch(() => {}));
    }
    await Promise.all(first);
    await api(`/repos/${owner}/${repo}/issues/${number}/labels`, { method: "POST", body: JSON.stringify({ labels: [wanted] }) });
    return { writeMs: Date.now() - started };
  }

  return { api, publishedShas, rawFile, checkRunFor, labelState, postCheck, postLabel };
}

function esc(text) {
  // S7: PR content is data. Markdown is escaped, @mentions neutralised.
  return String(text)
    .replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\*/g, "\\*").replace(/_/g, "\\_")
    .replace(/@/g, "@`").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

// The pull request's page on the site (D26).
const pageUrl = (prMeta) => `https://truedone.pages.dev/${prMeta.owner}/${prMeta.repo}/pull/${prMeta.number}`;

function summary(result, prMeta) {
  const lines = [];
  lines.push(`**${result.verdict.replace(/_/g, " ")}${result.partial ? " (partial)" : ""}**`);
  for (const r of result.reasons.slice(0, 10)) {
    lines.push(`- ${esc(r.message)}${r.file ? ` (${esc(r.file)}${r.line ? ":" + r.line : ""})` : ""}`);
  }
  if (result.reasons.length > 10) lines.push(`- and ${result.reasons.length - 10} more`);
  if (result.next) lines.push("", `What would change this: ${esc(result.next)}`);
  lines.push("", `Why: ${pageUrl(prMeta)}`);
  lines.push("", wrongVerdictLink(result, prMeta));
  return lines.join("\n");
}

// D39: the summary ends with the wrong-verdict issue form, prefilled with the
// repository, the pull request number, both commits, the verdict, the reason
// codes and the App's version, and never with pull request text. The link is
// built from the result and what the stage already holds; no read is added.
function wrongVerdictLink(result, prMeta) {
  const params = new URLSearchParams({
    template: "wrong-verdict.yml",
    pr: `https://github.com/${prMeta.owner}/${prMeta.repo}/pull/${prMeta.number}`,
    head: prMeta.head ?? "",
    base: prMeta.base ?? "",
    verdict: result.verdict,
    reasons: [...new Set((result.reasons ?? []).map((r) => r.check))].join(","),
    version: prMeta.version ?? "unversioned",
  });
  return `[This verdict is wrong](https://github.com/Truedone/truedone/issues/new?${params})`;
}

import { VERDICT_LABEL, LABELS } from "./labels.mjs";
