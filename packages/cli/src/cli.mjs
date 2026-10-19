// npx truedone (CLI-01, PV-L02; docs/spec.md, cli and plugin). main(argv, deps) runs one command and returns its exit
// code: 0 when a verdict is produced, 1 when --fail-on matches it, 2 for a usage error, 3 for an internal error.
//   truedone                       the current branch and working tree against the merge-base with the default branch
//   truedone <PR link|owner/repo#n> the PR through the GitHub API, with GITHUB_TOKEN if set; nothing is cloned
//   --json                         print core's truedone.verdict/1 result
//   --fail-on <verdicts>           exit 1 when the verdict is one of these comma-separated ids
//   init [--global]                add the agent snippet (src/init.mjs); --global to the developer's own agent files (D38)
//   --pr-line                      print one line for a pull request description, with the verdict's page link (D38)
//   report <PR link|owner/repo#n>  print the filled wrong-verdict form link; nothing is sent (src/report.mjs, D39)
//   mcp                            serve the check over the Model Context Protocol on stdio (src/mcp.mjs, MCP-01)
//   --run [--docker] [--yes]        add red-green (src/run.mjs, CLI-03); on someone else's PR only after a typed yes or --yes
//   --help, -h                     print the usage and exit 0, whatever else is given
//   --version                      print "truedone <version> (preview)" and exit 0, whatever else but --help is given
// deps: { analyse, classify, fetch, cwd, env, stdout, stderr, git? }, and for --run { judge, detect, redGreen,
// restorePending, stdin, makeGit?, spawn?, dockerOnPath?, cloneUrl?, tmpdir? }. core's analyse and classify come in as deps, so
// the tests run main in-process; src/bin.mjs passes the bundled core. PR mode starts no process. git gets gitEnv(env),
// the names it needs from env and no credential (CLI-10, as PLG-12 gives the plugin's git).
import { init, initGlobal } from './init.mjs';
import { parseTarget } from './target.mjs';
import { loadPR, fetchReleases, RateLimited, GitHubError, HeadUnreadable } from './github.mjs';
import { localInput, makeGit, gitEnv, NoRepository } from './local.mjs';
import { emit, VERDICTS } from './output.mjs';
import { reportLink } from './report.mjs';
import { serveMcp } from './mcp.mjs';
import { runMode } from './run.mjs';
import { VERSION_LINE } from './version.mjs';

const USAGE = 'usage: npx truedone [<PR link> | <owner/repo#n>] [--run [--docker] [--yes]] [--json | --pr-line] [--fail-on <verdict>[,<verdict>...]]\n       npx truedone init [--global]\n       npx truedone report <PR link | owner/repo#n>\n       npx truedone mcp\n       npx truedone --version';
// The help ends with the version line, so a reader of --help knows this is the preview (D35).
const HELP = `${USAGE}\n\n${VERSION_LINE}: a preview, released ahead of the launch.`;
class UsageError extends Error {}

function parse(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  if (argv.includes('--version')) return { version: true };
  const o = { json: false, failOn: null, init: false, target: null, run: false, docker: false, yes: false, prLine: false, global: false, report: false, mcp: false };
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
    else if (a === '--pr-line') o.prLine = true;
    else if (a === '--global') o.global = true;
    else if (a === '--docker') o.docker = true;
    else if (a === '--yes') o.yes = true;
    else if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`);
    else rest.push(a);
  }
  if (o.docker && !o.run) throw new UsageError('--docker runs red-green in a container, so it needs --run');
  if (o.yes && !o.run) throw new UsageError('--yes answers --run\'s question, so it needs --run');
  if (o.prLine && o.json) throw new UsageError('--pr-line and --json each choose the output; give one');
  if (o.global && rest[0] !== 'init') throw new UsageError('--global is for init: npx truedone init --global');
  if (rest[0] === 'init') {
    if (rest.length > 1 || o.json || o.failOn || o.run || o.prLine) throw new UsageError('init takes only --global');
    o.init = true;
  } else if (rest[0] === 'mcp') {
    if (rest.length > 1 || o.json || o.failOn || o.run || o.prLine) throw new UsageError('mcp takes no other arguments');
    o.mcp = true;
  } else if (rest[0] === 'report') {
    if (rest.length !== 2 || o.json || o.failOn || o.run || o.prLine) throw new UsageError('report takes one PR link or owner/repo#n and nothing else');
    o.report = true;
    o.target = parseTarget(rest[1]);
    if (!o.target) throw new UsageError(`${rest[1]} is not a PR link or owner/repo#n`);
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
      const log = (s) => stdout.write(`${s}\n`);
      if (o.global) {
        if (!env.HOME) return fail(2, 'init --global writes to your home directory, and HOME is not set');
        initGlobal(env.HOME, { log });
      } else init(cwd, { log });
      return 0;
    }
    if (o.mcp) return await serveMcp({ stdin: deps.stdin ?? process.stdin, stdout, cwd, check: ({ target, dir }) => staticVerdict({ target, dir }, deps) });
    if (o.run) return await runMode(o, deps);
    const v = await staticVerdict({ target: o.target, dir: cwd }, deps);
    if (o.report) {
      stdout.write(`Open this link to report the verdict as wrong; nothing has been sent:\n${reportLink({ target: o.target, head: v.head, base: v.base, result: v.result })}\n`);
      return 0;
    }
    return emit(v.result, v.what, o, stdout);
  } catch (e) {
    if (e instanceof Refused) return fail(e.code, e.message);
    return fail(3, `internal error: ${String(e?.message ?? e).split('\n')[0]}`);
  }
}

// A refusal with its exit code and message, from staticVerdict
export class Refused extends Error {
  constructor(code, message) { super(message); this.name = 'Refused'; this.code = code; }
}

// The static verdict of a pull request (target) or of a directory's branch and working tree (dir), for the default command,
// --pr-line and report: { result, what, head, base }. A missing PR, a used-up rate limit or a directory that is not a
// repository throws Refused with main's exit code.
export async function staticVerdict({ target = null, dir }, deps) {
  const { analyse, classify, fetch = globalThis.fetch, env = process.env, stderr } = deps;
  const token = env.GITHUB_TOKEN || null;
  let input, what, head = null, base = null;
  if (target) {
    what = `${target.owner}/${target.repo}#${target.number}`;
    try {
      ({ input, head, base } = await loadPR(target, { fetch, classify, token }));
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) throw new Refused(2, `GitHub has no pull request ${what}, or it is not public`);
      if (e instanceof RateLimited) throw new Refused(3, 'GitHub\'s API rate limit is used up; set GITHUB_TOKEN to read with your own limit');
      // CORE-14: a head file GitHub does not serve gives no verdict, and the error names it
      if (e instanceof HeadUnreadable) throw new Refused(3, `the head of ${e.path} could not be read: GitHub answered ${e.answer}`);
      throw e;
    }
  } else {
    const git = deps.git ?? makeGit(dir, gitEnv(env));
    try {
      const l = localInput(dir, { classify, git });
      input = l.input;
      what = `${git(['rev-parse', '--abbrev-ref', 'HEAD'], { quiet: true }) ?? 'HEAD'} and the working tree, against ${l.base.slice(0, 12)}`;
    } catch (e) {
      if (e instanceof NoRepository) throw new Refused(2, e.message);
      throw e;
    }
  }
  // D18: a change to a workflow is judged against the published action releases
  if (touchesWorkflow(input, classify)) {
    try { input.releases = await fetchReleases({ fetch, token }); } catch (e) {
      stderr?.write(`truedone: the published action releases could not be read (${e.message}); a re-pinned step is judged without them\n`);
    }
  }
  return { result: analyse(input), what, head, base };
}
