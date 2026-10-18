// node tools/readme-status.mjs [--at <rev>] [--check] (README-02): the Status section of README.md, written from two
// sources only, both read at one main commit: the signed contract (proofline.json) and main's first-parent history. A
// task is on main when a merge commit there reads "Merge pull request #n from <owner>/<id in lower case>", the owner
// mgillr before the move to the Truedone organisation and Truedone after it (D36), or a direct
// commit's subject starts with "<ID>: ". truedone is pre-release until a docs/releases/*.md at that commit has the line
// "Decision: GO". The section names the commit it describes, so it stays true for that commit after main moves on.
// Plain, it writes the section for --at (default origin/main) between the two marker lines. --check writes nothing and
// exits 1 unless the named commit is an ancestor of HEAD and the section is byte for byte what this script writes for
// it. No dependencies, no network.
// README-03: the "Ways to use it" table's Status column and the line above it, between their own marker lines, come from
// packages/web/lib/release.mjs, the release state the site reads: the site Live, each released surface Released, every
// other Not released yet. The plain run writes that block too, and --check fails when it is not what release.mjs gives.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BEGIN = '<!-- status: written by node tools/readme-status.mjs from the contract and main; do not edit -->';
export const END = '<!-- status: end -->';
export const WAYS_BEGIN = '<!-- ways: written by node tools/readme-status.mjs from packages/web/lib/release.mjs; do not edit -->';
export const WAYS_END = '<!-- ways: end -->';
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
    const m = s.match(/^Merge pull request #\d+ from (?:mgillr|Truedone)\/([a-z0-9-]+)$/);
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

// each table row by its Surface cell, in the table's order, and how the line above names the surfaces
const ROWS = [['[truedone.pages.dev]', 'site'], ['`npx truedone`', 'cli'], ['Claude Code plugin', 'plugin'], ['GitHub App', 'app'], ['GitHub Action', 'action']];
const NAMES = { cli: 'the command line', plugin: 'the plugin', app: 'the App', action: 'the action' };
const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

// release.mjs's RELEASED, read as the plain literal it is: anything else there is an error, not a guess
export function readReleased(text) {
  const m = text.match(/^export const RELEASED = \{([^}]*)\};$/m);
  if (!m) throw new Error('packages/web/lib/release.mjs has no plain RELEASED literal');
  const out = {};
  for (const part of m[1].split(',')) {
    const e = part.trim().match(/^(cli|action|app|plugin): (true|false)$/);
    if (!e) throw new Error(`packages/web/lib/release.mjs: "${part.trim()}" is not <surface>: true or false`);
    out[e[1]] = e[2] === 'true';
  }
  return out;
}

// the block between the ways markers: the line above the table, then the table with its Status column rewritten
export function ways(block, released) {
  const table = block.split('\n').filter((l) => l.startsWith('|'));
  const seen = [];
  const rows = table.map((line, i) => {
    if (i < 2) return line;
    const cells = line.slice(2, -2).split(' | ');
    const key = ROWS.find(([prefix]) => cells[0]?.startsWith(prefix))?.[1];
    if (cells.length !== 3 || !key) throw new Error(`the Ways to use it row "${line.slice(0, 40)}" is not one of the surfaces`);
    seen.push(key);
    return `| ${cells[0]} | ${cells[1]} | ${key === 'site' ? 'Live' : released[key] ? 'Released' : 'Not released yet'} |`;
  });
  const missing = ROWS.map(([, k]) => k).filter((k) => !seen.includes(k));
  if (missing.length) throw new Error(`the Ways to use it table has no row for ${missing.join(', ')}`);
  const order = ROWS.map(([, k]) => k).filter((k) => k !== 'site');
  const now = order.filter((k) => released[k]).map((k) => NAMES[k]);
  const later = order.filter((k) => !released[k]).map((k) => NAMES[k]);
  const lead = [
    `The site is live: truedone.pages.dev checks any public pull request now${now.length ? `, and ${and(now)} ${now.length > 1 ? 'are' : 'is'} released` : ''}.`,
    ...(later.length ? [`${and(later)[0].toUpperCase()}${and(later).slice(1)} ${later.length > 1 ? 'come' : 'comes'} with the first release, planned in [docs/spec.md](docs/spec.md), each after its release's gates pass.`] : []),
  ].join(' ');
  return `\n${lead}\n\n${rows.join('\n')}\n`;
}

// the README with its ways block as release.mjs gives it, or null when the README has no ways block
function waysOf(readme, cwd) {
  const i = readme.indexOf(WAYS_BEGIN), j = readme.indexOf(WAYS_END);
  if (i < 0 && j < 0) return null;
  if (i < 0 || j < i) throw new Error('README.md has an unmatched ways marker');
  const released = readReleased(fs.readFileSync(path.join(cwd, 'packages/web/lib/release.mjs'), 'utf8'));
  const current = readme.slice(i + WAYS_BEGIN.length, j);
  return { current, want: ways(current, released), at: [i + WAYS_BEGIN.length, j] };
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
  let w;
  try { w = waysOf(readme, cwd); } catch (e) { console.error(e.message); return 1; }
  if (!args.includes('--check')) {
    const k = args.indexOf('--at');
    const rev = k < 0 ? 'origin/main' : args[k + 1];
    if (!rev) { console.error('--at needs a revision'); return 1; }
    const want = section(readAt(rev, cwd));
    let out = readme.slice(0, i) + want + readme.slice(j + END.length);
    if (w) { const again = waysOf(out, cwd); out = out.slice(0, again.at[0]) + again.want + out.slice(again.at[1]); }
    fs.writeFileSync(file, out);
    console.log(JSON.stringify({ wrote: 'README.md', at: want.match(/^At main ([0-9a-f]{12}) /m)[1] }));
    return 0;
  }
  const named = current.match(/^At main ([0-9a-f]{12}) /m)?.[1];
  if (!named) { console.error('the status block names no main commit'); return 1; }
  let sha;
  try { sha = execFileSync('git', ['rev-parse', '--verify', `${named}^{commit}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { console.error(`${named} is not a commit in this repository`); return 1; }
  try { execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd, stdio: 'ignore' }); } catch { console.error(`${named} is not an ancestor of HEAD`); return 1; }
  if (section(readAt(sha, cwd)) !== current) { console.error(`the status block is not what node tools/readme-status.mjs --at ${named} writes`); return 1; }
  if (w && w.current !== w.want) { console.error('the Ways to use it block is not what packages/web/lib/release.mjs gives: run node tools/readme-status.mjs'); return 1; }
  console.log(JSON.stringify({ checked: 'README.md', at: named }));
  return 0;
}

// real paths on both sides: Node resolves symlinks for import.meta.url but keeps argv[1] as typed (GUARD-01, #115)
if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = run(process.argv.slice(2), fileURLToPath(new URL('..', import.meta.url)));
}
