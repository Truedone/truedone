// npx truedone (CLI-01, PV-L02; docs/spec.md, cli and plugin). main(argv, deps) runs one command and returns its exit
// code: 0 when a verdict is produced, 1 when --fail-on matches it, 2 for a usage error, 3 for an internal error.
//   truedone                       the current branch and working tree against the merge-base with the default branch
//   truedone <PR link|owner/repo#n> the PR through the GitHub API, with GITHUB_TOKEN if set; nothing is cloned
//   --json                         print core's truedone.verdict/1 result
//   --fail-on <verdicts>           exit 1 when the verdict is one of these comma-separated ids
//   init                           add the agent snippet (src/init.mjs)
//   --run [--docker] [--yes]        add red-green (src/run.mjs, CLI-03); on someone else's PR only after a typed yes or --yes
//   --help, -h                     print the usage and exit 0, whatever else is given
//   --version                      print "truedone <version> (preview)" and exit 0, whatever else but --help is given
// deps: { analyse, classify, fetch, cwd, env, stdout, stderr, git? }, and for --run { judge, detect, redGreen,
// restorePending, stdin, makeGit?, spawn?, dockerOnPath?, cloneUrl?, tmpdir? }. core's analyse and classify come in as deps, so
// the tests run main in-process; src/bin.mjs passes the bundled core. PR mode starts no process.
import { init } from './init.mjs';
import { parseTarget } from './target.mjs';
import { loadPR, fetchReleases, RateLimited, GitHubError } from './github.mjs';
import { localInput, makeGit, NoRepository } from './local.mjs';
import { readable, SCHEMA, VERDICTS } from './output.mjs';
import { runMode } from './run.mjs';
import { VERSION_LINE } from './version.mjs';

const USAGE = 'usage: npx truedone [<PR link> | <owner/repo#n>] [--run [--docker] [--yes]] [--json] [--fail-on <verdict>[,<verdict>...]]\n       npx truedone init\n       npx truedone --version';
// The help ends with the version line, so a reader of --help knows this is the preview (D35).
const HELP = `${USAGE}\n\n${VERSION_LINE}: a preview, released ahead of the launch.`;
class UsageError extends Error {}

function parse(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  if (argv.includes('--version')) return { version: true };
  const o = { json: false, failOn: null, init: false, target: null, run: false, docker: false, yes: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--fail-on' || a.startsWith('--fail-on=')) {
      const v = a === '--fail-on' ? argv[++i] : a.slice('--fail-on='.length);
      if (!v || v.startsWith('-')) throw new UsageError('--fail-on needs a comma-separated list of verdicts');
      const list = v.split(',').map((s) => s.trim()).filter(Boolean);
      const bad = list.filter((x) => !(x in VERDICTS));
      if (bad.length || !list.length) throw new UsageError(`--fail-on: unknown verdict ${bad.join(', ') || v} (the verdicts are ${Object.keys(VERDICTS).join(', ')})`);
      o.failOn = new Set(list);
    } else if (a === '--run') o.run = true;
    else if (a === '--docker') o.docker = true;
    else if (a === '--yes') o.yes = true;
    else if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`);
    else rest.push(a);
  }
  if (o.docker && !o.run) throw new UsageError('--docker runs red-green in a container, so it needs --run');
  if (o.yes && !o.run) throw new UsageError('--yes answers --run\'s question, so it needs --run');
  if (rest[0] === 'init') {
    if (rest.length > 1 || o.json || o.failOn || o.run) throw new UsageError('init takes no other arguments');
    o.init = true;
  } else if (rest.length > 1) throw new UsageError(`one target at most; got ${rest.join(' ')}`);
  else if (rest.length === 1) {
    o.target = parseTarget(rest[0]);
    if (!o.target) throw new UsageError(`${rest[0]} is not a PR link or owner/repo#n`);
  }
  return o;
}

const touchesWorkflow = (input, classify) => input.files.some((f) => classify(f.path) === 'workflow' || (f.previous_path && classify(f.previous_path) === 'workflow'));

export async function main(argv, deps) {
  const { analyse, classify, fetch = globalThis.fetch, cwd = process.cwd(), env = process.env, stdout, stderr } = deps;
  const fail = (code, msg) => { stderr.write(`truedone: ${msg}\n`); return code; };
  let o;
  try { o = parse(argv); } catch (e) {
    if (e instanceof UsageError) return fail(2, `${e.message}\n${USAGE}`);
    throw e;
  }
  if (o.help) {
    stdout.write(`${HELP}\n`);
    return 0;
  }
  if (o.version) {
    stdout.write(`${VERSION_LINE}\n`);
    return 0;
  }
  try {
    if (o.init) {
      init(cwd, { log: (s) => stdout.write(`${s}\n`) });
      return 0;
    }
    if (o.run) return await runMode(o, deps);
    const token = env.GITHUB_TOKEN || null;
    let input, what;
    if (o.target) {
      const t = o.target;
      what = `${t.owner}/${t.repo}#${t.number}`;
      try {
        ({ input } = await loadPR(t, { fetch, classify, token }));
      } catch (e) {
        if (e instanceof GitHubError && e.status === 404) return fail(2, `GitHub has no pull request ${what}, or it is not public`);
        if (e instanceof RateLimited) return fail(3, 'GitHub\'s API rate limit is used up; set GITHUB_TOKEN to read with your own limit');
        throw e;
      }
    } else {
      const git = deps.git ?? makeGit(cwd, env);
      try {
        const l = localInput(cwd, { classify, git });
        input = l.input;
        what = `${git(['rev-parse', '--abbrev-ref', 'HEAD'], { quiet: true }) ?? 'HEAD'} and the working tree, against ${l.base.slice(0, 12)}`;
      } catch (e) {
        if (e instanceof NoRepository) return fail(2, e.message);
        throw e;
      }
    }
    // D18: a change to a workflow is judged against the published action releases
    if (touchesWorkflow(input, classify)) {
      try { input.releases = await fetchReleases({ fetch, token }); } catch (e) {
        stderr.write(`truedone: the published action releases could not be read (${e.message}); a re-pinned step is judged without them\n`);
      }
    }
    const result = analyse(input);
    if (result?.schema !== SCHEMA) throw new Error(`core returned no ${SCHEMA} result`);
    stdout.write(o.json ? `${JSON.stringify(result)}\n` : readable(result, what));
    return o.failOn?.has(result.verdict) ? 1 : 0;
  } catch (e) {
    return fail(3, `internal error: ${String(e?.message ?? e).split('\n')[0]}`);
  }
}
