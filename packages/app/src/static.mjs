// The static stage (APP-03): on pull_request opened/synchronize/reopened, analyse the
// diff and post one check run and one label. Built against core.analyse's interface
// (docs/spec.md, core section); @truedone/core is wired in when lane-a's branch lands.
import { makeGitHub } from "./github.mjs";
import { parseConfig, postingAllowed } from "./posting.mjs";

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

// The static analysis for one head commit, shared by the static stage and the
// red-green stage's staticResult (APP-12): fetches base and head contents for
// the test-shaped files and hands core the recorded input.
export function makeAnalyser(env, gh) {
  const needsContents = (p) => CONTENT_PATHS.some((re) => re.test(p));
  return async function analyse(env2, owner, repo, head, files, prMeta) {
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
        base: await gh.rawFile(owner, repo, f.status === "added" ? head : "base", f.path).catch(() => undefined),
        head: await gh.rawFile(owner, repo, head, f.path).catch(() => undefined),
      });
    }
    const releases = await gh.publishedShas();
    return env2.core.analyse({
      files: fetched,
      pr: prMeta,
      releases,
      limits: { files: 300, lines: 20000, fetched: 100 },
    });
  };
}

export function makeStatic(env) {
  const gh = makeGitHub(env);
  const { api, prFiles, rawFile, postCheck, postLabel } = gh;
  const analyse = makeAnalyser(env, gh);

  return async function onPullRequest(delivery) {
    const { payload } = delivery;
    const { repository, pull_request: pr } = payload;
    const owner = repository.owner.login, repo = repository.name;
    const meta = { owner, repo, number: pr.number, title: pr.title, body: pr.body, author: pr.user };
    const configText = await rawFile(owner, repo, pr.head.ref, ".github/truedone.yml");
    const allowed = await postingAllowed(env, { installationId: payload.installation?.id, repository: repository.id, configText });
    if (!allowed.allowed) return { skipped: allowed.reason };

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
