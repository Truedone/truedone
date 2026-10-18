// node tools/readme-status.mjs [--at <rev>] [--check] (README-02): the Status section of README.md, written from two
// sources only, both read at one main commit: the signed contract (proofline.json) and main's first-parent history. A
// task is on main when a merge commit there reads "Merge pull request #n from mgillr/<id in lower case>", or a direct
// commit's subject starts with "<ID>: ". truedone is pre-release until a docs/releases/*.md at that commit has the line
// "Decision: GO". The section names the commit it describes, so it stays true for that commit after main moves on.
// Plain, it writes the section for --at (default origin/main) between the two marker lines. --check writes nothing and
// exits 1 unless the named commit is an ancestor of HEAD and the section is byte for byte what this script writes for
// it. No dependencies, no network.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BEGIN = '<!-- status: written by node tools/readme-status.mjs from the contract and main; do not edit -->';
export const END = '<!-- status: end -->';
// the surfaces first, in the order of "Ways to use it"; a prefix not listed goes to OTHER
const GROUPS = [
  ['truedone.pages.dev', ['WEB']],
  ['`npx truedone`', ['CLI']],
  ['Claude Code plugin', ['PLG']],
  ['GitHub App', ['APP']],
  ['GitHub Action', ['ACT']],
  ['The engine they share', ['CORE', 'RUN', 'JUDGE']],
  ['Measurement gates and the index', ['GATE', 'PRE', 'IDX']],
  ['Releases', ['REL']],
];
const OTHER = 'Repository, CI, deploys and docs';

export function landed(subjects, ids) {
  const on = new Set();
  for (const s of subjects) {
    const m = s.match(/^Merge pull request #\d+ from mgillr\/([a-z0-9-]+)$/);
    const d = s.match(/^([A-Z][A-Z0-9]*-[A-Z0-9]+): /);
    const id = m ? m[1].toUpperCase() : d ? d[1] : null;
    if (id && ids.includes(id)) on.add(id);
  }
  return on;
}

export function section({ sha, date, contract, subjects, releases }) {
  const ids = contract.tasks.map((t) => t.id);
  const on = landed(subjects, ids);
  const go = Object.keys(releases).filter((f) => /^Decision: GO$/m.test(releases[f])).sort();
  const group = (id) => (GROUPS.find(([, p]) => p.includes(id.split('-')[0])) || [OTHER])[0];
  const rows = [...GROUPS.map(([g]) => g), OTHER].flatMap((g) => {
    const all = ids.filter((id) => group(id) === g);
    const done = all.filter((id) => on.has(id));
    return all.length ? [`- ${g}: ${done.length} of ${all.length}${done.length ? ` (${done.join(', ')})` : ''}.`] : [];
  });
  return [
    BEGIN,
    go.length ? `Released: ${go.join(', ')} ${go.length === 1 ? 'says' : 'say'} "Decision: GO".`
      : 'truedone is pre-release: the npm package, the action, the plugin and the app have no published release, and the release decisions stay open until a record in docs/releases says "Decision: GO".',
    '',
    `At main ${sha.slice(0, 12)} (${date}), ${on.size} of the ${ids.length} tasks in the signed contract, [proofline.json](proofline.json), are on main:`,
    '',
    ...rows,
    END,
  ].join('\n');
}

export function readAt(rev, cwd) {
  // a caller's log.showSignature would add lines to git log's output
  const git = (...a) => execFileSync('git', ['-c', 'log.showSignature=false', ...a], { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
  const sha = git('rev-parse', '--verify', `${rev}^{commit}`).trim();
  const date = git('log', '-1', '--format=%cs', sha).trim();
  const contract = JSON.parse(git('show', `${sha}:proofline.json`));
  const subjects = git('log', '--first-parent', '--format=%s', sha).split('\n').filter(Boolean);
  const names = git('ls-tree', '--name-only', sha, 'docs/releases/').split('\n').filter((f) => f.endsWith('.md'));
  const releases = Object.fromEntries(names.map((f) => [f, git('show', `${sha}:${f}`)]));
  return { sha, date, contract, subjects, releases };
}

// returns the exit code; messages go to stdout (one JSON line) or stderr
export function run(args, cwd) {
  const file = path.join(cwd, 'README.md');
  const readme = fs.readFileSync(file, 'utf8');
  const i = readme.indexOf(BEGIN), j = readme.indexOf(END);
  if (i < 0 || j < i) { console.error('README.md has no status block between the two marker lines'); return 1; }
  const current = readme.slice(i, j + END.length);
  if (!args.includes('--check')) {
    const k = args.indexOf('--at');
    const rev = k < 0 ? 'origin/main' : args[k + 1];
    if (!rev) { console.error('--at needs a revision'); return 1; }
    const want = section(readAt(rev, cwd));
    fs.writeFileSync(file, readme.slice(0, i) + want + readme.slice(j + END.length));
    console.log(JSON.stringify({ wrote: 'README.md', at: want.match(/^At main ([0-9a-f]{12}) /m)[1] }));
    return 0;
  }
  const named = current.match(/^At main ([0-9a-f]{12}) /m)?.[1];
  if (!named) { console.error('the status block names no main commit'); return 1; }
  let sha;
  try { sha = execFileSync('git', ['rev-parse', '--verify', `${named}^{commit}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { console.error(`${named} is not a commit in this repository`); return 1; }
  try { execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd, stdio: 'ignore' }); } catch { console.error(`${named} is not an ancestor of HEAD`); return 1; }
  if (section(readAt(sha, cwd)) !== current) { console.error(`the status block is not what node tools/readme-status.mjs --at ${named} writes`); return 1; }
  console.log(JSON.stringify({ checked: 'README.md', at: named }));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2), fileURLToPath(new URL('..', import.meta.url)));
}
