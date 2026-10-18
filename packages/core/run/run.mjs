// Red-green runs (RUN-03). Swap changed source to base, run the changed tests twice,
// restore, then run them three times on head. exec, when present, is
// exec(command, { cwd, env, timeoutMs }) -> { code, stdout, stderr, timedOut }.
// Rows are keyed by the test file's path from the root and the test's name (RUN-06). node --test's junit report
// names no file, so a node --test run goes one file at a time, all inside the run's one time limit. A run that timed
// out gives a timeout run to each test of that file any run found, so it pairs with the other side's rows. A missing
// result is left missing: outcome() makes a test without two base and three head runs Could not run: incomplete runs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BASE_RUNS, HEAD_RUNS, MAX_TESTS, RUN_TIMEOUT_MS, STEP_TIMEOUT_MS } from './limits.mjs';
import { baseToken, headToken, outcome } from './outcome.mjs';
import { fromRoot, parseReport, symbolsAdded } from './parse.mjs';
import { restore, swapToBase } from './swap.mjs';

const SCHEMA = 'truedone.report/1';

function cleanEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (value != null) out[key] = String(value);
  }
  return out;
}

function localExec(command, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], {
      cwd,
      env: cleanEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      stderr += String(err.message);
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

function fill(command, files, report) {
  const list = files.map((file) => (/\s/.test(file) ? `'${file}'` : file)).join(' ');
  return command.replaceAll('{files}', list).replaceAll('{report}', report);
}

function absCwd(root, cwd) {
  return cwd && cwd !== '.' ? path.join(root, cwd) : root;
}

function choose(tests) {
  const ordered = [...(tests || [])].sort((a, b) => String(a.test || '').localeCompare(String(b.test || '')));
  const truncated = ordered.length > MAX_TESTS;
  return { chosen: truncated ? ordered.slice(0, MAX_TESTS) : ordered, truncated };
}

function groupsOf(tests) {
  const groups = [];
  const index = new Map();
  for (const test of tests) {
    if (!test || !test.runner || !test.command) continue;
    const key = `${test.cwd}\0${test.command}\0${test.reporter}`;
    if (!index.has(key)) {
      const group = { cwd: test.cwd || '.', command: test.command, reporter: test.reporter, runner: test.runner, files: [], tests: [] };
      index.set(key, group);
      groups.push(group);
    }
    const group = index.get(key);
    group.files.push(test.file || test.test);
    group.tests.push(test);
  }
  return groups;
}

// the runners whose report names no file: one file a run
const ONE_FILE = new Set(['node-test']);

function rootsOf(root) {
  try {
    const real = fs.realpathSync(root);
    return real === root ? [root] : [root, real];
  } catch {
    return [root];
  }
}

function where(root, group, files) {
  return { roots: rootsOf(root), cwd: group.cwd, files };
}

// a run that timed out: one row for the whole file, until the tests of that file are known
function blankRun(file, at) {
  const key = fromRoot(file, at);
  return { file: key, name: key, whole: true, status: 'timeout', failure: null, duration_ms: 0, errorType: null };
}

async function invoke({ root, group, files, tag, env, timeoutMs, exec, symbols }) {
  const reportName = `.truedone-report-${tag}`;
  const cwd = absCwd(root, group.cwd);
  const at = where(root, group, files);
  const command = fill(group.command, files, reportName);
  const run = exec || localExec;
  const result = await run(command, { cwd, env, timeoutMs });
  const reportPath = path.join(cwd, reportName);
  try {
    if (result.timedOut) {
      return { runs: files.map((file) => blankRun(file, at)), problem: null, timedOut: true };
    }
    if (!fs.existsSync(reportPath)) {
      return {
        runs: [],
        problem: { reason: 'runner', detail: result.stderr?.trim() || `${group.runner} wrote no report` },
      };
    }
    const text = fs.readFileSync(reportPath, 'utf8');
    const runs = parseReport(text, group.reporter, symbols, at);
    if (!runs.length) return { runs: [], problem: { reason: 'runner', detail: `${group.runner} report had no tests` } };
    return { runs, problem: null };
  } finally {
    if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
  }
}

async function once({ root, group, side, n, env, timeoutMs, exec, symbols }) {
  const shared = { root, group, env, exec, symbols };
  if (!ONE_FILE.has(group.runner) || group.files.length < 2) {
    return invoke({ ...shared, files: group.files, tag: `${side}-${n}`, timeoutMs });
  }
  // one file at a time, against one deadline: the run is still the whole group, and still has one time limit
  const deadline = Date.now() + timeoutMs;
  const runs = [];
  let problem = null;
  for (let i = 0; i < group.files.length; i += 1) {
    const left = deadline - Date.now();
    const got = left > 0 ? await invoke({ ...shared, files: [group.files[i]], tag: `${side}-${n}-${i}`, timeoutMs: left }) : null;
    if (!got || got.timedOut) {
      runs.push(...group.files.slice(i).map((file) => blankRun(file, where(root, group, [file]))));
      break;
    }
    runs.push(...got.runs);
    problem = problem || got.problem;
  }
  return { runs, problem };
}

// the test names each file has in any run, on either side
function namesOf(passes) {
  const names = new Map();
  for (const pass of passes) {
    for (const run of pass) {
      if (run.whole) continue;
      if (!names.has(run.file)) names.set(run.file, []);
      if (!names.get(run.file).includes(run.name)) names.get(run.file).push(run.name);
    }
  }
  return names;
}

// a whole-file timeout becomes a timeout run of each test of that file
function expand(passes, names) {
  return passes.map((pass) => pass.flatMap((run) => {
    const known = run.whole ? names.get(run.file) : null;
    if (!known?.length) return [run];
    return known.map((name) => ({ ...run, name, whole: false }));
  }));
}

// a test's runs, one per pass that has it; a pass without a result for it gives no run
function zipRuns(passes, times) {
  const order = [];
  const byKey = new Map();
  for (const pass of passes) {
    for (const run of pass) {
      const key = `${run.file}\0${run.name}`;
      if (!byKey.has(key)) {
        byKey.set(key, []);
        order.push(key);
      }
      byKey.get(key).push(run);
    }
  }
  return order.map((key) => {
    const [file, name] = key.split('\0');
    return { file, name, runs: byKey.get(key).slice(0, times) };
  });
}

export async function runSide({ root, tests, side, times, timeoutMs, env, exec, symbols, started }) {
  const repeats = times ?? (side === 'base' ? BASE_RUNS : HEAD_RUNS);
  const limit = timeoutMs ?? RUN_TIMEOUT_MS;
  const began = started ?? Date.now();
  const surrounding = env ?? process.env;
  const groups = groupsOf(tests);
  const passes = [];
  let problem = null;
  for (let n = 0; n < repeats; n += 1) {
    const pass = [];
    if (Date.now() - began > STEP_TIMEOUT_MS) {
      for (const group of groups) pass.push(...group.files.map((file) => blankRun(file, where(root, group, [file]))));
      problem = problem || { reason: 'timeout', detail: 'a run exceeds 5 minutes' };
      passes.push(pass);
      continue;
    }
    for (const group of groups) {
      const got = await once({ root, group, side, n, env: surrounding, timeoutMs: limit, exec, symbols });
      pass.push(...got.runs);
      if (got.problem) problem = problem || got.problem;
    }
    passes.push(pass);
  }
  const skipped = (tests || []).filter((test) => !test?.runner);
  if (skipped.length && !problem) {
    problem = { reason: 'runner', detail: skipped[0].reason || 'no version 1 runner' };
  }
  return { tests: zipRuns(expand(passes, namesOf(passes)), repeats), passes, repeats, problem, runner: groups[0]?.runner ?? null };
}

function reportTest(baseItem, headItem) {
  const baseRuns = baseItem?.runs || [];
  const headRuns = headItem?.runs || [];
  const errorType = [...baseRuns, ...headRuns].find((run) => run.failure === 'error' && run.errorType)?.errorType || null;
  const entry = {
    file: (headItem || baseItem).file,
    name: (headItem || baseItem).name,
    base: baseRuns.map(baseToken),
    head: headRuns.map(headToken),
    condition: 'none',
    asserts_new_symbol: false,
    duration_ms: [...baseRuns, ...headRuns].reduce((sum, run) => sum + (run.duration_ms || 0), 0),
  };
  return { entry, judged: outcome({ ...entry, errorType }) };
}

function couldNot(items, runnerProblem) {
  if (runnerProblem?.reason === 'timeout') return runnerProblem;
  const timeout = items.find((item) => item.judged.reason === 'timeout');
  if (timeout) return { reason: 'timeout', detail: timeout.judged.detail };
  const errored = items.find((item) => item.judged.reason === 'error');
  if (errored) return { reason: 'error', detail: errored.judged.detail };
  const flaky = items.find((item) => item.judged.reason === 'flaky');
  if (flaky) return { reason: 'flaky', detail: flaky.judged.detail };
  if (runnerProblem) return runnerProblem;
  return null;
}

export async function redGreen({ root, tests, files, base, head, env, exec }) {
  const { chosen, truncated } = choose(tests);
  const symbols = symbolsAdded(files);
  const started = Date.now();
  const shared = { root, env, exec, symbols, started, timeoutMs: RUN_TIMEOUT_MS };
  let baseSide;
  swapToBase({ root, files });
  try {
    baseSide = await runSide({ ...shared, tests: chosen, side: 'base', times: BASE_RUNS });
  } finally {
    restore(root);
  }
  const headSide = await runSide({ ...shared, tests: chosen, side: 'head', times: HEAD_RUNS });
  // a timeout on one side takes the test names the other side found for that file
  const names = namesOf([...baseSide.passes, ...headSide.passes]);
  const baseTests = zipRuns(expand(baseSide.passes, names), BASE_RUNS);
  const headTests = zipRuns(expand(headSide.passes, names), HEAD_RUNS);
  const headBy = new Map(headTests.map((item) => [`${item.file}\0${item.name}`, item]));
  const seen = new Set();
  const items = [];
  for (const baseItem of baseTests) {
    const key = `${baseItem.file}\0${baseItem.name}`;
    seen.add(key);
    items.push(reportTest(baseItem, headBy.get(key)));
  }
  for (const headItem of headTests) {
    const key = `${headItem.file}\0${headItem.name}`;
    if (seen.has(key)) continue;
    items.push(reportTest(null, headItem));
  }
  return {
    schema: SCHEMA,
    head_sha: head ?? null,
    checked_out_sha: head ?? null,
    base_sha: base ?? null,
    truedone_version: '0.0.0',
    runner: headSide.runner || baseSide.runner,
    job: null,
    tests: items.map((item) => item.entry),
    could_not_run: couldNot(items, baseSide.problem || headSide.problem),
    truncated,
  };
}

export { BASE_RUNS, HEAD_RUNS, MAX_TESTS, RUN_TIMEOUT_MS, STEP_TIMEOUT_MS };
