// The static stage (APP-03): on pull_request opened/synchronize/reopened, analyse the
// diff and post one check run and one label. core.analyse comes in as env.core (the
// Worker's entry hands it the core engine, APP-11). The input is read by the site's own
// reader, so the App and truedone.pages.dev build the same input for the same pull
// request (APP-13).
import { makeGitHub } from "./github.mjs";
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
  return async function analyse(env2, owner, repo, pr) {
    const releases = await gh.publishedShas();
    if (!pr) return env2.core.analyse({ files: [], pr: {}, releases, limits: LIMITS });
    const prUrl = `${API}/repos/${owner}/${repo}/pulls/${pr.number}`;
    const github = (url, init = {}) => String(url) === prUrl
      ? Promise.resolve(Response.json(pr))
      : fetch(url, { ...init, headers: { "user-agent": "truedone-app", ...init.headers } });
    const { input } = await loadPR({ owner, repo, number: pr.number }, { fetch: github, classify, token: env.INSTALLATION_TOKEN });
    return env2.core.analyse({ ...input, releases });
  };
}

export function makeStatic(env) {
  const gh = makeGitHub(env);
  const { rawFile, postCheck, postLabel } = gh;
  const analyse = makeAnalyser(env, gh);

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
