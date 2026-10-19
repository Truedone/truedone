import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const __m3=(()=>{
const LOCKS = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock', 'uv.lock', 'Pipfile.lock']);
const DEP_KEYS = new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']);
const JS_EXT = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts']);

function norm(p) {
return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function baseName(p) {
const i = p.lastIndexOf('/');
return i < 0 ? p : p.slice(i + 1);
}

function segments(p) {
return p.split('/').filter(Boolean);
}

function extOf(p) {
const b = baseName(p);
const i = b.lastIndexOf('.');
return i < 0 ? '' : b.slice(i + 1);
}

function isJsPath(p) {
return JS_EXT.has(extOf(p));
}

function under(p, name) {
return segments(p).includes(name);
}

function hasKey(keys, pred) {
return keys.some(pred);
}

function asList(v) {
if (typeof v === 'string') return [v];
if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
return [];
}

function splitWords(v) {
return String(v).split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

function globToReg(pattern) {
let src = '';
for (let i = 0; i < pattern.length;) {
if (pattern.startsWith('**/', i)) { src += '(?:.*/)?'; i += 3; continue; }
if (pattern.startsWith('**', i)) { src += '.*'; i += 2; continue; }
if (pattern[i] === '*') { src += '[^/]*'; i += 1; continue; }
const c = pattern[i];
src += /[.+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
i += 1;
}
return new RegExp(`^${src}$`);
}

function globMatch(pattern, p) {
return globToReg(pattern).test(p);
}

function nameMatch(pattern, name) {
const body = pattern.split('*').map((q) => q.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
return new RegExp(`^${body}$`).test(name);
}

function jsonDocs(configs) {
const docs = [];
for (const c of configs) {
if (!c || typeof c.path !== 'string' || typeof c.text !== 'string') continue;
const p = norm(c.path);
if (isJsPath(p) || !p.endsWith('.json')) continue;
try {
docs.push(JSON.parse(c.text));
} catch {

}
}
return docs;
}

function patternsFrom(configs) {
const testMatch = [];
const pythonFiles = [];
const setup = [];
for (const doc of jsonDocs(configs)) {
testMatch.push(...asList(doc.testMatch));
setup.push(...asList(doc.setupFiles), ...asList(doc.setupFilesAfterEnv), ...asList(doc.require));
}
for (const c of configs) {
if (!c || typeof c.path !== 'string' || typeof c.text !== 'string') continue;
const p = norm(c.path);
if (isJsPath(p)) continue;
if (p.endsWith('.toml')) pythonFiles.push(...tomlPythonFiles(c.text));
else if (p.endsWith('.ini') || p.endsWith('.cfg')) pythonFiles.push(...iniPythonFiles(c.text));
}
return { testMatch, pythonFiles, setup: setup.map(norm) };
}

function iniPythonFiles(text) {
const out = [];
for (const raw of String(text).split(/\r?\n/)) {
const line = raw.trim();
if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('[')) continue;
const eq = line.indexOf('=');
if (eq < 0) continue;
if (line.slice(0, eq).trim() !== 'python_files') continue;
out.push(...splitWords(line.slice(eq + 1)));
}
return out;
}

function tomlPythonFiles(text) {
const out = [];
for (const raw of String(text).split(/\r?\n/)) {
const line = raw.trim();
const m = line.match(/^python_files\s*=\s*(.+)$/);
if (!m) continue;
const v = m[1].trim();
if (v.startsWith('[')) {
for (const q of v.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g) || []) out.push(q.slice(1, -1));
} else if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
out.push(...splitWords(v.slice(1, -1)));
}
}
return out;
}

function runnerKey(k) {
return k === 'jest' || k.startsWith('jest.') || k === 'scripts.test' || k.startsWith('scripts.test.');
}

function pytestKey(k) {
return k === 'tool.pytest.ini_options' || k.startsWith('tool.pytest.ini_options.');
}

function depKey(k) {
return DEP_KEYS.has(k) || k.endsWith('.dependencies') || k.includes('optional-dependencies') || k.startsWith('dependency-groups');
}

function isRunner(path, base, keys) {
if (/^(jest|vitest|vite)\.config\./.test(base)) return true;
if (base.startsWith('.mocharc.')) return true;
if (base === 'pytest.ini' || base === 'tox.ini' || base === 'setup.cfg') return true;
if (base === 'pyproject.toml' && hasKey(keys, pytestKey)) return true;
if ((path === 'package.json' || base === 'package.json') && hasKey(keys, runnerKey)) return true;
return false;
}

function isSetup(path, base, setupPaths) {
if (base === 'conftest.py') return true;
if (/^(jest|vitest)\.setup\./.test(base)) return true;
if (base.startsWith('setup-tests.')) return true;
return setupPaths.includes(path);
}

function isTest(path, base, found) {
const ext = extOf(path);
if (JS_EXT.has(ext)) {
if (/\.test\./.test(base) || /\.spec\./.test(base)) return true;
if (under(path, 'test') || under(path, 'tests') || under(path, '__tests__')) return true;
}
if (ext === 'py') {
if (base.startsWith('test_') || base.endsWith('_test.py')) return true;
if (under(path, 'tests')) return true;
}
if (found.testMatch.some((g) => globMatch(g, path))) return true;
if (ext === 'py' && found.pythonFiles.some((g) => nameMatch(g, base))) return true;
return false;
}

function isHelper(path, base) {
if (base.endsWith('.snap')) return true;
if (under(path, '__snapshots__') || under(path, 'fixtures')) return true;
if (under(path, 'test') || under(path, 'tests') || under(path, '__tests__')) return true;
return false;
}

function isManifest(path, base, keys) {
if (/^requirements.*\.txt$/.test(base)) return true;
if (base === 'package.json' && hasKey(keys, depKey)) return true;
if (base === 'pyproject.toml' && hasKey(keys, depKey)) return true;
return false;
}

function isDocs(path, base) {
if (base.endsWith('.md') || base.endsWith('.rst')) return true;
if (under(path, 'docs')) return true;
if (base.startsWith('LICENSE') || base.startsWith('CHANGELOG')) return true;
return false;
}

function classify(filePath, context = {}) {
const path = norm(filePath);
const base = baseName(path);
const keys = Array.isArray(context.keys) ? context.keys.filter((k) => typeof k === 'string') : [];
const found = patternsFrom(Array.isArray(context.configs) ? context.configs : []);
if (path === '.github/truedone.yml') return 'truedone_config';
if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return 'workflow';
  if (isRunner(path, base, keys)) return 'runner_config';
  if (isSetup(path, base, found.setup)) return 'setup';
  if (isTest(path, base, found)) return 'test';
  if (isHelper(path, base)) return 'test_helper';
  if (LOCKS.has(base)) return 'lockfile';
  if (isManifest(path, base, keys)) return 'dependency_manifest';
  if (isDocs(path, base)) return 'docs';
  return 'source';
}

return {classify};
})();
const __m5=(()=>{
const KEYS = ['test', 'comments', 'conclusion', 'ignore', 'enabled'];

function unquote(value) {
if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
return value.slice(1, -1);
}
return value;
}

function readConfig(text) {
const config = { test: null, comments: 'off', conclusion: 'neutral', ignore: [], enabled: true };
const reasons = [];
for (const raw of String(text ?? '').split('\n')) {
if (/^\s*$/.test(raw) || /^\s*#/.test(raw)) continue;
if (/^\s/.test(raw)) {
reasons.push('refused nested line');
continue;
}
const m = /^([A-Za-z][\w.-]*)\s*:\s*(.*)$/.exec(raw);
if (!m) {
reasons.push('refused line');
continue;
}
const key = m[1];
let value = m[2].trim();
if (/^(?:\|[-+]?|>[-+]?)$/.test(value) || /&\w/.test(raw) || /^\*(?!\*)\w/.test(value)) {
reasons.push(`refused ${key}`);
continue;
}
value = unquote(value);
if (!KEYS.includes(key)) {
reasons.push(`unknown key ${key}`);
continue;
}
if (key === 'test') {
config.test = value;
continue;
}
if (key === 'comments') {
if (value === 'off' || value === 'on') config.comments = value;
else reasons.push(`refused comments: ${value}`);
continue;
}
if (key === 'conclusion') {
if (value === 'neutral' || value === 'fail-on-tampered') config.conclusion = value;
else reasons.push(`refused conclusion: ${value}`);
continue;
}
if (key === 'enabled') {
if (value === 'true') config.enabled = true;
else if (value === 'false') config.enabled = false;
else reasons.push(`refused enabled: ${value}`);
continue;
}
config.ignore = value.split(',').map((s) => s.trim()).filter(Boolean);
}
return { config, reasons };
}

return {readConfig};
})();
const __m4=(()=>{
const { readConfig } = __m5;

const JS_MANIFESTS = ['package.json'];
const PY_MANIFESTS = ['pyproject.toml', 'pytest.ini', 'setup.cfg'];
const isPython = (f) => f.endsWith('.py');

const COMMANDS = {
vitest: 'npx --no -- vitest run --reporter=json --outputFile={report} {files}',
jest: 'npx --no -- jest --json --outputFile={report} {files}',
mocha: 'npx --no -- mocha --reporter json --reporter-option output={report} {files}',
'node-test': 'node --test --test-reporter=junit --test-reporter-destination={report} {files}',
pytest: 'python3 -m pytest --junitxml={report} {files}',
};
const REPORTERS = { vitest: 'vitest-json', jest: 'jest-json', mocha: 'mocha-json', 'node-test': 'junit', pytest: 'junit' };

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

function withOverride(result, override) {
if (typeof override !== 'string' || !override.trim()) return result;
return { ...result, command: override };
}

function overrideFrom(root, override) {
if (typeof override === 'string') return override.trim() ? override : null;
try {
const text = fs.readFileSync(path.join(root, '.github', 'truedone.yml'), 'utf8');
const { config } = readConfig(text);
return typeof config.test === 'string' && config.test ? config.test : null;
} catch {
return null;
}
}

function detectFromManifests(manifests, testPath, override) {
const names = isPython(testPath) ? PY_MANIFESTS : JS_MANIFESTS;
const seen = [];
for (const dir of dirsUp(testPath)) {
for (const name of names) {
const key = join(dir, name);
if (typeof manifests[key] !== 'string') continue;
const r = name === 'package.json' ? fromPackageJson(manifests[key]) : fromPython(name, manifests[key]);
if (r.runner) {
const cwd = dir;
return withOverride({ test: testPath, runner: r.runner, cwd, file: cwd === '.' ? testPath : path.posix.relative(cwd, testPath), manifest: key, command: r.command, reporter: REPORTERS[r.runner] }, override);
}
seen.push(`${key}: ${r.why}`);
}
}
if (!seen.length) return withOverride({ test: testPath, runner: null, reason: `no ${names.join(', ')} above ${testPath}` }, override);
return withOverride({ test: testPath, runner: null, reason: seen.join('; ') }, override);
}

function detect(root, testPaths, override) {
const command = overrideFrom(root, override);
return testPaths.map((t) => {
const manifests = {};
for (const dir of dirsUp(t)) {
for (const name of [...JS_MANIFESTS, ...PY_MANIFESTS]) {
const key = join(dir, name);
try { manifests[key] = fs.readFileSync(path.join(root, key), 'utf8'); } catch {  }
}
}
return detectFromManifests(manifests, t, command);
});
}

return {detectFromManifests,detect};
})();
const __m7=(()=>{
const BASE_RUNS = 2;
const HEAD_RUNS = 3;
const RUN_TIMEOUT_MS = 300000;
const STEP_TIMEOUT_MS = 1200000;
const MAX_TESTS = 50;

return {BASE_RUNS,HEAD_RUNS,RUN_TIMEOUT_MS,STEP_TIMEOUT_MS,MAX_TESTS};
})();
const __m9=(()=>{
function baseToken(run) {
if (run.status === 'timeout') return 'timeout';
if (run.status === 'pass') return 'pass';
return `fail:${run.failure}`;
}

function headToken(run) {
if (run.status === 'timeout') return 'timeout';
if (run.status === 'pass') return 'pass';
return 'fail';
}

function failCount(tokens) {
return tokens.filter((token) => token.startsWith('fail')).length;
}

function outcome(row) {
const base = row.base || [];
const head = row.head || [];
const condition = row.condition ?? 'none';
const named = row.asserts_new_symbol === true;
const allHeadPass = head.length > 0 && head.every((token) => token === 'pass');
const bothAssertion = base.length === 2 && base.every((token) => token === 'fail:assertion');
const bothMissing = base.length === 2 && base.every((token) => token === 'fail:missing');
const conditionHolds = condition === 'lines' || condition === 'imports';

if (base.length < 2 || head.length < 3) {
return { result: 'Could not run: incomplete runs', reason: 'incomplete runs', detail: 'incomplete runs' };
}
if (bothAssertion && allHeadPass && conditionHolds) {
return { result: 'Proven', reason: null, detail: null };
}
if (bothMissing && allHeadPass && named) {
return { result: 'Proven (new behaviour)', reason: null, detail: null };
}
if ((bothAssertion || bothMissing) && allHeadPass) {
return { result: 'Proven (weak)', reason: null, detail: null };
}
if (base.length === 2 && base.every((token) => token === 'pass') && allHeadPass) {
return { result: 'No red-green evidence', reason: null, detail: null };
}
if (failCount(base) === 1 && base.filter((token) => token === 'pass').length === 1) {
return { result: 'Could not run: flaky on base', reason: 'flaky', detail: 'flaky on base' };
}
const headPass = head.filter((token) => token === 'pass').length;
if (headPass === 1 || headPass === 2) {
return { result: 'Could not run: flaky on head', reason: 'flaky', detail: 'flaky on head' };
}
if (head.length === 3 && head.every((token) => token === 'fail')) {
return { result: 'No red-green evidence', reason: 'fails on head', detail: 'fails on head' };
}
if (base.some((token) => token === 'fail:error')) {
return { result: 'Could not run: errored', reason: 'error', detail: row.errorType || 'Error' };
}
if ([...base, ...head].includes('timeout')) {
return { result: 'Could not run: timed out', reason: 'timeout', detail: 'a run exceeds 5 minutes' };
}
return { result: 'No red-green evidence', reason: null, detail: null };
}

function verdictId(row) {
const text = outcome(row).result || '';
if (text === 'Proven') return 'proven';
if (text === 'Proven (new behaviour)') return 'proven_new';
if (text === 'Proven (weak)') return 'proven_weak';
if (text.startsWith('Could not run')) return 'could_not_run';
return 'no_evidence';
}

return {baseToken,headToken,outcome,verdictId};
})();
const __m8=(()=>{
const { baseToken, headToken, outcome } = __m9;

return {baseToken,headToken,outcome};
})();
const __m10=(()=>{
function escapeReg(value) {
return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function symbolsAdded(files) {
const added = new Set();
const removed = new Set();
const ident = /[A-Za-z_][A-Za-z0-9_]*/g;
const take = (text, bag) => {
for (const match of String(text).matchAll(ident)) {
if (match[0].length >= 2) bag.add(match[0]);
}
};
for (const file of files || []) {
if (typeof file.patch === 'string') {
for (const line of file.patch.split('\n')) {
if (line.startsWith('+++') || line.startsWith('---')) continue;
if (line.startsWith('+')) take(line.slice(1), added);
else if (line.startsWith('-')) take(line.slice(1), removed);
}
continue;
}
const head = new Set();
const base = new Set();
if (typeof file.head === 'string') take(file.head, head);
if (typeof file.base === 'string') take(file.base, base);
for (const symbol of head) if (!base.has(symbol)) added.add(symbol);
for (const symbol of base) if (!head.has(symbol)) removed.add(symbol);
}
for (const symbol of removed) added.delete(symbol);
return [...added];
}

function classifyFailure(text, symbols) {
const body = String(text ?? '');
if (/AssertionError/.test(body) || /ERR_ASSERTION/.test(body) || /expect\(received\)/.test(body)) {
return { failure: 'assertion', errorType: 'AssertionError' };
}
const missingType = body.match(/ImportError|ModuleNotFoundError|AttributeError|ReferenceError/);
const notAFunction = /is not a function/.test(body);
if (missingType || notAFunction) {
const named = (symbols || []).some((symbol) => new RegExp(`\\b${escapeReg(symbol)}\\b`).test(body));
if (named) return { failure: 'missing', errorType: missingType ? missingType[0] : 'TypeError' };
}
const other = body.match(/SyntaxError|TypeError|Error/);
return { failure: 'error', errorType: missingType ? missingType[0] : (other ? other[0] : 'Error') };
}

function fromRoot(file, at) {
if (!at || !file) return file || '';
if (path.isAbsolute(file)) {
for (const root of at.roots || []) {
const rel = path.relative(root, file);
if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
}
return file;
}
return path.posix.join(at.cwd || '.', file);
}

function byClassname(classname, files) {
let best = null;
for (const file of files || []) {
if (!/\.py$/.test(file)) continue;
const dotted = file.replace(/\.py$/, '').split('/').join('.');
const c = String(classname || '');
const hit = c === dotted || c.startsWith(`${dotted}.`) || c.endsWith(`.${dotted}`) || c.includes(`.${dotted}.`);
if (hit && (!best || dotted.length > best.dotted.length)) best = { file, dotted };
}
return best ? best.file : null;
}

function junitFile(meta, at) {
if (at?.files?.length === 1) return fromRoot(at.files[0], at);
if (meta.file) return fromRoot(meta.file, at);
const given = byClassname(meta.classname, at?.files);
if (given) return fromRoot(given, at);
return meta.classname || '';
}

function row(file, name, status, failure, duration, errorType) {
return {
file: file || '',
name: name || '',
status,
failure: status === 'fail' ? failure : null,
duration_ms: Number.isFinite(duration) ? duration : 0,
errorType: errorType || null,
};
}

function fromMessages(file, name, status, messages, duration, symbols) {
if (status === 'passed' || status === 'pass') return row(file, name, 'pass', null, duration, null);
if (status === 'pending' || status === 'skipped' || status === 'todo') {
return row(file, name, 'fail', 'error', duration, 'skipped');
}
const kind = classifyFailure((messages || []).join('\n'), symbols);
return row(file, name, 'fail', kind.failure, duration, kind.errorType);
}

function parseJestLike(text, symbols, at) {
const data = JSON.parse(text);
const out = [];
for (const suite of data.testResults || []) {
const file = fromRoot(suite.name || '', at);
for (const test of suite.assertionResults || []) {
out.push(fromMessages(
file,
test.fullName || test.title || '',
test.status,
test.failureMessages || [],
test.duration,
symbols,
));
}
}
return out;
}

function parseMocha(text, symbols, at) {
const data = JSON.parse(text);
const failed = new Set((data.failures || []).map((test) => `${test.file}\0${test.fullTitle || test.title}`));
const out = [];
for (const test of data.tests || []) {
const key = `${test.file}\0${test.fullTitle || test.title}`;
const err = test.err || {};
const broken = failed.has(key) || Boolean(err.message || err.name || err.stack);
const file = fromRoot(test.file, at);
if (!broken) {
out.push(row(file, test.fullTitle || test.title, 'pass', null, test.duration, null));
continue;
}
const kind = classifyFailure([err.name, err.message, err.stack].filter(Boolean).join('\n'), symbols);
out.push(row(file, test.fullTitle || test.title, 'fail', kind.failure, test.duration, kind.errorType));
}
return out;
}

function decodeXml(value) {
return String(value ?? '')
.replace(/&lt;/g, '<')
.replace(/&gt;/g, '>')
.replace(/&quot;/g, '"')
.replace(/&apos;/g, "'")
.replace(/&amp;/g, '&');
}

function attrs(text) {
const out = {};
for (const match of String(text).matchAll(/([\w:.-]+)="([^"]*)"/g)) out[match[1]] = decodeXml(match[2]);
return out;
}

function parseJunit(text, symbols, at) {
const out = [];
const re = /<testcase\b([^>]*?)\/>|<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g;
for (const match of String(text).matchAll(re)) {
const meta = attrs(match[1] || match[2]);
const body = match[3] || '';
const file = at ? junitFile(meta, at) : (meta.file || meta.classname || '');
const name = meta.name || '';
const duration = meta.time == null ? 0 : Number(meta.time) * 1000;
const problem = body.match(/<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<skipped\b([^>]*)\/?>/);
if (!problem) {
out.push(row(file, name, 'pass', null, duration, null));
continue;
}
if (problem[0].startsWith('<skipped')) {
out.push(row(file, name, 'fail', 'error', duration, 'skipped'));
continue;
}
const tag = attrs(problem[2] || '');
const kind = classifyFailure([tag.type, tag.message, problem[3]].filter(Boolean).join('\n'), symbols);
out.push(row(file, name, 'fail', kind.failure, duration, kind.errorType));
}
return out;
}

function parseReport(text, reporter, symbols, at) {
if (reporter === 'jest-json' || reporter === 'vitest-json') return parseJestLike(text, symbols, at);
if (reporter === 'mocha-json') return parseMocha(text, symbols, at);
if (reporter === 'junit') return parseJunit(text, symbols, at);
throw new Error(`unknown reporter ${reporter}`);
}

return {symbolsAdded,classifyFailure,fromRoot,parseReport};
})();
const __m11=(()=>{
const { classify } = __m3;

const RECORD = 'truedone-restore';

function gitDir(root) {
const dot = path.join(root, '.git');
if (fs.statSync(dot).isDirectory()) return dot;
const text = fs.readFileSync(dot, 'utf8');
const found = /^gitdir:\s*(.+)$/m.exec(text);
if (!found) throw new Error(`no git directory at ${root}`);
return path.resolve(path.dirname(dot), found[1].trim());
}

function recordPath(root) {
return path.join(gitDir(root), RECORD);
}

function sha256(buf) {
return createHash('sha256').update(buf).digest('hex');
}

function readBytes(root, rel) {
const abs = path.join(root, rel);
return fs.existsSync(abs) ? fs.readFileSync(abs) : null;
}

function writeBytes(root, rel, buf) {
const abs = path.join(root, rel);
fs.mkdirSync(path.dirname(abs), { recursive: true });
fs.writeFileSync(abs, buf);
}

function removeFile(root, rel) {
const abs = path.join(root, rel);
if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

function asBuffer(value) {
if (value == null) return Buffer.alloc(0);
return Buffer.isBuffer(value) ? value : Buffer.from(String(value));
}

function readRecord(root) {
const file = recordPath(root);
if (!fs.existsSync(file)) return null;
return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function expectedNow(entry) {
if (entry.action === 'remove') return null;
return Buffer.from(entry.swapped, 'base64');
}

function same(buf, hash) {
if (buf == null) return hash == null;
return sha256(buf) === hash;
}

function restore(root) {
const rec = readRecord(root);
if (!rec) return { restored: false, files: [] };
const drifted = [];
for (const entry of rec.files) {
const now = readBytes(root, entry.path);
const swapped = expectedNow(entry);
const atSwap = same(now, swapped ? sha256(swapped) : null);
const atHead = same(now, entry.headSha);
if (!atSwap && !atHead) drifted.push(entry.path);
}
if (drifted.length) {
const err = new Error(`a file changed during the run: ${drifted.join(', ')}`);
err.files = drifted;
throw err;
}
for (const entry of rec.files) {
if (entry.head == null) removeFile(root, entry.path);
else writeBytes(root, entry.path, Buffer.from(entry.head, 'base64'));
const back = readBytes(root, entry.path);
if (!same(back, entry.headSha)) throw new Error(`hash mismatch after writing ${entry.path}`);
}
fs.unlinkSync(recordPath(root));
return { restored: true, files: rec.files.map((entry) => entry.path) };
}

function swapToBase({ root, files, classify: classifyFn = classify }) {
if (readRecord(root)) restore(root);
const chosen = [];
for (const file of files || []) {
if (classifyFn(file.path) !== 'source') continue;
const status = file.status || 'modified';
const headBuf = readBytes(root, file.path);
const baseBuf = asBuffer(file.base);
const action = status === 'added' ? 'remove' : 'write';
chosen.push({
path: file.path,
action,
head: headBuf ? headBuf.toString('base64') : null,
headSha: headBuf ? sha256(headBuf) : null,
swapped: action === 'remove' ? null : baseBuf.toString('base64'),
});
}
fs.writeFileSync(recordPath(root), JSON.stringify({ files: chosen }));
for (const entry of chosen) {
if (entry.action === 'remove') removeFile(root, entry.path);
else writeBytes(root, entry.path, Buffer.from(entry.swapped, 'base64'));
}
return { swapped: chosen.map((entry) => entry.path) };
}

return {readRecord,restore,swapToBase};
})();
const __m6=(()=>{
const { BASE_RUNS, HEAD_RUNS, MAX_TESTS, RUN_TIMEOUT_MS, STEP_TIMEOUT_MS } = __m7;
const { baseToken, headToken, outcome } = __m8;
const { fromRoot, parseReport, symbolsAdded } = __m10;
const { restore, swapToBase } = __m11;

const SCHEMA = 'truedone.report/1';

const TRUEDONE_VERSION = '0.1.0';

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

function expand(passes, names) {
return passes.map((pass) => pass.flatMap((run) => {
const known = run.whole ? names.get(run.file) : null;
if (!known?.length) return [run];
return known.map((name) => ({ ...run, name, whole: false }));
}));
}

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

async function runSide({ root, tests, side, times, timeoutMs, env, exec, symbols, started }) {
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

async function redGreen({ root, tests, files, base, head, env, exec }) {
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

const addedPaths = new Set((files || [])
.filter((f) => f && (f.status === 'A' || f.status === 'added'))
.map((f) => f.path ?? f.to ?? f.from));
const headNames = namesOf(headSide.passes);
const loadFiles = new Set(baseSide.passes.flat()
.filter((run) => run.status === 'fail'
&& addedPaths.has(run.file)
&& !(headNames.get(run.file) || []).includes(run.name))
.map((run) => run.file));
const loadFailures = [];
if (loadFiles.size) {
for (const file of loadFiles) {
loadFailures.push({
file,
detail: 'the base leg could not load this test file: the swap removes a module the pull request adds, so the import failure is the red for every test the file has on head',
});
}
baseSide.passes = baseSide.passes.map((pass) => [
...pass.filter((run) => !(loadFiles.has(run.file) && !(headNames.get(run.file) || []).includes(run.name))),
...[...loadFiles].flatMap((file) => (headNames.get(file) || []).map((name) => ({
file, name, status: 'fail', failure: 'missing', errorType: 'ModuleNotFoundError', duration_ms: 0,
}))),
]);
}

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
truedone_version: TRUEDONE_VERSION,
runner: headSide.runner || baseSide.runner,
job: null,
tests: items.map((item) => item.entry),
could_not_run: couldNot(items, baseSide.problem || headSide.problem),
load_failures: loadFailures.length ? loadFailures : undefined,
truncated,
};
}

return {runSide,redGreen,BASE_RUNS,HEAD_RUNS,MAX_TESTS,RUN_TIMEOUT_MS,STEP_TIMEOUT_MS};
})();
const __m12=(()=>{
const MAX_BYTES = 256 * 1024;
const TWIRP = "twirp/github.actions.results.api.v1.ArtifactService";

const CRC_TABLE = (() => {
const t = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
let c = n;
for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
t[n] = c >>> 0;
}
return t;
})();

function crc32(bytes) {
let c = 0xffffffff;
for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
return (c ^ 0xffffffff) >>> 0;
}

function buildZip(fileName, contents) {
const name = new TextEncoder().encode(fileName);
const data = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
const crc = crc32(data);
const u16 = (v) => new Uint8Array([v & 255, (v >> 8) & 255]);
const u32 = (v) => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
const local = new Uint8Array(30 + name.length);
local.set(u32(0x04034b50), 0);
local.set(u16(20), 4);
local.set(u16(0), 6);
local.set(u16(0), 8);
local.set(u16(0), 10);
local.set(u16(0), 12);
local.set(u32(crc), 14);
local.set(u32(data.length), 18);
local.set(u32(data.length), 22);
local.set(u16(name.length), 26);
local.set(name, 30);
const central = new Uint8Array(46 + name.length);
central.set(u32(0x02014b50), 0);
central.set(u16(20), 4);
central.set(u16(20), 6);
central.set(u16(0), 8);
central.set(u16(0), 10);
central.set(u16(0), 14);
central.set(u32(crc), 16);
central.set(u32(data.length), 20);
central.set(u32(data.length), 24);
central.set(u16(name.length), 28);
central.set(u32(0), 42);
central.set(name, 46);

const offset = local.length + data.length;
const end = new Uint8Array(22);
end.set(u32(0x06054b50), 0);
end.set(u16(1), 8);
end.set(u16(1), 10);
end.set(u32(central.length), 12);
end.set(u32(offset), 16);
const out = new Uint8Array(local.length + data.length + central.length + end.length);
let o = 0;
out.set(local, o); o += local.length;
out.set(data, o); o += data.length;
out.set(central, o); o += central.length;
out.set(end, o);
return out;
}

function artifactName(jobId) {
return `truedone-report-${jobId}`;
}

function backendIdsFromToken(token) {
const parts = String(token || "").split(".");
if (parts.length < 2 || !parts[1]) throw new Error("ACTIONS_RUNTIME_TOKEN carries no JWT payload");
const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)), (c) => c.charCodeAt(0))));
const scope = String(json.scp || "").split(" ").find((s) => s.startsWith("Actions.Results:"));
if (!scope) throw new Error("ACTIONS_RUNTIME_TOKEN carries no Actions.Results scope");
const [, run, job] = scope.split(":");
if (!run || !job) throw new Error("ACTIONS_RUNTIME_TOKEN's Actions.Results scope is incomplete");
return { workflow_run_backend_id: run, workflow_job_run_backend_id: job };
}

async function uploadReport(env, { jobId, fileName, contents }) {
const doFetch = env.fetch ?? fetch;
const name = artifactName(jobId);
const zip = buildZip(fileName, contents);
if (zip.length > MAX_BYTES) throw new Error(`report artifact over ${MAX_BYTES / 1024} KB`);
const ids = backendIdsFromToken(env.ACTIONS_RUNTIME_TOKEN);
const base = `${env.ACTIONS_RESULTS_URL.replace(/\/$/, "")}/${TWIRP}`;
const jsonHeaders = {
authorization: `Bearer ${env.ACTIONS_RUNTIME_TOKEN}`,
"content-type": "application/json",
};
const create = await doFetch(`${base}/CreateArtifact`, {
method: "POST",
headers: jsonHeaders,
body: JSON.stringify({ ...ids, name, version: 4 }),
});
if (!create.ok) throw Object.assign(new Error(`artifact create ${create.status}`), { status: create.status });
const created = await create.json();
if (!created.ok) throw new Error("artifact create was not ok");
if (!created.signed_upload_url) throw new Error("artifact create returned no signed upload url");
const put = await doFetch(created.signed_upload_url, {
method: "PUT",
headers: {
"content-type": "application/zip",
"x-ms-blob-type": "BlockBlob",
},
body: zip,
});
if (!put.ok) throw Object.assign(new Error(`artifact put ${put.status}`), { status: put.status });
const hash = createHash("sha256").update(zip).digest("hex");
const finalize = await doFetch(`${base}/FinalizeArtifact`, {
method: "POST",
headers: jsonHeaders,
body: JSON.stringify({ ...ids, name, size: String(zip.length), hash: `sha256:${hash}` }),
});
if (!finalize.ok) throw Object.assign(new Error(`artifact finalize ${finalize.status}`), { status: finalize.status });
const finished = await finalize.json();
if (!finished.ok) throw new Error("artifact finalize was not ok");
return { name, size: zip.length, artifact_id: finished.artifact_id };
}

return {buildZip,artifactName,backendIdsFromToken,uploadReport};
})();
const __m2=(()=>{
const { classify } = __m3;
const { detect } = __m4;
const { redGreen } = __m6;
const { uploadReport } = __m12;

function git(args, cwd) {
return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function gitRaw(args, cwd) {
return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function resolveBase({ eventPath, cwd, githubSha }) {
const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
const pr = event.pull_request ?? {};
const checkedOut = githubSha || event.pull_request?.merge_commit_sha || pr.head?.sha;
if (!checkedOut) throw new Error("no checked-out commit in the event");
const headCheckout = pr.head?.sha != null && checkedOut === pr.head.sha;
let base;
if (headCheckout) {
base = pr.base?.sha;
if (base && !objectExists(base, cwd)) {
git(["fetch", "--no-tags", "--depth=1", "origin", base], cwd);
}
if (!base) throw new Error("the event carries no pull_request.base.sha and the checkout is the PR head; the base cannot be determined");
} else {

const firstParent = () => git(["rev-parse", "--verify", `${checkedOut}^1^{commit}`], cwd);
try {
base = firstParent();
} catch {
try {
git(["fetch", "--no-tags", "--depth=2", "origin", checkedOut], cwd);
base = firstParent();
} catch {
throw new Error(`the checked-out commit ${checkedOut} has no first parent`);
}
}
}
return { base, prHead: pr.head?.sha ?? checkedOut, event };
}

function objectExists(sha, cwd) {
try {
git(["cat-file", "-e", `${sha}^{commit}`], cwd);
return true;
} catch {
return false;
}
}

function changedFiles(base, cwd) {
const out = [];

for (const line of git(["diff", "--name-status", base, "HEAD"], cwd).split("\n").filter(Boolean)) {
const [status, from, to] = line.split("\t");
const p = to || from;
let baseContent = null;
let headContent = null;
if (status !== "A") {
try { baseContent = gitRaw(["show", `${base}:${from || p}`], cwd); } catch { baseContent = null; }
}
if (status !== "D") {
try { headContent = fs.readFileSync(path.join(cwd, p), "utf8"); } catch { headContent = null; }
}
out.push({ path: p, status: status === "A" ? "added" : status === "D" ? "deleted" : "modified", base: baseContent, head: headContent });
}
return out;
}

function changedLines(baseText, headText, dir) {
const a = path.join(dir, "base.txt");
const b = path.join(dir, "head.txt");
fs.writeFileSync(a, String(baseText ?? ""));
fs.writeFileSync(b, String(headText ?? ""));
let diff = "";
try { diff = git(["diff", "--no-index", "--unified=0", a, b], dir); } catch (e) { diff = e.stdout ?? ""; }
const lines = new Set();
for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
const start = Number(m[1]);
const count = m[2] === undefined ? 1 : Number(m[2]);
for (let i = 0; i < Math.max(count, 1); i++) lines.add(start + i);
}
return lines;
}

function offsetToLine(text, offset) {
let line = 1;
for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
return line;
}

function computeCondition({ coverageDir, files, tests, root, tmpDir }) {

let realRoot = root;
try { realRoot = fs.realpathSync(root); } catch {  }
const sources = files.filter((f) => f.status !== "deleted" && classify(f.path) === "source");
const headTexts = new Map(sources.map((f) => [f.path, fs.readFileSync(path.join(root, f.path), "utf8")]));
const changed = new Map();
for (const f of sources) changed.set(f.path, changedLines(f.base, headTexts.get(f.path), tmpDir));

let coveredLines = new Map();
let sawCoverage = false;
if (fs.existsSync(coverageDir)) {
for (const name of fs.readdirSync(coverageDir)) {
if (!name.endsWith(".json")) continue;
let json;
try { json = JSON.parse(fs.readFileSync(path.join(coverageDir, name), "utf8")); } catch { continue; }
for (const entry of json.result ?? []) {
const rel = decodeURIComponent((entry.url || "").replace(/^file:\/\//, ""));
const relPath = path.relative(realRoot, rel);
if (!changed.has(relPath)) continue;
const baseChars = (sources.find((f) => f.path === relPath)?.base ?? "").length;
const headChars = headTexts.get(relPath).length;
let maxOffset = 0;
for (const fn of entry.functions ?? []) for (const r of fn.ranges ?? []) maxOffset = Math.max(maxOffset, r.endOffset);

if (maxOffset > headChars) continue;
if (maxOffset <= Math.min(baseChars, headChars)) continue;
sawCoverage = true;
const text = headTexts.get(relPath);

const ranges = [];
for (const fn of entry.functions ?? []) {
const fc = fn.count ?? 0;
for (const r of fn.ranges ?? []) ranges.push({ start: r.startOffset, end: r.endOffset, count: r.count ?? fc });
}
const coveredAt = (offset) => {
let best = null;
for (const r of ranges) {
if (r.start <= offset && offset < r.end) {
if (!best || r.end - r.start < best.end - best.start) best = r;
}
}
return best ? best.count > 0 : false;
};
const hit = coveredLines.get(relPath) ?? new Set();
const lines = text.split("\n");
let lineStart = 0;
for (let l = 1; l <= lines.length; l++) {

const lineEnd = lineStart + lines[l - 1].length - 1;
if (lines[l - 1].length > 0 && coveredAt(Math.min(lineEnd, text.length - 1))) hit.add(l);
lineStart += lines[l - 1].length + 1;
}
coveredLines.set(relPath, hit);
}
}
}
let linesHold = false;
for (const [p, hit] of coveredLines) {
if (process.env.TRUEDONE_COVERAGE_DEBUG) {
console.error(`truedone: coverage debug ${p}: changed=[${[...changed.get(p)].join(",")}] covered=[${[...hit].sort((a, b) => a - b).join(",")}]`);
}
for (const l of hit) if (changed.get(p)?.has(l)) linesHold = true;
}

const importsHold = tests.length ? importsHop(tests, sources.map((f) => f.path), root) : false;
const condition = linesHold ? "lines" : importsHold ? "imports" : "none";
return { condition, sawCoverage, linesHold, importsHold };
}

function importsHop(testPaths, changedPaths, root) {
const changedSet = new Set(changedPaths);
const specsOf = (text) => [...text.matchAll(/(?:from\s+|require\(\s*|import\s+)["']([^"']+)["']/g)].map((m) => m[1]);
const resolve = (fromFile, spec) => {
if (!spec.startsWith(".")) return null;
const base = path.resolve(path.dirname(path.join(root, fromFile)), spec);
for (const cand of [base, `${base}.mjs`, `${base}.js`, `${base}.cjs`, path.join(base, "index.mjs"), path.join(base, "index.js")]) {
const rel = path.relative(root, cand);
if (!rel.startsWith("..") && fs.existsSync(cand)) return rel;
}
return null;
};
for (const t of testPaths) {
let text;
try { text = fs.readFileSync(path.join(root, t), "utf8"); } catch { continue; }
const seen = new Set([t]);
let frontier = specsOf(text).map((s) => resolve(t, s)).filter(Boolean);
for (const f of frontier) if (changedSet.has(f)) return true;
for (const f of frontier) {
if (seen.has(f)) continue;
seen.add(f);
let inner;
try { inner = fs.readFileSync(path.join(root, f), "utf8"); } catch { continue; }
for (const s of specsOf(inner)) {
const r = resolve(f, s);
if (r && changedSet.has(r)) return true;
}
}
}
return false;
}

function porcelainSnapshot(cwd) {
return { head: git(["rev-parse", "HEAD"], cwd), status: git(["status", "--porcelain"], cwd) };
}

function provedStep(ref) {
return /^[0-9a-f]{40}$/.test(String(ref || "")) ? String(ref) : "";
}

async function runGate(context) {
const root = context.root;
const before = porcelainSnapshot(root);
let base, prHead;
try {
({ base, prHead } = resolveBase({ eventPath: context.eventPath, cwd: root, githubSha: context.githubSha }));
} catch (e) {
console.error(`truedone: Could not run: ${e.message}`);
return { code: 1 };
}
const files = changedFiles(base, root);
const testPaths = files.filter((f) => ["test", "test_helper"].includes(classify(f.path)) && f.status !== "deleted").map((f) => f.path);
if (!testPaths.length) {
console.log("truedone: no changed test files; nothing to red-green here.");
return { code: 0 };
}
const detected = detect(root, testPaths, context.configText);
const covDir = fs.mkdtempSync(path.join(os.tmpdir(), "truedone-cov-"));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "truedone-diff-"));
const outer = { ...((context.env ?? process.env)) };

delete outer.NODE_TEST_CONTEXT;
const env = { ...outer, NODE_V8_COVERAGE: covDir };
let report;
try {
report = await redGreen({ root, tests: detected, files, base, head: prHead, env, exec: context.exec });
} catch (e) {
console.error(`truedone: Could not run: ${e.message}`);
return { code: 1 };
} finally {
const after = porcelainSnapshot(root);
if (after.head !== before.head || after.status !== before.status) {
console.error(`truedone: Could not run: the checkout changed (S2): HEAD ${before.head.slice(0, 8)} -> ${after.head.slice(0, 8)}, status changed: ${after.status !== before.status}`);
return { code: 1 };
}
}
const condition = computeCondition({ coverageDir: covDir, files, tests: testPaths, root, tmpDir });
for (const t of report.tests) {
t.condition = condition.condition;
t.asserts_new_symbol = (t.base ?? []).includes("fail:missing");
}
report.job = process.env.GITHUB_JOB ?? null;
report.proved_step = provedStep(env.GITHUB_ACTION_REF);
fs.rmSync(covDir, { recursive: true, force: true });
fs.rmSync(tmpDir, { recursive: true, force: true });
const after = porcelainSnapshot(root);
if (after.head !== before.head || after.status !== before.status) {
console.error(`truedone: Could not run: the checkout changed (S2) after the run`);
return { code: 1 };
}
if (report.could_not_run) {
console.error(`truedone: Could not run: ${report.could_not_run.reason}: ${report.could_not_run.detail ?? ""}`);
await deliver(context, report);
return { code: 1, report };
}
console.log(`truedone: coverage condition: ${condition.condition}${condition.linesHold ? "" : condition.importsHold ? " (one-hop import fallback)" : ""}`);
await deliver(context, report);
return { code: 0, report };
}

async function deliver(context, report) {
const text = JSON.stringify(report, null, 2);
const token = (context.uploadEnv ?? process.env).ACTIONS_RUNTIME_TOKEN;
const url = (context.uploadEnv ?? process.env).ACTIONS_RESULTS_URL;
if (token && url) {
try {
const r = await uploadReport({ ACTIONS_RUNTIME_TOKEN: token, ACTIONS_RESULTS_URL: url, GITHUB_RUN_ID: process.env.GITHUB_RUN_ID }, { jobId: process.env.GITHUB_JOB ?? "job", fileName: "report.json", contents: text });
console.log(`truedone: the report is uploaded as ${r.name} (${r.size} bytes)`);
} catch (e) {
console.error(`truedone: the report upload failed: ${e.message}`);
}
} else {
console.log(`truedone: no Actions artifact environment; the report follows.\n${text}`);
}
}

return {resolveBase,changedFiles,computeCondition,provedStep,runGate};
})();
const __m1=(()=>{
const { runGate: runGateEngine } = __m2;

async function runGate(context) {
const root = context.root ?? process.env.GITHUB_WORKSPACE;
const eventPath = context.eventPath ?? process.env.GITHUB_EVENT_PATH;
if (!root || !eventPath) {
console.log(`truedone: no workspace or event file; nothing ran for ${context.repository ?? "the repository"} ${context.headSha ?? ""}.`);
return 0;
}
let configText;
if (context.config) {
try { configText = fs.readFileSync(context.config, "utf8"); } catch { configText = undefined; }
}
return runGateEngine({ root, eventPath, githubSha: context.headSha, configText, env: process.env, exec: context.exec });
}

return {runGate};
})();
const { runGate } = __m1;

if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
console.log(`truedone: the action runs on pull_request events only (got ${process.env.GITHUB_EVENT_NAME}); skipping.`);
process.exit(0);
}

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const context = {
repository: process.env.GITHUB_REPOSITORY,
headSha: event.pull_request?.head?.sha ?? event.after ?? event.sha,
baseSha: event.pull_request?.base?.sha,
eventName: process.env.GITHUB_EVENT_NAME,
config: process.env.INPUT_CONFIG || ".github/truedone.yml",
timeoutS: Number(process.env.INPUT_TIMEOUT || 1200),
};

const { code = 0 } = await runGate(context);
process.exit(code);
