// The GitHub call layer both stages share (APP-12): the same calls the static
// stage used inline, extracted so the red-green stage's environment is built
// from real code instead of copies. makeGitHub(env) keeps the env reference:
// INSTALLATION_TOKEN is read per call, so the consumer's per-message stageEnv
// carries the fresh mint.
const API = "https://api.github.com";

export function makeGitHub(env) {
  async function api(p, init = {}) {
    const r = await fetch(API + p, {
      ...init,
      headers: {
        authorization: `Bearer ${env.INSTALLATION_TOKEN}`,
        accept: "application/vnd.github+json",
        "user-agent": "truedone-app",
        ...init.headers,
      },
    });
    if (!r.ok) throw Object.assign(new Error(`${r.status} ${p}`), { status: r.status });
    return r.json();
  }

  // D18: the published truedone release SHAs come from the tags of
  // truedone/action, cached on the env.
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

  return { api, publishedShas, rawFile, postCheck, postLabel };
}

function esc(text) {
  // S7: PR content is data. Markdown is escaped, @mentions neutralised.
  return String(text)
    .replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\*/g, "\\*").replace(/_/g, "\\_")
    .replace(/@/g, "@`").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function summary(result, prMeta) {
  const lines = [];
  lines.push(`**${result.verdict.replace(/_/g, " ")}${result.partial ? " (partial)" : ""}**`);
  for (const r of result.reasons.slice(0, 10)) {
    lines.push(`- ${esc(r.message)}${r.file ? ` (${esc(r.file)}${r.line ? ":" + r.line : ""})` : ""}`);
  }
  if (result.reasons.length > 10) lines.push(`- and ${result.reasons.length - 10} more`);
  if (result.next) lines.push("", `What would change this: ${esc(result.next)}`);
  lines.push("", `Why: https://truedone.pages.dev/${prMeta.owner}/${prMeta.repo}/pull/${prMeta.number}`);
  return lines.join("\n");
}

import { VERDICT_LABEL, LABELS } from "./labels.mjs";
