#!/usr/bin/env node
// BENCH-01: the detection benchmark. Nine labelled cases under tools/test/fixtures/detect/<case>/ (case.json, a base/ tree
// and a head/ tree) are run through the real product: the static core (packages/core/core.mjs analyse) on the base and
// head texts, and, where the head's tests changed, the red-green runner and judge (packages/core/run, core judge) on a
// copy of the head tree, with the changed source swapped to base as the action does. Beside each verdict the bench
// records what baseline CI says: whether the head tree's own tests pass. The results go to docs/bench/detection.json
// and docs/bench/detection.md, in a fixed order with no timings, so a fresh run equals the committed files byte for
// byte. `--check` exits 0 only when every case meets its expected outcome: a tampering or no-evidence case flagged, the
// legitimate case carrying no tampered, review, no_evidence or could_not_run verdict, and the by-design misses reported
// as not detected with their reason. The check is a contract criterion, so CI runs it on every change.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyse, judge } from '../../packages/core/core.mjs';
import { detect } from '../../packages/core/run/detect.mjs';
import { redGreen } from '../../packages/core/run/run.mjs';
import { classify } from '../../packages/core/src/classify.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const FIXTURES = path.join(ROOT, 'tools/test/fixtures/detect');
export const SCHEMA = 'truedone.detection/1';
// the verdicts that surface a weakness to a maintainer
export const FLAGS = new Set(['tampered', 'review', 'no_evidence', 'could_not_run']);

function walk(dir, prefix = '') {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(abs).isDirectory()) Object.assign(out, walk(abs, rel));
    else out[rel] = fs.readFileSync(abs, 'utf8');
  }
  return out;
}

// the pull request's files as the App and the action see them: path, status, base text and head text
export function filesOf(caseDir) {
  const base = walk(path.join(caseDir, 'base'));
  const head = walk(path.join(caseDir, 'head'));
  const paths = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  return paths
    .filter((p) => base[p] !== head[p])
    .map((p) => ({ path: p, status: !(p in base) ? 'added' : !(p in head) ? 'removed' : 'modified', base: base[p] ?? '', head: head[p] ?? '' }));
}

export function readCases(dir = FIXTURES) {
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'case.json'))).sort().map((d) => ({
    ...JSON.parse(fs.readFileSync(path.join(dir, d, 'case.json'), 'utf8')),
    dir: path.join(dir, d),
  }));
}

function copyTree(src, into) {
  fs.cpSync(src, into, { recursive: true });
  const made = spawnSync('git', ['init', '-q'], { cwd: into, encoding: 'utf8' });
  if (made.status !== 0) throw new Error(`git init failed in ${into}: ${made.stderr}`);
}

function runnerEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

// what baseline CI says: the head tree's own test command, once
function baselineCi(headDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'td-detect-ci-'));
  try {
    copyTree(headDir, tmp);
    const run = spawnSync('sh', ['-c', 'node --test'], { cwd: tmp, env: runnerEnv(), encoding: 'utf8', timeout: 120000 });
    return run.status === 0 ? 'pass' : 'fail';
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const strip = (entry) => ({ file: entry.file, name: entry.name, base: entry.base, head: entry.head });

// the red-green run on a copy of the head tree, the changed source swapped to base, as the action does (D7)
async function redGreenOf(headDir, files) {
  const changedTests = files.filter((f) => f.status !== 'removed' && classify(f.path) === 'test').map((f) => f.path);
  if (!changedTests.length) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'td-detect-rg-'));
  try {
    copyTree(headDir, tmp);
    const tests = detect(tmp, changedTests);
    const report = await redGreen({ root: tmp, tests, files, base: 'base', head: 'head', env: runnerEnv() });
    return {
      runner: report.runner,
      could_not_run: report.could_not_run,
      tests: report.tests.map(strip).sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name)),
      report,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function runCase(c) {
  const files = filesOf(c.dir);
  const staticResult = analyse({ files, pr: c.pr, releases: [] });
  const rg = await redGreenOf(path.join(c.dir, 'head'), files);
  const final = rg ? judge(staticResult, [rg.report]) : staticResult;
  const verdict = final.verdict;
  const expected = c.expected;
  const flagged = FLAGS.has(verdict);
  const problems = [];
  if (verdict !== expected.verdict) problems.push(`verdict ${verdict}, expected ${expected.verdict}`);
  if (expected.check && !final.reasons.some((r) => r.check === expected.check)) problems.push(`no reason line for ${expected.check}`);
  if (c.kind === 'legitimate' && flagged) problems.push(`the legitimate case is flagged ${verdict}`);
  if ((c.kind === 'tampering' || c.kind === 'no_evidence' || c.kind === 'could_not_run') && !flagged) problems.push(`the ${c.kind} case is not flagged (${verdict})`);
  if (c.kind === 'by_design' && (flagged || expected.detected !== false || !expected.reason)) problems.push('a by-design miss must be unflagged, expected undetected, and carry its reason');
  const baseline = baselineCi(path.join(c.dir, 'head'));
  if (baseline !== expected.baseline_ci) problems.push(`baseline CI ${baseline}, expected ${expected.baseline_ci}`);
  return {
    id: c.id,
    scenario: c.scenario,
    kind: c.kind,
    pr: c.pr,
    files: files.map((f) => `${f.status} ${f.path}`),
    truedone: {
      static_verdict: staticResult.verdict,
      verdict,
      label: final.label,
      reasons: final.reasons.map((r) => ({ check: r.check, file: r.file, verdict: r.verdict })),
      red_green: rg ? { runner: rg.runner, could_not_run: rg.could_not_run, tests: rg.tests } : null,
    },
    baseline_ci: baseline,
    detected: flagged,
    expected,
    met: problems.length === 0,
    problems,
    note: c.note,
  };
}

export async function runBench(dir = FIXTURES) {
  const cases = [];
  for (const c of readCases(dir)) cases.push(await runCase(c));
  const summary = {
    cases: cases.length,
    detected: cases.filter((c) => c.detected).length,
    not_detected_by_design: cases.filter((c) => c.kind === 'by_design').length,
    legitimate: cases.filter((c) => c.kind === 'legitimate').length,
    false_alarms: cases.filter((c) => c.kind === 'legitimate' && c.detected).length,
    baseline_ci_green: cases.filter((c) => c.baseline_ci === 'pass').length,
    met: cases.filter((c) => c.met).length,
  };
  return { schema: SCHEMA, summary, cases };
}

export function check(result) {
  return result.cases.filter((c) => !c.met).map((c) => `${c.id}: ${c.problems.join('; ')}`);
}

const SAID = {
  tampered: 'Tampered', review: 'Test changes: review', could_not_run: 'Could not run', proven: 'Proven', proven_new: 'Proven (new behaviour)',
  proven_weak: 'Proven (weak)', no_evidence: 'No red-green evidence', unrun: 'Tests changed: not run', not_applicable: 'Not applicable',
};

export function page(result) {
  const s = result.summary;
  const lines = [
    '# Detection benchmark',
    '',
    'Nine labelled pull requests from the research note of 2026-10-18, each a base tree and a head tree under',
    '`tools/test/fixtures/detect/`, run through the real core and the red-green runner by `node tools/bench/detect.mjs`.',
    'Beside each verdict is what baseline CI says: whether the head tree\'s own tests pass. The bench\'s check is a',
    'contract criterion, so CI runs it on every change, and a change that flags the legitimate case cannot land.',
    '',
    `${s.detected} of ${s.cases} cases detected, ${s.not_detected_by_design} not detected by design, ${s.false_alarms} false alarms on ${s.legitimate} legitimate case; baseline CI is green on ${s.baseline_ci_green} of ${s.cases}.`,
    '',
    '| Case | truedone | baseline CI | Detected | Why |',
    '|---|---|---|---|---|',
  ];
  for (const c of result.cases) {
    const why = c.detected ? c.note : (c.expected.reason || c.note);
    lines.push(`| ${c.scenario} | ${SAID[c.truedone.verdict] || c.truedone.verdict} | ${c.baseline_ci === 'pass' ? 'green' : 'red'} | ${c.detected ? 'yes' : 'no'} | ${why} |`);
  }
  lines.push('', 'A detected case is one whose verdict surfaces the weakness: Tampered, Test changes: review, No red-green evidence or Could not run.',
    'The two by-design misses are the floor of what running a pull request\'s own tests can show: the test\'s asserted value is never checked',
    'against the stated requirement (SPK-02 measures that check), and a mocked dependency is never exercised. The red-green verdicts read',
    'Proven (weak) because the local run carries no coverage data; the action adds it. This bench is the regression floor, not the noise',
    'claim: GATE-02 and GATE-03R measure noise on real pull requests, and each false alarm found there becomes a case here.', '');
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const result = await runBench();
  const problems = check(result);
  if (argv[0] === '--check') {
    for (const p of problems) console.error(`detect: ${p}`);
    console.log(JSON.stringify(result.summary));
    return problems.length ? 1 : 0;
  }
  const out = argv[0] === '--out' && argv[1] ? path.resolve(argv[1]) : path.join(ROOT, 'docs/bench');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'detection.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'detection.md'), page(result));
  console.log(JSON.stringify({ ...result.summary, out }));
  return problems.length ? 1 : 0;
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
