// npx truedone --run (CLI-03, PV-L03, PV-L05, PV-L06; docs/spec.md, cli and plugin, S1 and S4). Red-green on the
// changed tests: core/run's redGreen({ root, tests, files, base, head, env }) (agreed with lane-c, bus 2452) swaps the changed source files to base, runs the tests on base twice and on head
// three times, and restores; core's judge adds the report to the static result.
// - On the user's own branch it runs at once, after restorePending puts back the files of a run that was killed
//   mid-way (S1).
// - On anyone else's PR it says once that it will execute that PR's code, offers --docker when Docker is on PATH, and
//   goes on only after a typed yes on a terminal or --yes. With no terminal and no --yes it executes nothing, clones
//   nothing, and exits 2. The PR is cloned into a temporary directory, and its code gets the environment of S4.
// - --docker runs each command of the red-green step in node:24-slim or python:3.12-slim (src/docker.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localInput, makeGit, NoRepository } from './local.mjs';
import { fetchPullBase, RateLimited, GitHubError } from './github.mjs';
import { emit } from './output.mjs';
import { groupsByImage, startContainer, dockerOnPath, mergeReports } from './docker.mjs';

// S4: the variables a PR's code never sees. The spec writes the names upper case; npm also reads npm_config_* in lower
// case, so that form is removed too.
const SECRET_SUFFIX = /(_TOKEN|_SECRET|_KEY|_PASSWORD)$/;
const SECRET_PREFIX = /^(AWS_|AZURE_|NPM_CONFIG_|npm_config_)/;
export function filterEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (SECRET_SUFFIX.test(k) || SECRET_PREFIX.test(k) || k === 'GOOGLE_APPLICATION_CREDENTIALS') continue;
    out[k] = v;
  }
  return out;
}

async function readLine(stdin) {
  let s = '';
  for await (const chunk of stdin) {
    s += String(chunk);
    const i = s.indexOf('\n');
    if (i >= 0) return s.slice(0, i);
  }
  return s;
}

// true only after a typed yes on a terminal, or with --yes
export async function consent({ what, yes, stdin, stderr, docker, dockerWanted }) {
  stderr.write(`truedone --run will execute the code of ${what} on this machine: its tests and everything they load.\n`);
  if (docker && !dockerWanted) stderr.write('Add --docker to run it in a container (node:24-slim or python:3.12-slim) instead.\n');
  if (yes) return true;
  if (!stdin?.isTTY) {
    stderr.write('Nothing was executed: there is no terminal to type yes in. Run it again with --yes to go ahead.\n');
    return false;
  }
  stderr.write('Type yes to go ahead: ');
  const answer = (await readLine(stdin)).trim();
  if (answer === 'yes') return true;
  stderr.write('Nothing was executed.\n');
  return false;
}

// Red-green in root, locally or in one container per image; returns one truedone.report/1
async function redGreenIn(root, { tests, files, base, head, env, docker, deps }) {
  if (!docker) return deps.redGreen({ root, tests, files, base, head, env });
  const reports = [];
  for (const { image, tests: group } of groupsByImage(tests)) {
    const c = await startContainer({ image, root, spawn: deps.spawn });
    try { reports.push(await deps.redGreen({ root, tests: group, files, base, head, env, exec: c.exec })); } finally { await c.stop(); }
  }
  return mergeReports(reports);
}

// D7 (CLI-09): red-green puts each changed source file back to its base content, so every changed file that is not
// added gets its base from git show <merge base>:<path>, under its previous path when it was renamed, as the action
// does. localInput reads base content only for the files core reads statically; analyse keeps that input as it is.
function withBase(files, base, git) {
  return files.map((f) => {
    if (f.status === 'added' || f.base !== undefined) return f;
    const b = git(['show', `${base}:${f.previous_path ?? f.path}`], { raw: true, quiet: true });
    return b === null ? f : { ...f, base: b };
  });
}

async function redGreenAndJudge(root, input, base, head, { env, docker, deps, git }) {
  const { analyse, classify, detect, judge } = deps;
  const staticResult = analyse(input);
  const changed = input.files.filter((f) => f.status !== 'removed' && classify(f.path) === 'test').map((f) => f.path);
  const reports = changed.length ? [await redGreenIn(root, { tests: detect(root, changed), files: withBase(input.files, base, git), base, head, env, docker, deps })] : [];
  return judge(staticResult, reports);
}

// o: parsed options ({ target, json, failOn, yes, docker }); returns the exit code
export async function runMode(o, deps) {
  const { cwd = process.cwd(), env = process.env, stdout, stderr, fetch = globalThis.fetch } = deps;
  const gitAt = deps.makeGit ?? makeGit;
  const fail = (code, msg) => { stderr.write(`truedone --run: ${msg}\n`); return code; };
  try {
    if (!o.target) {
      const git = gitAt(cwd, env);
      const top = git(['rev-parse', '--show-toplevel'], { quiet: true });
      if (!top) return fail(2, `${cwd} is not inside a git repository`);
      await deps.restorePending(top);   // S1: a run killed mid-way is put back before anything reads the tree
      let l;
      try { l = localInput(top, { classify: deps.classify, git }); } catch (e) {
        if (e instanceof NoRepository) return fail(2, e.message);
        throw e;
      }
      const result = await redGreenAndJudge(top, l.input, l.base, git(['rev-parse', 'HEAD']), { env, docker: o.docker, deps, git });
      return emit(result, `the working tree, against ${l.base.slice(0, 12)}, with red-green`, o, stdout);
    }
    const t = o.target;
    const what = `${t.owner}/${t.repo}#${t.number}`;
    if (!(await consent({ what, yes: o.yes, stdin: deps.stdin, stderr, docker: (deps.dockerOnPath ?? dockerOnPath)(env), dockerWanted: o.docker }))) return 2;
    const clean = filterEnv(env);
    let ref;
    try { ref = await fetchPullBase(t, { fetch, token: env.GITHUB_TOKEN || null }); } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return fail(2, `GitHub has no pull request ${what}, or it is not public`);
      if (e instanceof RateLimited) return fail(3, 'GitHub\'s API rate limit is used up; set GITHUB_TOKEN to read with your own limit');
      throw e;
    }
    // with --docker the clone goes under the home directory: Docker Desktop shares it by default, and it may not share
    // the system temporary directory, whose mount it then refuses
    const parent = deps.tmpdir ?? (o.docker ? path.join(os.homedir(), '.cache', 'truedone') : os.tmpdir());
    fs.mkdirSync(parent, { recursive: true });
    const dir = fs.mkdtempSync(path.join(parent, 'truedone-pr-'));
    try {
      const url = (deps.cloneUrl ?? ((x) => `https://github.com/${x.owner}/${x.repo}.git`))(t);
      gitAt(path.dirname(dir), clean)(['clone', '--quiet', '--no-tags', url, dir]);
      const git = gitAt(dir, clean);
      git(['fetch', '--quiet', 'origin', `pull/${t.number}/head`]);
      git(['checkout', '--quiet', '-b', 'truedone-pr', 'FETCH_HEAD']);
      git(['fetch', '--quiet', 'origin', `${ref.baseRef}:refs/remotes/origin/${ref.baseRef}`]);
      const l = localInput(dir, { classify: deps.classify, git, branch: `refs/remotes/origin/${ref.baseRef}` });
      const result = await redGreenAndJudge(dir, l.input, l.base, git(['rev-parse', 'HEAD']), { env: clean, docker: o.docker, deps, git });
      return emit(result, `${what}, cloned into a temporary directory, with red-green`, o, stdout);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    return fail(3, `internal error: ${String(e?.message ?? e).split('\n')[0]}`);
  }
}
