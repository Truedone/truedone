// The check-then-post stage (APP-04, D10/D11): on workflow_run completed, find the PR,
// take the report only after four checks, let core.judge decide, update the run and label.
// A run held for a first-time contributor (conclusion action_required) is Waiting for approval.
import { VERDICT_LABEL, LABELS } from "./labels.mjs";

const API = "https://api.github.com";
const MAX_ARTIFACT = 256 * 1024;
const MAX_TESTS = 500;

function esc(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\*/g, "\\*").replace(/_/g, "\\_").replace(/@/g, "@`");
}

// PV-A06: the four checks a report must pass before it is believed.
export function reportChecks(reportText, { headSha, defaultBranchStep, publishedShas }) {
  let report;
  try { report = JSON.parse(reportText); } catch { return { ok: false, why: "not json" }; }
  if (report.schema !== "truedone.report/1") return { ok: false, why: "schema" };
  if (report.head_sha !== headSha) return { ok: false, why: "head_sha" };
  const step = report.proved_step || "";
  const published = new Set(publishedShas || []);
  if (step !== defaultBranchStep && !published.has(step)) return { ok: false, why: "proved_step" };
  if (!Array.isArray(report.tests) || report.tests.length > MAX_TESTS) return { ok: false, why: "tests" };
  return { ok: true, report };
}


export function makeRedGreen(env) {
  async function api(p, init = {}) {
    const r = await fetch(API + p, { ...init, headers: { authorization: `Bearer ${await env.INSTALLATION_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "truedone-app", ...init.headers } });
    if (!r.ok) throw Object.assign(new Error(`${r.status} ${p}`), { status: r.status });
    return r.json();
  }

  // Forks: the workflow_run payload lists no pull requests, so the PR is found by head
  // SHA and head repository (PV-A05).
  async function findPr(owner, repo, headSha, headRepo) {
    const prs = await api(`/repos/${owner}/${repo}/commits/${headSha}/pulls`);
    return prs.find((p) => `${p.head.repo.owner.login}/${p.head.repo.name}` === headRepo) || null;
  }

  // S6: refuse an artifact over the cap or holding more than one file BEFORE unzipping.
  async function takeReportArtifact(owner, repo, runId, jobName) {
    const arts = await api(`/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`);
    const mine = (arts.artifacts || []).filter((a) => a.name === `truedone-report-${jobName}` && !a.expired);
    if (!mine.length) return null;
    const art = mine[0];
    if (art.size_in_bytes > MAX_ARTIFACT) throw new Error(`artifact over ${MAX_ARTIFACT} bytes`);
    const zip = await fetch(art.archive_download_url, { headers: { authorization: `Bearer ${await env.INSTALLATION_TOKEN}`, "user-agent": "truedone-app" } });
    const buf = new Uint8Array(await zip.arrayBuffer());
    if (buf.length > MAX_ARTIFACT) throw new Error(`artifact over ${MAX_ARTIFACT} bytes`);
    // A minimal unzip: the stored entry count must be exactly one, checked on the
    // central directory before any entry is written anywhere.
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let entries = 0;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { entries = view.getUint16(i + 10, true); break; }
    }
    if (entries !== 1) throw new Error(`artifact holds ${entries} files`);
    const { entries: unzipped } = await env.UNZIP(buf);
    return new TextDecoder().decode(unzipped[0].data);
  }

  return async function onWorkflowRun(delivery) {
    // the check run's started_at: when this delivery's red-green judgement began (APP-14)
    const startedAt = new Date().toISOString();
    const { workflow_run: run, action } = delivery.payload;
    if (action !== "completed") return { skipped: action };
    const owner = delivery.payload.repository.owner.login;
    const repo = delivery.payload.repository.name;
    const headSha = run.head_sha;

    const pr = await findPr(owner, repo, headSha, run.head_repository.full_name);
    if (!pr) return { skipped: "no_pr" };

    // A held first-time-contributor run never reports; the verdict is Waiting for approval.
    if (run.conclusion === "action_required") {
      return { verdict: "pending", pr: pr.number };
    }

    const job = run.jobs_url ? (await api(run.jobs_url.split(API)[1])).jobs?.[0] : null;
    const text = await takeReportArtifact(owner, repo, run.id, job?.name || "test");
    if (!text) return { skipped: "no_report" };

    const defaultBranchStep = await env.defaultStepSha(owner, repo);
    const check = reportChecks(text, { headSha, defaultBranchStep, publishedShas: await env.publishedShas() });
    if (!check.ok) return { refused: check.why, pr: pr.number };

    const judged = await env.core.judge(await env.staticResult(headSha), [check.report]);
    // D10: the app's own static verdict stands; no report overrides tampered or review.
    // The entry builds both from the shared static analysis, so both may be async; each
    // is awaited (APP-13).
    const standing = await env.staticVerdict(headSha);
    if (["tampered", "review"].includes(standing)) {
      return { verdict: standing, pr: pr.number };
    }
    // A verdict is about one commit (APP-13): the check run is written at the commit the
    // report ran on (reportChecks pinned report.head_sha to it), never at the pull
    // request's current head; the label belongs to the pull request, so it is written
    // only while that commit is still the head, and a run on an older commit leaves the
    // newer head's label to that head's own run.
    await env.postCheck(headSha, judged, { owner, repo, number: pr.number, startedAt });
    if (pr.head.sha === headSha) await env.postLabel(pr.number, judged);
    env.LOG?.({ installation: delivery.payload.installation?.id, repository: delivery.payload.repository.id, pr: pr.number, verdict: judged.verdict, ms: Date.now() - (delivery._t0 || Date.now()) });
    env.METRICS?.writeDataPoint({ blobs: [judged.verdict, String(delivery.payload.repository.id)], doubles: [Date.now() - (delivery._t0 || Date.now())], indexes: [String(pr.number)] });
    return { verdict: judged.verdict, pr: pr.number };
  };
}
