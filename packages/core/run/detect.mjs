// Runner detection (RUN-01, PV-X06; docs/spec.md, Runners). For each changed test file, the nearest manifest that
// names a version 1 runner decides it: package.json for JavaScript and TypeScript tests; pyproject.toml, pytest.ini or
// setup.cfg for Python tests. The walk goes from the test's directory up to the repository root, so in a monorepo each
// file gets its own package. A package.json that names no runner is passed over for the next one up.
//
// Result per test file:
//   { test, runner, cwd, file, manifest, command, reporter }
//   runner    'vitest' | 'jest' | 'mocha' | 'node-test' | 'pytest'
//   cwd       the manifest's directory, relative to the root ('.' for the root)
//   file      the test file relative to cwd
//   command   a command template run in cwd: {files} is the space-separated test files and {report} the report path
//   reporter  'vitest-json' | 'jest-json' | 'mocha-json' | 'junit': the format of the report the command writes
// or, when no runner is found, { test, runner: null, reason }.
//
// detectFromManifests(manifests, testPath) works from data alone: manifests maps root-relative paths to file text. It
// reads no file system, so the corpus can run it offline. detect(root, testPaths) reads the same manifests from disk.
// Commands use the project's own binaries through npx --no, which never downloads one. CORE-04 adds the truedone.yml
// override on top of this.
import fs from 'node:fs';
import path from 'node:path';

const JS_MANIFESTS = ['package.json'];
const PY_MANIFESTS = ['pyproject.toml', 'pytest.ini', 'setup.cfg'];
const isPython = (f) => f.endsWith('.py');

// Each runner's command, with the built-in machine reporter docs/spec.md names, writing to {report}
const COMMANDS = {
  vitest: 'npx --no -- vitest run --reporter=json --outputFile={report} {files}',
  jest: 'npx --no -- jest --json --outputFile={report} {files}',
  mocha: 'npx --no -- mocha --reporter json --reporter-option output={report} {files}',
  'node-test': 'node --test --test-reporter=junit --test-reporter-destination={report} {files}',
  pytest: 'python3 -m pytest --junitxml={report} {files}',
};
const REPORTERS = { vitest: 'vitest-json', jest: 'jest-json', mocha: 'mocha-json', 'node-test': 'junit', pytest: 'junit' };
// Runners that are not in version 1, named in the reason when a test script uses one
const OTHER = ['bun test', 'ava', 'tap', 'karma', 'jasmine', 'playwright test', 'cypress', 'uvu', 'deno test', 'tape'];

const dirsUp = (testPath) => {
  const out = [];
  let d = path.posix.dirname(testPath);
  for (;;) {
    out.push(d);
    if (d === '.' || d === '/' || d === '') break;
    d = path.posix.dirname(d);
  }
  return out;
};
const join = (dir, f) => (dir === '.' ? f : `${dir}/${f}`);

// The runner a test script names: the first version 1 runner in the command, following npm/pnpm/yarn run hops
function fromScript(scripts, name, hops = 0) {
  const cmd = scripts?.[name];
  if (typeof cmd !== 'string' || hops > 3) return null;
  const run = cmd.match(/\b(?:npm run|pnpm(?: run)?|yarn(?: run)?)\s+([\w:.-]+)/);
  if (run && run[1] !== name && scripts[run[1]] !== undefined) {
    const r = fromScript(scripts, run[1], hops + 1);
    if (r) return r;
  }
  const hits = [
    [/\bvitest\b/, 'vitest'],
    [/\b(?:jest|react-scripts test|craco test)\b/, 'jest'],
    [/\b(?:mocha|ts-mocha)\b/, 'mocha'],
    [/\b(?:node|tsx)\b[^&|;]*\s--test\b/, 'node-test'],
  ].map(([re, r]) => [cmd.search(re), r]).filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0]);
  if (!hits.length) return null;
  const runner = hits[0][1];
  let command = COMMANDS[runner];
  if (runner === 'node-test' && /\btsx\b[^&|;]*\s--test\b/.test(cmd)) command = 'npx --no -- tsx --test --test-reporter=junit --test-reporter-destination={report} {files}';
  return { runner, command };
}

function fromPackageJson(text) {
  let j;
  try { j = JSON.parse(text); } catch { return { why: 'package.json is not valid JSON' }; }
  const s = fromScript(j.scripts, 'test');
  if (s) return s;
  if (j.jest !== undefined) return { runner: 'jest', command: COMMANDS.jest };
  if (j.mocha !== undefined) return { runner: 'mocha', command: COMMANDS.mocha };
  const deps = { ...j.dependencies, ...j.devDependencies };
  const found = ['vitest', 'jest', 'mocha'].filter((r) => deps[r] !== undefined);
  if (found.length === 1) return { runner: found[0], command: COMMANDS[found[0]] };
  const test = j.scripts?.test;
  const other = typeof test === 'string' && OTHER.find((o) => new RegExp(`(^|[\\s/])${o}\\b`).test(test));
  if (other) return { why: `package.json's test script runs ${other}, which is not a version 1 runner` };
  if (found.length > 1) return { why: `package.json lists ${found.join(' and ')} and its test script names neither` };
  return { why: 'package.json names no version 1 runner in scripts.test, the jest or mocha key, or its dependencies' };
}

function fromPython(name, text) {
  if (name === 'pytest.ini') return { runner: 'pytest', command: COMMANDS.pytest };
  if (name === 'setup.cfg') return /^\[tool:pytest\]/m.test(text) ? { runner: 'pytest', command: COMMANDS.pytest } : { why: 'setup.cfg has no [tool:pytest] section' };
  if (/^\[tool\.pytest\.ini_options\]/m.test(text) || /["']pytest(?:[<>=!~;\[\s"']|$)/m.test(text)) return { runner: 'pytest', command: COMMANDS.pytest };
  return { why: 'pyproject.toml has no [tool.pytest.ini_options] table and lists no pytest dependency' };
}

export function detectFromManifests(manifests, testPath) {
  const names = isPython(testPath) ? PY_MANIFESTS : JS_MANIFESTS;
  const seen = [];
  for (const dir of dirsUp(testPath)) {
    for (const name of names) {
      const key = join(dir, name);
      if (typeof manifests[key] !== 'string') continue;
      const r = name === 'package.json' ? fromPackageJson(manifests[key]) : fromPython(name, manifests[key]);
      if (r.runner) {
        const cwd = dir;
        return { test: testPath, runner: r.runner, cwd, file: cwd === '.' ? testPath : path.posix.relative(cwd, testPath), manifest: key, command: r.command, reporter: REPORTERS[r.runner] };
      }
      seen.push(`${key}: ${r.why}`);
    }
  }
  if (!seen.length) return { test: testPath, runner: null, reason: `no ${names.join(', ')} above ${testPath}` };
  return { test: testPath, runner: null, reason: seen.join('; ') };
}

// Reads every candidate manifest on the way up from each test file, then decides from that data
export function detect(root, testPaths) {
  return testPaths.map((t) => {
    const manifests = {};
    for (const dir of dirsUp(t)) {
      for (const name of [...JS_MANIFESTS, ...PY_MANIFESTS]) {
        const key = join(dir, name);
        try { manifests[key] = fs.readFileSync(path.join(root, key), 'utf8'); } catch { /* absent */ }
      }
    }
    return detectFromManifests(manifests, t);
  });
}
