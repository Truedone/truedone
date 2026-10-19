// The local change for npx truedone with no target (CLI-01, D6): the current branch and working tree against the
// merge-base with the default branch. The default branch is the target of origin/HEAD, else main, else master. The
// input has the shape of core's analyse input: the files as the PR files API would list them (tracked changes from
// git diff -M against the merge-base, plus untracked files as added), each with its patch, and base and head contents
// for the files core classifies as test, setup, runner config, workflow or truedone config. git runs with an argv
// array, never through a shell, and by default with only the names in GIT_ENV from the environment (PLG-12); the
// command line hands it gitEnv of its own environment (CLI-10). The truedone plugin's Stop hook (PLG-01) builds its
// input with the same localInput.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONTENT, LIMITS } from './constants.mjs';

export class NoRepository extends Error {
  constructor(why) { super(why); this.name = 'NoRepository'; }
}

// The names git needs to read a local repository and the user's own git configuration (PLG-12), and on Windows the
// three it needs to start. git reads only the local repository, so a token in the environment (GITHUB_TOKEN, GH_TOKEN,
// an API key) has no use there and is left out.
const GIT_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TZ', 'XDG_CONFIG_HOME',
  'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CEILING_DIRECTORIES'];
const GIT_ENV_WINDOWS = ['SYSTEMROOT', 'COMSPEC', 'PATHEXT'];

// the listed names that are set in source, by default this process's environment; a name that is not set is left out
export function gitEnv(source = process.env) {
  const env = {};
  for (const name of process.platform === 'win32' ? [...GIT_ENV, ...GIT_ENV_WINDOWS] : GIT_ENV) {
    if (source[name] !== undefined) env[name] = source[name];
  }
  return env;
}

// git(args, { raw, quiet }) runs git in cwd and returns its stdout, trimmed unless raw. On a failure it throws, or with
// quiet it returns null. With no env, git gets gitEnv(), read when makeGit is called; a caller that passes env decides.
export function makeGit(cwd, env = gitEnv()) {
  return (args, { raw = false, quiet = false } = {}) => {
    try {
      const out = execFileSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      return raw ? out : out.trim();
    } catch (e) {
      if (quiet) return null;
      throw e;
    }
  };
}

const STATUS = { A: 'added', M: 'modified', D: 'removed', R: 'renamed', C: 'added', T: 'modified', U: 'modified' };

function defaultBranch(git) {
  const head = git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { quiet: true });
  if (head) return head;
  for (const b of ['main', 'master']) if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], { quiet: true })) return `refs/heads/${b}`;
  return null;
}

// git diff's sections, keyed by the path on their b/ side, with the hunks only (the PR files API's patch field)
function patches(text) {
  const out = new Map();
  for (const part of text.split(/^(?=diff --git )/m)) {
    if (!part.startsWith('diff --git ')) continue;
    const lines = part.replace(/\n$/, '').split('\n');
    let file = null;
    for (const l of lines) {
      if (l.startsWith('+++ b/')) file = l.slice(6);
      else if (l.startsWith('rename to ')) file ??= l.slice(10);
    }
    if (file === null) { const m = lines.find((l) => l.startsWith('--- a/')); if (m) file = m.slice(6); }
    const at = lines.findIndex((l) => l.startsWith('@@'));
    if (file !== null && at >= 0) out.set(file, lines.slice(at).join('\n'));
  }
  return out;
}

// An untracked file's patch, as the PR files API gives an added file's
function addedPatch(body) {
  if (body.includes('\0')) return undefined;
  const lines = body.split('\n');
  const missingEol = !body.endsWith('\n');
  if (!missingEol) lines.pop();
  if (!lines.length) return undefined;
  const head = `@@ -0,0 +1${lines.length === 1 ? '' : `,${lines.length}`} @@`;
  return [head, ...lines.map((l) => `+${l}`), ...(missingEol ? ['\\ No newline at end of file'] : [])].join('\n');
}

// -> { input, base, branch }: analyse's input, the merge-base sha, and the branch ref it was taken against: the
// default branch, or the branch given (for a PR, the branch it targets, D6)
export function localInput(root, { classify, git = makeGit(root), branch: against = null }) {
  if (git(['rev-parse', '--is-inside-work-tree'], { quiet: true }) !== 'true') throw new NoRepository(`${root} is not inside a git repository`);
  const top = git(['rev-parse', '--show-toplevel']);
  const branch = against ?? defaultBranch(git);
  if (!branch) throw new NoRepository('no default branch: origin/HEAD, main and master are all missing');
  const base = git(['merge-base', 'HEAD', branch], { quiet: true });
  if (!base) throw new NoRepository(`HEAD has no merge-base with ${branch}`);
  const files = [];
  const listed = git(['-c', 'core.quotePath=false', 'diff', '-M', '--name-status', '-z', base], { raw: true }).split('\0');
  for (let i = 0; i + 1 < listed.length;) {
    const code = listed[i][0];
    if (code === 'R' || code === 'C') {
      const f = { path: listed[i + 2], status: STATUS[code] };
      if (code === 'R') f.previous_path = listed[i + 1];
      files.push(f);
      i += 3;
    } else {
      files.push({ path: listed[i + 1], status: STATUS[code] ?? 'modified' });
      i += 2;
    }
  }
  const byPath = patches(git(['-c', 'core.quotePath=false', 'diff', '-M', '-U3', '--no-color', '--no-ext-diff', base], { raw: true }));
  for (const f of files) if (byPath.has(f.path)) f.patch = byPath.get(f.path);
  for (const u of git(['-C', top, 'ls-files', '--others', '--exclude-standard', '-z'], { raw: true }).split('\0').filter(Boolean)) {
    const f = { path: u, status: 'added' };
    const patch = addedPatch(fs.readFileSync(path.join(top, u), 'utf8'));
    if (patch !== undefined) f.patch = patch;
    files.push(f);
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const wanted = files.filter((f) => CONTENT.has(classify(f.path)) || (f.previous_path && CONTENT.has(classify(f.previous_path)))).slice(0, LIMITS.fetched);
  for (const f of wanted) {
    if (f.status !== 'added') {
      const b = git(['show', `${base}:${f.previous_path ?? f.path}`], { raw: true, quiet: true });
      if (b !== null) f.base = b;
    }
    if (f.status !== 'removed') {
      try { f.head = fs.readFileSync(path.join(top, f.path), 'utf8'); } catch { /* gone from the working tree */ }
    }
  }
  const title = git(['log', '-1', '--format=%s'], { quiet: true }) ?? '';
  const login = git(['config', 'user.name'], { quiet: true }) ?? '';
  return { input: { files, pr: { title, body: '', author: { login, type: 'User' } }, limits: LIMITS }, base, branch };
}
