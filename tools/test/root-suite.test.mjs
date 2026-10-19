// BENCH-02: the root test script runs the suites, not the benchmark fixtures. package.json's "test" was "node --test",
// and node --test given no pattern takes its default one, which matches every .js, .mjs and .cjs file under any test/
// directory. So npm test also ran the BENCH-01 detection cases under tools/test/fixtures/detect: three of them fail by
// design, and the flaky one leaves .run-count at the repository root. The script now names the suites. This test reads
// the script, expands its patterns the way node --test does (fs.globSync with the runner's own node_modules exclusion,
// or the runner's default pattern when the script names none) and holds the result to the suites: every *.test.mjs at
// the top level of packages/*/test and tools/test, read from the file system, is matched; no matched file is under a
// fixtures directory; and no *.test.mjs anywhere else in the repository, outside node_modules and fixtures, is left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
// node 22's test runner uses this pattern when it is given none (kDefaultPattern in lib/internal/test_runner/utils.js)
const NODE_DEFAULT = '**/{test,test/**/*,test-*,*[._-]test}.{js,mjs,cjs}';

// the script as sh hands it to node: words split on blanks, quotes removed
function words(script) {
  const out = [];
  let cur = null;
  let quote = null;
  for (const ch of script) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur ??= ''; continue; }
    if (/\s/.test(ch)) { if (cur !== null) out.push(cur); cur = null; continue; }
    cur = (cur ?? '') + ch;
  }
  if (cur !== null) out.push(cur);
  return out;
}

const script = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts?.test ?? '';
const argv = words(script);
const patterns = argv.slice(2).filter((w) => !w.startsWith('-'));
// the files node --test runs for this script, as the runner lists them (lib/internal/test_runner/runner.js)
const runs = fs.globSync(patterns.length ? patterns : [NODE_DEFAULT], { cwd: root, exclude: (name) => name === 'node_modules' })
  .map((f) => f.split(path.sep).join('/')).sort();

const topLevel = (dir) => {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.test.mjs')).map((d) => `${dir}/${d.name}`);
};
const suites = [
  ...fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => topLevel(`packages/${d.name}/test`)),
  ...topLevel('tools/test'),
].sort();

function walk(dir, out = []) {
  for (const d of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${d.name}` : d.name;
    if (d.isDirectory()) { if (!['.git', 'node_modules', 'fixtures'].includes(d.name)) walk(rel, out); }
    else if (d.isFile() && d.name.endsWith('.test.mjs')) out.push(rel);
  }
  return out;
}

test('the root test script is node --test and names the patterns it runs', () => {
  assert.deepEqual(argv.slice(0, 2), ['node', '--test'], `package.json's test script is "${script}"`);
  assert.ok(patterns.length > 0, `"${script}" names no pattern, so node --test takes its default ${NODE_DEFAULT}`);
});

test('its patterns match every *.test.mjs at the top level of packages/*/test and tools/test', () => {
  assert.ok(suites.length > 0, 'no *.test.mjs was found at the top level of packages/*/test or tools/test');
  assert.deepEqual(suites.filter((f) => !runs.includes(f)), [], `"${script}" leaves these suites out`);
});

test('its patterns match no file under a fixtures directory', () => {
  assert.deepEqual(runs.filter((f) => f.split('/').includes('fixtures')), [], `"${script}" runs these fixture files`);
});

test('no *.test.mjs elsewhere in the repository, outside node_modules and fixtures, is left out', () => {
  assert.deepEqual(walk('').sort().filter((f) => !runs.includes(f)), [], `"${script}" does not run these test files`);
});
