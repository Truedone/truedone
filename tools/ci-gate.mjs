// The truedone CI gate (SEC-01, D22/D27; SEC-03 rework): the contract is never
// edited. main() refuses heads that touch node_modules/ or .proofline/,
// restores proofline.json, .sig and guard/ byte-exact from the origin's main,
// requires guard/owner.pub there, installs the pinned proofline outside the
// checkout by its measured integrity, requires verify-sig to report the owner
// signature matches, runs the pinned gate with --json, and decides on four
// conditions: the contract unchanged versus the merge base, forbidden empty,
// every result outside the signed ci.env_bound for the task a pass, and every
// blocked entry naming only an env-bound id. The env-bound ids and their
// statuses print either way.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const PROOFLINE_PIN = '@optitransfer/proofline@0.2.0-next.1';
export const PROOFLINE_INTEGRITY = 'sha512-BLDEuPH6XGANre/R4PWj98Gn8hZLhDjsyWL5O5En630HRPcz2IhKWMwC2rPzfvtA/USE6YxsfpeMvC83/DG4Qg==';
export const CONTRACT_PATHS = ['proofline.json', 'proofline.json.sig', 'guard'];
const FORBIDDEN_PREFIXES = ['node_modules/', '.proofline/'];

function sh(gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'utf8' }).trim();
}

export function parseTaskId(title) {
  const m = /^([A-Z]+-\d+[A-Z]*):\s/.exec(title ?? '');
  return m ? m[1] : '';
}

export function forbiddenPaths(files) {
  return (files ?? []).filter((f) => FORBIDDEN_PREFIXES.some((p) => f.startsWith(p)));
}

// Main is read live from this repository's own origin, never from a local
// ref that a staging remote can leave stale.
export function resolveMainSha() {
  const url = sh(['config', '--get', 'remote.origin.url']);
  const sha = sh(['ls-remote', url, 'refs/heads/main']).split('\t')[0].trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    console.error(`ci-gate: the origin's main is not a commit: ${url}`);
    process.exit(1);
  }
  return sha;
}

export function listChangedFiles(mainSha) {
  const base = sh(['merge-base', 'HEAD', mainSha]);
  return sh(['diff', '--name-only', base, 'HEAD']).split('\n').filter(Boolean);
}

// Restore the three contract paths byte-exact from the main sha. Nothing is
// written to them and nothing under guard/ is removed, ever.
export function restoreContract(mainSha) {
  sh(['checkout', mainSha, '--', ...CONTRACT_PATHS]);
}

function run(args) {
  return execFileSync(args[0], args.slice(1), { encoding: 'utf8' });
}

// Pure: the installed proofline's integrity from a package-lock, in the hidden
// .packages form, the regular packages form, or the v1 dependencies form.
export function readLockIntegrity(lock) {
  for (const map of [lock['.packages'], lock.packages, lock.dependencies]) {
    for (const [k, v] of Object.entries(map ?? {})) {
      if (k.endsWith('@optitransfer/proofline') && typeof v?.integrity === 'string') return v.integrity;
    }
  }
  return undefined;
}

// Install the pinned proofline outside the checkout and return the absolute
// path of its binary. The install is checked against the pin and the
// published integrity before the gate trusts it.
export function installProofline() {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-pin-'));
  run(['npm', 'install', '--prefix', prefix, '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', PROOFLINE_PIN]);
  const lockPath = path.join(prefix, 'node_modules', '.package-lock.json');
  if (!fs.existsSync(lockPath)) {
    console.error('ci-gate: the pin install wrote no node_modules/.package-lock.json');
    process.exit(1);
  }
  const integrity = readLockIntegrity(JSON.parse(fs.readFileSync(lockPath, 'utf8')));
  if (integrity !== PROOFLINE_INTEGRITY) {
    console.error('ci-gate: the installed proofline integrity does not match the published value');
    process.exit(1);
  }
  return path.join(prefix, 'node_modules', '.bin', 'proofline');
}

// Pure: the four exit conditions over a gate --json object and the signed
// env-bound ids. Returns { ok, reasons, envBound } with reasons as strings.
export function evaluate(gateJson, envBoundIds) {
  const reasons = [];
  const envBound = envBoundIds ?? [];
  const results = gateJson.results ?? [];
  const statuses = results.map((r) => `${r.status} ${r.id}`).join('; ');
  if ((gateJson.forbidden ?? []).length !== 0) {
    reasons.push(`forbidden is not empty: ${gateJson.forbidden.map((f) => `${f.rule}@${f.file}`).join(', ')}`);
  }
  for (const r of results) {
    if (!envBound.includes(r.id) && r.status !== 'pass') {
      reasons.push(`${r.id} is ${r.status} and not env-bound`);
    }
  }
  for (const b of gateJson.blocked ?? []) {
    const ids = [...String(b).matchAll(/[\w-]*-AC[\w-]*/g)].map((m) => m[0]);
    if (ids.length === 0 || !ids.every((id) => envBound.includes(id))) {
      reasons.push(`blocked names more than env-bound ids: ${b}`);
    }
  }
  return { ok: reasons.length === 0, reasons, envBoundText: `${envBound.join(', ') || '(none)'} | ${statuses || '(no results)'}` };
}

export async function main() {
  const task = parseTaskId(process.env.PR_TITLE ?? '');
  if (!task) {
    console.error(`ci-gate: no task id from the PR title ${JSON.stringify(process.env.PR_TITLE ?? '')}`);
    process.exit(1);
  }
  const mainSha = resolveMainSha();
  const banned = forbiddenPaths(listChangedFiles(mainSha));
  if (banned.length !== 0) {
    console.error(`ci-gate: the pull request changes ${banned.join(', ')}; that is refused`);
    process.exit(1);
  }
  // The key is required at main before anything is restored from it; a main without guard/ fails here, not in git.
  try { sh(['cat-file', '-e', `${mainSha}:guard/owner.pub`]); } catch { console.error(`ci-gate: guard/owner.pub is missing at main ${mainSha.slice(0, 8)}`); process.exit(1); }
  // The contract is never edited: restore byte-exact, verify, gate.
  restoreContract(mainSha);
  const proof = installProofline();
  let vs = '';
  let vsExit = 0;
  try { vs = run([proof, 'contract', 'verify-sig']); } catch (e) {
    if (e.status === undefined) { console.error(`ci-gate: verify-sig failed to run: ${e.message}`); process.exit(1); }
    vsExit = e.status;
    vs = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  if (vsExit !== 0 || !/owner signature matches/.test(vs)) {
    console.error('ci-gate: verify-sig did not report: owner signature matches');
    process.exit(1);
  }
  const base = sh(['merge-base', 'HEAD', mainSha]);
  const touched = sh(['diff', '--name-only', base, 'HEAD', '--', ...CONTRACT_PATHS]).split('\n').filter(Boolean);
  if (touched.length !== 0) {
    console.error(`ci-gate: the contract changed versus base: ${touched.join(', ')}`);
    process.exit(1);
  }
  const contract = JSON.parse(fs.readFileSync('proofline.json', 'utf8'));
  const envBound = contract.ci?.env_bound?.[task] ?? [];
  let out = '';
  try {
    out = run([proof, 'gate', task, '--skip-pushed', '--fresh', '--base', base, '--json']);
  } catch (e) {
    out = e.stdout ?? '';
    if (!out.trim()) { console.error(`ci-gate: the gate produced no json: ${e.message}`); process.exit(1); }
  }
  const brace = out.indexOf('{');
  if (brace < 0) { console.error(`ci-gate: the gate produced no json object: ${out.slice(0, 200)}`); process.exit(1); }
  const gateJson = JSON.parse(out.slice(brace));
  const verdict = evaluate(gateJson, envBound);
  console.log(`ci-gate: env-bound ${verdict.envBoundText}`);
  if (!verdict.ok) {
    for (const r of verdict.reasons) console.error(`ci-gate: ${r}`);
    process.exit(1);
  }
  console.log('ci-gate: the four conditions hold');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace('file://', ''))) {
  // Any git or install failure fails the gate closed, with one line instead of a stack trace.
  try { await main(); } catch (e) { console.error(`ci-gate: ${String(e?.message ?? e).split('\n')[0]}`); process.exit(1); }
}
