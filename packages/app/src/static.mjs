// The static stage (APP-03): on pull_request opened/synchronize/reopened, analyse the
// diff and post one check run and one label. core.analyse comes in as env.core (the
// Worker's entry hands it the core engine, APP-11). The input is read by the site's own
// reader, so the App and truedone.pages.dev build the same input for the same pull
// request (APP-13).
import { makeGitHub } from "./github.mjs";
import { ACTIONS, slim } from "./webhook.mjs";
import { parseConfig, postingAllowed } from "./posting.mjs";
import { loadPR, LIMITS } from "../../web/lib/github.mjs";
import { classify } from "../../core/core.mjs";

const API = "https://api.github.com";

// The static analysis for one head commit, shared by the static stage and the
// red-green stage's staticResult (APP-12). APP-13: the input comes from loadPR
// (packages/web/lib/github.mjs), the site's reader: path from GitHub's filename, a
// modified or renamed file's base at pull_request.base.sha from the base repository (at
// the previous path for a rename), its head at the head sha from the head repository,
// no base for an added file and no head for a removed one, and core's classify choosing
// which contents are fetched, so a plain source file's contents never leave the
// repository. The pull request is the caller's (the delivery's, or the red-green stage's
// lookup), not a second call, so the contents and the check run name the same head sha.
// Every request carries the App's user-agent: GitHub's API answers 403 without one, and
// the site's reader sets none because a browser adds its own.
export function makeAnalyser(env, gh) {
  return async function analyse(env2, owner, repo, prOrPromise) {
    // the published shas are read alongside the pull request's files and contents (APP-15), and alongside the pull
    // request itself when a queued run reads it from GitHub (APP-25)
    const shas = gh.publishedShas();
    const pr = await prOrPromise;
    if (!pr) return env2.core.analyse({ files: [], pr: {}, releases: await shas, limits: LIMITS });
    const prUrl = `${API}/repos/${owner}/${repo}/pulls/${pr.number}`;
    const github = (url, init = {}) => String(url) === prUrl
      ? Promise.resolve(Response.json(pr))
      : fetch(url, { ...init, headers: { "user-agent": "truedone-app", ...init.headers } });
    const [releases, { input }] = await Promise.all([shas, loadPR({ owner, repo, number: pr.number }, { fetch: github, classify, token: await env.INSTALLATION_TOKEN })]);
    return env2.core.analyse({ ...input, releases });
  };
}

export function makeStatic(env) {
  const gh = makeGitHub(env);
  const { api, rawFile, checkRunFor, labelState, postCheck, postLabel } = gh;
  const analyse = makeAnalyser(env, gh);

  // APP-25 (#125): the stage reads only the fields slim keeps, so a message queued in the full shape is handled like a
  // new one. The pull request comes from memory on the direct run (known: the delivery just received, never stored) or
  // from GitHub on a queued run, which so analyses the title, body and author as they stand when it runs. Either way the
  // analysis is at the delivery's base and head shas, where its check and label are written.
  // APP-26: gate is the intake's dedupe verdict for a direct run, read beside phases 1 and 2. The two writes wait for it,
  // and a duplicate writes nothing and logs no phase line; a failed dedupe throws. A queued delivery has no gate, since
  // the intake deduped it before its send.
  return async function onPullRequest(delivery, { pr: known, gate } = {}) {
    const payload = slim("pull_request", delivery.payload);
    // The intake drops every other action (APP-16); this covers a message queued before that.
    if (payload.action && !ACTIONS.pull_request.has(payload.action)) return { skipped: payload.action };
    const { repository, pull_request: pr } = payload;
    const owner = repository.owner.login, repo = repository.name;
    const meta = { owner, repo, number: pr.number, head: pr.head.sha, base: pr.base.sha, version: env.VERSION ?? "unversioned" };
    // Three phases (APP-15), each running its calls together. (1) The switch: the repository's
    // setting, read at the base so a pull request cannot switch truedone off for itself
    // (APP-13), and both posting flags. Nothing else is read before it, so a repository that
    // opted out has only its config read. (2) Only when posting is allowed, every read: the
    // analysis, the check run already on the head and the labels. (3) The two writes.
    const gateStart = Date.now();
    const configText = rawFile(owner, repo, pr.base.sha, ".github/truedone.yml");
    const allowed = await postingAllowed(env, { installationId: payload.installation?.id, repository: repository.id, configText });
    if (!allowed.allowed) return { skipped: allowed.reason };
    const phase1 = Date.now() - gateStart;

    // APP-20: two chains share the one analysis; the label never waits for a
    // check-run call. Either chain's failure throws to the APP-17 queue path.
    const t0 = Date.now();
    meta.startedAt = new Date(t0).toISOString();
    let analyseDone, labelDone, checkDone;
    const fullP = (known ? Promise.resolve(known) : api(`/repos/${owner}/${repo}/pulls/${pr.number}`))
      .then((full) => ({ ...full, base: { ...full.base, sha: pr.base.sha }, head: { ...full.head, sha: pr.head.sha } }));
    const analyseP = analyse(env, owner, repo, fullP).then((r) => { analyseDone = Date.now(); return r; });
    let labelWritten;
    const verdictP = gate ?? Promise.resolve("new");
    const labelChain = Promise.all([analyseP, labelState(owner, repo, pr.number), verdictP]).then(([result, labels, verdict]) => verdict !== "new" ? result : postLabel(owner, repo, pr.number, result, meta, labels).then((written) => { labelDone = Date.now(); labelWritten = written; return result; }));
    const checkChain = Promise.all([analyseP, checkRunFor(owner, repo, pr.head.sha), verdictP]).then(([result, found, verdict]) => verdict !== "new" ? result : postCheck(owner, repo, pr.head.sha, result, meta, found).then(() => { checkDone = Date.now(); return result; }));
    const [result] = await Promise.all([labelChain, checkChain]);
    if ((await verdictP) !== "new") return { duplicate: delivery.delivery };
    const end = Date.now();
    // APP-18/APP-20: one line per analysed delivery, numbers only, for the tail to split.
    console.log(JSON.stringify({ stage: "static", delivery: delivery.delivery, phase1_ms: phase1, phase2_ms: (analyseDone ?? end) - t0, label_ms: (labelDone ?? end) - t0, check_ms: (checkDone ?? end) - t0, label_write_ms: labelWritten?.writeMs ?? 0, total_ms: end - gateStart }));
    // S8: timings and identifiers only, never diff content or PR text.
    env.LOG?.({ installation: payload.installation?.id, repository: repository.id, pr: pr.number, verdict: result.verdict, ms: Date.now() - t0 });
    env.METRICS?.writeDataPoint({ blobs: [result.verdict, String(repository.id)], doubles: [Date.now() - t0], indexes: [String(pr.number)] });
    return { verdict: result.verdict };
  };
}
