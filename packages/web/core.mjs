const __bundle_agents=(()=>{
function isAgent(login) {
const name = String(login || '').toLowerCase();
return name.includes('copilot') || name.includes('devin');
}

return {isAgent};
})();
export function isAgent(...a){return __bundle_agents.isAgent(...a)}
const __bundle_bots=(()=>{
const LISTED = [
'dependabot',
'dependabot[bot]',
'renovate',
'renovate[bot]',
'release-please',
'release-please[bot]',
'github-actions[bot]',
];

function isListedBot(login) {
return LISTED.includes(String(login || '').toLowerCase());
}

return {isListedBot};
})();
export function isListedBot(...a){return __bundle_bots.isListedBot(...a)}
const __bundle_classify=(()=>{
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
export function classify(...a){return __bundle_classify.classify(...a)}
const __bundle_config=(()=>{
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
export function readConfig(...a){return __bundle_config.readConfig(...a)}
const __bundle_limits=(()=>{
const FILES = 300;
const LINES = 20000;
const FETCHED = 100;

return {FILES,LINES,FETCHED};
})();
export const FILES=__bundle_limits.FILES;
export const LINES=__bundle_limits.LINES;
export const FETCHED=__bundle_limits.FETCHED;
const __bundle_messages=(()=>{
const tampered = 'A test that existed at base was disabled, focused or weakened.';
const review = 'A test change in {name} needs a look.';
const unrun = 'Tests in {name} changed and have not been run.';
const no_evidence = 'No red-green evidence for {name}.';
const not_applicable = 'Not applicable for {name}.';
const language = 'language not supported in version 1';
const skip_focus = 'A skip or focus marker is in {name}.';
const partial = 'Only part of the change was analysed.';
const bot = 'A listed bot opened {name}.';
const skip = 'Test {name} is skipped on head.';
const focus = 'Test {name} is focused on head.';
const weakened = 'Test {name} has a weaker assertion on head.';
const deleted = 'Test {name} was removed.';
const snapshot = 'Snapshot {name} changed.';
const parametrised = 'A parametrised case was removed in {name}.';
const timeout = 'The timeout of {name} was raised.';
const runner_config = 'Runner config {name} changed.';
const step_release = 'The truedone step in {name} moved to a published release.';
const step = 'The truedone step in {name} was removed or edited.';
const claim = 'The text claims tests were added.';
const no_test = 'Source file {name} changed with no test change.';

return {tampered,review,unrun,no_evidence,not_applicable,language,skip_focus,partial,bot,skip,focus,weakened,deleted,snapshot,parametrised,timeout,runner_config,step_release,step,claim,no_test};
})();
export const tampered=__bundle_messages.tampered;
export const review=__bundle_messages.review;
export const unrun=__bundle_messages.unrun;
export const no_evidence=__bundle_messages.no_evidence;
export const not_applicable=__bundle_messages.not_applicable;
export const language=__bundle_messages.language;
export const skip_focus=__bundle_messages.skip_focus;
export const partial=__bundle_messages.partial;
export const bot=__bundle_messages.bot;
export const skip=__bundle_messages.skip;
export const focus=__bundle_messages.focus;
export const weakened=__bundle_messages.weakened;
export const deleted=__bundle_messages.deleted;
export const snapshot=__bundle_messages.snapshot;
export const parametrised=__bundle_messages.parametrised;
export const timeout=__bundle_messages.timeout;
export const runner_config=__bundle_messages.runner_config;
export const step_release=__bundle_messages.step_release;
export const step=__bundle_messages.step;
export const claim=__bundle_messages.claim;
export const no_test=__bundle_messages.no_test;
const __bundle_checks=(()=>{
const weakenedMsg = weakened;
const snapshotMsg = snapshot;
const timeoutMsg = timeout;
const stepMsg = step;

const TEMPLATES = {
skip, focus, weakened: weakenedMsg, deleted, snapshot: snapshotMsg, parametrised,
timeout: timeoutMsg, runner_config, step_release, step: stepMsg, claim, no_test, unrun, not_applicable,
};
const CHECK_ORDER = ['skip', 'focus', 'weakened', 'deleted', 'snapshot', 'parametrised', 'timeout', 'runner_config', 'step_release', 'step', 'claim', 'no_test', 'unrun', 'not_applicable'];
const VERDICT_RANK = ['tampered', 'review', 'could_not_run', 'proven', 'proven_new', 'proven_weak', 'no_evidence', 'pending', 'unrun', 'not_applicable'];

const STRONG = new Set(['toBe', 'toEqual', 'toStrictEqual', 'assertEqual', 'assertEq']);
const WEAK = new Set(['toBeDefined', 'toBeTruthy', 'toBeNull', 'toBeTypeOf', 'assertTrue', 'assertIsNotNone', 'assertBare', 'assertOk']);

function normPath(p) {
return String(p || '').replace(/\\/g, '/');
}

function stripComments(text) {
return String(text)
.replace(/\/\*[\s\S]*?\*\//g, '')
.replace(/(^|[^:])\/\/.*$/gm, '$1')
.replace(/^\s*#.*$/gm, '');
}

function normBody(text) {
return stripComments(text).replace(/\s+/g, '');
}

function extOf(p) {
const b = p.slice(p.lastIndexOf('/') + 1);
const i = b.lastIndexOf('.');
return i < 0 ? '' : b.slice(i + 1);
}

function langOf(p) {
const e = extOf(p);
if (e === 'py') return 'py';
if (e === 'ts' || e === 'tsx' || e === 'mts' || e === 'cts') return 'ts';
return 'js';
}

function stringsOf(src, re) {
const out = [];
for (const m of src.matchAll(re)) out.push(m[1]);
return out;
}

function boolLit(text) {
return /^(true|false|null|undefined|True|False|None)$/.test(String(text).trim());
}

function liveText(body) {
let text = stripComments(body);
let prev = '';
while (text !== prev) {
prev = text;
text = text.replace(/if\s*\(\s*(?:false|0)\s*\)\s*\{[^{}]*\}/g, '');
}
text = text.replace(/try\s*\{([^{}]*)\}\s*catch\s*\([^)]*\)\s*\{([^{}]*)\}/g, (all, tried, caught) => (
/\bthrow\b/.test(caught) ? all : ''
));
const cut = text.search(/(^|[;{}])\s*return\s*;/);
return cut < 0 ? text : text.slice(0, cut);
}

function jsAssertions(body) {
const text = liveText(body);
const out = [];
const re = /expect\s*\(\s*([^()]*)\)\s*\.\s*(not\.)?(toBeDefined|toBeTruthy|toBeTypeOf|toStrictEqual|toEqual|toBeNull|toBe)\s*\(\s*([^()]*)\)/g;
for (const m of text.matchAll(re)) {
const kind = m[3];
if ((kind === 'toBe' || kind === 'toEqual' || kind === 'toStrictEqual') && boolLit(m[1]) && boolLit(m[4])) continue;
out.push(kind);
}
const nodeRe = /\bassert\s*(?:\.(\w+))?\s*\(\s*([^()]*)\)/g;
for (const m of text.matchAll(nodeRe)) {
const method = m[1] || '';
const args = m[2].split(',').map((part) => part.trim());
if (!method || method === 'ok') {
if (boolLit(args[0] || '')) continue;
out.push(method === 'ok' ? 'assertOk' : 'assertBare');
continue;
}
if (method === 'equal' || method === 'strictEqual' || method === 'deepEqual' || method === 'deepStrictEqual') {
if (args.length >= 2 && boolLit(args[0]) && boolLit(args[1])) continue;
out.push(method === 'deepEqual' || method === 'deepStrictEqual' ? 'assertEq' : 'assertEqual');
}
}
return out;
}

function pyAssertions(body) {
const text = liveText(body);
const out = [];
for (const m of text.matchAll(/\b(assertEqual|assertTrue|assertIsNotNone)\s*\(/g)) out.push(m[1]);
for (const m of text.matchAll(/^\s*assert\s+(.+)$/gm)) {
const expr = m[1].trim();
if (/^(True|False|None)$/.test(expr)) continue;
out.push(/==|!=/.test(expr) ? 'assertEq' : 'assertBare');
}
return out;
}

function assertionsOf(lang, body) {
return lang === 'py' ? pyAssertions(body) : jsAssertions(body);
}

function rank(kind) {
if (STRONG.has(kind)) return 2;
if (WEAK.has(kind)) return 1;
return 1;
}

function braceBody(src, open) {
let i = src.indexOf('{', open);
if (i < 0) return src.slice(open);
let depth = 0;
for (let j = i; j < src.length; j += 1) {
if (src[j] === '{') depth += 1;
else if (src[j] === '}') {
depth -= 1;
if (depth === 0) return src.slice(open, j + 1);
}
}
return src.slice(open);
}

function pyBody(src, start) {
const lines = src.slice(start).split('\n');
const out = [lines[0]];
for (let i = 1; i < lines.length; i += 1) {
if (lines[i] && !/^\s/.test(lines[i]) && !lines[i].startsWith('#')) break;
out.push(lines[i]);
}
return out.join('\n');
}

function decoratorsBefore(src, idx) {
const before = src.slice(0, idx).split('\n');
const marks = [];
for (let i = before.length - 1; i >= 0; i -= 1) {
const line = before[i].trim();
if (!line) continue;
if (line.startsWith('@')) marks.push(line);
else break;
}
return marks;
}

function parseJs(src) {
const tests = [];
const re = /\b(it|test|describe|xit|xtest|fit|fdescribe)(?:\.each\s*\(([^)]*)\))?(?:\.(skip|only))?\s*\(\s*(['"`])([\s\S]*?)\4/g;
for (const m of src.matchAll(re)) {
const body = braceBody(src, m.index + m[0].length);
const each = m[2] ? [m[2]] : null;
tests.push({
name: m[5],
skip: m[1] === 'xit' || m[1] === 'xtest' || m[3] === 'skip' || /\bthis\.skip\s*\(/.test(body) || /(?<![.\w])t\.skip\s*\(/.test(body) || /skip\s*:\s*true/.test(src.slice(m.index + m[0].length, m.index + m[0].length + 80)),
focus: m[1] === 'fit' || m[1] === 'fdescribe' || m[3] === 'only',
assertions: assertionsOf('js', body),
timeout: maxNum(src, /(?:setTimeout|timeout)\s*\(\s*(\d+)/g),
eachCount: each ? countCases(each[0]) : 0,
body: normBody(body),
imports: stringsOf(src, /from\s+['"]([^'"]+)['"]/g),
});
}
return tests;
}

function parsePy(src) {
const tests = [];
const re = /^([ \t]*)def\s+(test_\w+)\s*\(/gm;
for (const m of src.matchAll(re)) {
const body = pyBody(src, m.index);
const marks = decoratorsBefore(src, m.index);
const param = marks.find((d) => d.includes('parametrize'));
tests.push({
name: m[2],
skip: marks.some((d) => /pytest\.mark\.(skip|skipif|xfail)\b/.test(d) || /\.skip\b/.test(d)) || /\bpytest\.skip\s*\(/.test(body),
focus: marks.some((d) => /pytest\.mark\.only\b/.test(d)),
assertions: assertionsOf('py', body),
timeout: maxNum(marks.join('\n') + body, /timeout\s*\(\s*(\d+)/g),
eachCount: param ? countCases(param) : 0,
body: normBody(body),
imports: [
...stringsOf(src, /^\s*import\s+([\w.]+)/gm),
...stringsOf(src, /^\s*from\s+([\w.]+)\s+import/gm),
],
});
}
return tests;
}

function countCases(text) {
const inner = String(text);
if (!inner.trim()) return 0;
const commas = (inner.match(/,/g) || []).length;
return commas + 1;
}

function maxNum(text, re) {
let n = 0;
for (const m of String(text).matchAll(re)) n = Math.max(n, Number(m[1]));
return n;
}

function parseTests(path, text) {
const lang = langOf(path);
return lang === 'py' ? parsePy(text || '') : parseJs(text || '');
}

function weakenedNames(baseTests, headTests) {
const names = [];
const headBy = new Map(headTests.map((t) => [t.name, t]));
for (const b of baseTests) {
const h = headBy.get(b.name);
if (!h) continue;
let bad = h.assertions.length < b.assertions.length;
const used = new Set();
if (!bad) {
for (const kind of b.assertions) {
const idx = h.assertions.findIndex((k, i) => !used.has(i) && rank(k) >= rank(kind) && (k === kind || rank(k) >= rank(kind)));
if (idx < 0 || rank(h.assertions[idx]) < rank(kind)) { bad = true; break; }
used.add(idx);
}
}
if (bad) names.push(b.name);
}
return names;
}

function truedonePins(text) {
return stringsOf(String(text), /uses:\s*[^\s@]*truedone[^\s@]*@([^\s]+)/g);
}

function fileMap(files) {
const map = new Map();
for (const f of files || []) map.set(normPath(f.path), { base: f.base || '', head: f.head ?? '' });
return map;
}

function changed(entry) {
return entry.base !== entry.head;
}

function sourceStillThere(files, spec) {
const rel = spec.replace(/^\.?\//, '').replace(/\.js$|\.ts$|\.py$/, '');
for (const [path, entry] of files) {
const stem = path.replace(/\.(js|ts|tsx|py)$/, '');
if (stem.endsWith(rel) || path.endsWith(spec) || stem.endsWith(spec)) {
return entry.head !== '';
}
}
return true;
}

function reason(check, file, name, verdict) {
const message = TEMPLATES[check].replaceAll('{name}', name || file || 'the change');
return { check, file: file || '', message, verdict };
}

function staticFindings(input = {}) {
const files = fileMap(input.files);
const releases = new Set(input.releases || []);
const pr = String(input.pr || '');
const allTests = { base: [], head: [] };
const findings = [];
const sourcePaths = [];
let testChanged = false;
let sourceChanged = false;
let runnerChanged = false;
let snapshotChanged = false;
let paramDown = false;
let stepSame = true;
let stepGone = false;
let stepRelease = false;
let stepOther = false;
let sawWorkflow = false;
let testPath = '';
let snapPath = '';
let paramPath = '';
let runnerPath = '';
let wfPath = '';
let docsPath = '';
const changedKinds = [];

for (const [path, entry] of files) {
const kind = classify(path);
const diff = changed(entry);
if (diff) changedKinds.push(kind);
if (kind === 'test' || kind === 'test_helper') {
const baseTests = parseTests(path, entry.base);
const headTests = parseTests(path, entry.head);
allTests.base.push(...baseTests.map((t) => ({ ...t, path })));
allTests.head.push(...headTests.map((t) => ({ ...t, path })));
if (diff) {
testChanged = true;
if (!testPath) testPath = path;
}
for (const name of weakenedNames(baseTests, headTests)) findings.push(reason('weakened', path, name, 'tampered'));
for (const b of baseTests) {
const h = headTests.find((t) => t.name === b.name);
if (!h) continue;
if (!b.skip && h.skip) findings.push(reason('skip', path, b.name, 'tampered'));
if (!b.focus && h.focus) findings.push(reason('focus', path, b.name, 'tampered'));
if (h.timeout > b.timeout && h.timeout > 0) findings.push(reason('timeout', path, b.name, 'review'));
if (b.eachCount > 0 && h.eachCount > 0 && h.eachCount < b.eachCount) {
paramDown = true;
if (!paramPath) paramPath = path;
}
}
}
if (kind === 'source' && diff) {
sourceChanged = true;
sourcePaths.push(path);
}
if ((kind === 'runner_config' || kind === 'setup' || kind === 'workflow') && diff) {
runnerChanged = true;
if (!runnerPath) runnerPath = path;
}
if (path.endsWith('.snap') && diff) {
snapshotChanged = true;
if (!snapPath) snapPath = path;
}
if ((kind === 'docs' || kind === 'lockfile' || kind === 'dependency_manifest') && diff && !docsPath) docsPath = path;
if (kind === 'workflow') {
sawWorkflow = true;
wfPath = path;
const basePins = truedonePins(entry.base);
const headPins = truedonePins(entry.head);
if (basePins.join() !== headPins.join()) stepSame = false;
if (basePins.length && !headPins.length) stepGone = true;
else if (!stepSame) {
const added = headPins.filter((p) => !basePins.includes(p));
if (added.length && added.every((p) => releases.has(p))) stepRelease = true;
else if (added.length || stepGone) stepOther = true;
else stepOther = true;
}
}
}

const headBodies = new Set(allTests.head.map((t) => t.body));
for (const b of allTests.base) {
const still = allTests.head.some((h) => h.path === b.path && h.name === b.name);
if (still) continue;
const moved = headBodies.has(b.body) && allTests.head.some((h) => h.body === b.body && (h.path !== b.path || h.name !== b.name));
if (moved) {
findings.push(reason('unrun', b.path, b.path, 'unrun'));
continue;
}
const kept = (b.imports || []).every((spec) => sourceStillThere(files, spec));
const verdict = (b.imports || []).length && !kept ? 'review' : 'tampered';
findings.push(reason('deleted', b.path, b.name, verdict));
}

const docsOnly = changedKinds.length > 0 && changedKinds.every((k) => k === 'docs' || k === 'lockfile' || k === 'dependency_manifest');
if (snapshotChanged) findings.push(reason('snapshot', snapPath, snapPath, 'review'));
if (paramDown) findings.push(reason('parametrised', paramPath, paramPath, 'review'));
if (sawWorkflow && !stepSame && stepRelease && !stepGone) findings.push(reason('step_release', wfPath, wfPath, 'review'));
if (sawWorkflow && !stepSame && (stepGone || stepOther)) findings.push(reason('step', wfPath, wfPath, 'tampered'));
if (runnerChanged && !sawWorkflow) findings.push(reason('runner_config', runnerPath, runnerPath, 'review'));
if (!docsOnly && /adds tests/i.test(pr) && !testChanged) findings.push(reason('claim', '', 'the text', 'no_evidence'));
if (!docsOnly && sourceChanged && !testChanged) {
for (const p of sourcePaths) findings.push(reason('no_test', p, p, 'no_evidence'));
}
if (testChanged && !input.report && !findings.some((f) => f.check === 'unrun')) findings.push(reason('unrun', testPath, testPath, 'unrun'));
const ranked = findings.some((f) => f.verdict !== 'not_applicable');
if (!ranked && (docsOnly || (!testChanged && !sourceChanged) || (sawWorkflow && stepSame && !testChanged))) {
findings.push(reason('not_applicable', docsPath, docsPath, 'not_applicable'));
}
if (!findings.length) findings.push(reason('unrun', testPath, testPath, 'unrun'));

findings.sort((a, b) => CHECK_ORDER.indexOf(a.check) - CHECK_ORDER.indexOf(b.check) || a.file.localeCompare(b.file) || a.message.localeCompare(b.message));
const verdict = findings.reduce((win, f) => (VERDICT_RANK.indexOf(f.verdict) < VERDICT_RANK.indexOf(win) ? f.verdict : win), 'not_applicable');
return { verdict, reasons: findings.map(({ check, file, message }) => ({ check, file, message })) };
}

function staticVerdict(input = {}) {
return staticFindings(input).verdict;
}

return {staticFindings,staticVerdict};
})();
export function staticFindings(...a){return __bundle_checks.staticFindings(...a)}
export function staticVerdict(...a){return __bundle_checks.staticVerdict(...a)}
const __bundle_analyse=(()=>{
const partialMessage = partial;

const LABELS = {
tampered: 'truedone:tampered',
review: 'truedone:review',
could_not_run: 'truedone:could-not-run',
proven: 'truedone:yes',
proven_new: 'truedone:yes',
proven_weak: 'truedone:weak',
no_evidence: 'truedone:no-evidence',
pending: 'truedone:pending',
unrun: 'truedone:unrun',
not_applicable: null,
};

const NEXT = {
tampered: 'Restore an equivalent test, or pin the step to a published release.',
review: 'Confirm the test change is intended.',
could_not_run: 'Fix the named reason and run again.',
proven: 'Review the rest of the change as usual.',
proven_new: 'Review the rest of the change as usual.',
proven_weak: 'Make the test run the changed lines and assert on them.',
no_evidence: 'Add a test that fails before the change and passes after it.',
pending: 'Approve the run on GitHub.',
unrun: 'Run the changed tests: the next rung.',
not_applicable: 'Nothing.',
};

const UNSUPPORTED = new Set(['go', 'rs', 'java']);

function prBody(pr) {
if (!pr) return '';
if (typeof pr === 'string') return pr;
return `${pr.title || ''}\n${pr.body || ''}`;
}

function loginOf(pr) {
if (!pr || typeof pr === 'string') return '';
return pr.author?.login || '';
}

function extOf(p) {
const b = String(p).slice(String(p).lastIndexOf('/') + 1);
const i = b.lastIndexOf('.');
return i < 0 ? '' : b.slice(i + 1);
}

function linesOf(files) {
let n = 0;
for (const f of files) n += Math.abs(String(f.head ?? '').split('\n').length - String(f.base || '').split('\n').length);
return n;
}

function hasMarker(text) {
return /\b(t\.Skip|t\.SkipNow|#\[ignore\]|pytest\.mark\.skip|\.skip\(|\.only\(|fit\(|fdescribe\()/.test(text);
}

function fromPatch(patch) {
const base = [];
const head = [];
for (const line of String(patch).split('\n')) {
if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue;
if (line.startsWith('+')) head.push(line.slice(1));
else if (line.startsWith('-')) base.push(line.slice(1));
else if (line.startsWith('\\')) continue;
else {
const text = line.startsWith(' ') ? line.slice(1) : line;
base.push(text);
head.push(text);
}
}
return { base: base.join('\n'), head: head.join('\n') };
}

function fileTexts(f) {
if (f.base != null || f.head != null) return { base: f.base || '', head: f.head ?? '' };
if (typeof f.patch === 'string') return fromPatch(f.patch);
return { base: '', head: '' };
}

function pack(verdict, reasons, partial) {
const lines = reasons.filter((r) => r.check !== 'partial');
const out = lines.slice(0, partial ? 9 : 10);
if (partial) out.push({ check: 'partial', file: '', message: partialMessage });
return {
schema: 'truedone.verdict/1',
verdict,
label: LABELS[verdict] ?? null,
partial: Boolean(partial),
reasons: out,
next: NEXT[verdict] || '',
};
}

function analyse(input = {}) {
const who = loginOf(input.pr);
if (who && isListedBot(who) && !isAgent(who)) {
return pack('not_applicable', [{ check: 'bot', file: '', message: bot.replace('{name}', who) }], false);
}
const files = (Array.isArray(input.files) ? input.files : [])
.map((f) => ({ path: f.path || f.filename || '', ...fileTexts(f) }))
.sort((a, b) => a.path.localeCompare(b.path));
let partial = files.length > FILES || linesOf(files) > LINES || (input.fetched || 0) > FETCHED;
const slice = files.slice(0, FILES);
const reasons = [];
const unsupported = slice.filter((f) => UNSUPPORTED.has(extOf(f.path)));
for (const f of unsupported) {
if (hasMarker(`${f.base}\n${f.head}`)) {
reasons.push({ check: 'skip_focus', file: f.path, message: skip_focus.replace('{name}', f.path) });
}
}
const supported = slice.filter((f) => !UNSUPPORTED.has(extOf(f.path)));
if (unsupported.length && supported.length === 0) {
if (!reasons.length) reasons.push({ check: 'language', file: unsupported[0].path, message: language });
return pack('not_applicable', reasons, false);
}
const found = staticFindings({
files: supported,
pr: prBody(input.pr),
releases: input.releases || [],
report: input.report,
});
let verdict = found.verdict;
if (partial && verdict === 'not_applicable') verdict = 'review';
return pack(verdict, reasons.concat(found.reasons), partial);
}

return {analyse};
})();
export function analyse(...a){return __bundle_analyse.analyse(...a)}
const __bundle_outcome=(()=>{
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
export function baseToken(...a){return __bundle_outcome.baseToken(...a)}
export function headToken(...a){return __bundle_outcome.headToken(...a)}
export function outcome(...a){return __bundle_outcome.outcome(...a)}
export function verdictId(...a){return __bundle_outcome.verdictId(...a)}
const __bundle_judge=(()=>{
const STAND = new Set(['tampered', 'review']);
const RANK = ['proven', 'proven_new', 'proven_weak', 'no_evidence'];

function best(ids) {
for (const id of RANK) if (ids.includes(id)) return id;
if (ids.length) return 'could_not_run';
return 'no_evidence';
}

function checkReport(report) {
if (!report || report.schema !== 'truedone.report/1' || !Array.isArray(report.tests)) {
throw new Error('reports of another shape are refused');
}
for (const test of report.tests) {
if (!test || !Array.isArray(test.base) || !Array.isArray(test.head)) {
throw new Error('reports of another shape are refused');
}
}
}

function pick(reports) {
if (reports == null) return null;
if (!Array.isArray(reports)) throw new Error('reports of another shape are refused');
for (const report of reports) checkReport(report);
let latest = 0;
for (const report of reports) {
const attempt = report.attempt ?? 0;
if (attempt > latest) latest = attempt;
}
const same = reports.filter((report) => (report.attempt ?? 0) === latest);
for (const report of same) {
const ids = report.tests.map(verdictId);
if (ids.some((id) => id !== 'could_not_run')) return report;
}
return same[0] || null;
}

const LABELS = {
tampered: 'truedone:tampered',
review: 'truedone:review',
could_not_run: 'truedone:could-not-run',
proven: 'truedone:yes',
proven_new: 'truedone:yes',
proven_weak: 'truedone:weak',
no_evidence: 'truedone:no-evidence',
pending: 'truedone:pending',
unrun: 'truedone:unrun',
not_applicable: null,
};

const NEXT = {
tampered: 'Restore an equivalent test, or pin the step to a published release.',
review: 'Confirm the test change is intended.',
could_not_run: 'Fix the named reason and run again.',
proven: 'Review the rest of the change as usual.',
proven_new: 'Review the rest of the change as usual.',
proven_weak: 'Make the test run the changed lines and assert on them.',
no_evidence: 'Add a test that fails before the change and passes after it.',
pending: 'Approve the run on GitHub.',
unrun: 'Run the changed tests: the next rung.',
not_applicable: 'Nothing.',
};

function result(verdict, reasons, partial) {
const lines = (reasons || []).filter((r) => r && r.check !== 'partial').slice(0, 10);
return {
schema: 'truedone.verdict/1',
verdict,
label: LABELS[verdict] ?? null,
partial: Boolean(partial),
reasons: lines,
next: NEXT[verdict] || '',
};
}

function redGreen(test) {
const id = verdictId(test);
const name = test.name || 'a test';
const cond = test.condition || 'none';
const head = (test.head || []).join(',');
return {
check: 'red_green',
file: test.file || '',
message: `Test ${name} is ${id} on head ${head} with coverage ${cond}.`,
};
}

function judge(staticResult, reports) {
const standing = staticResult && staticResult.verdict;
const partial = Boolean(staticResult && staticResult.partial);
const staticReasons = Array.isArray(staticResult?.reasons) ? staticResult.reasons.map((r) => ({ ...r })) : [];
if (STAND.has(standing)) return result(standing, staticReasons, partial);
const report = pick(reports);
if (!report) {
const fallback = standing || 'no_evidence';
const lines = staticReasons.length ? staticReasons : [{ check: 'no_test', file: '', message: 'No report reached a result.' }];
return result(fallback, lines, partial);
}
if (report.could_not_run && report.tests.length === 0) {
const why = report.could_not_run.reason || 'unknown';
const detail = report.could_not_run.detail || '';
const message = detail ? `${why}: ${detail}` : String(why);
return result('could_not_run', [{ check: 'could_not_run', file: '', message }], partial);
}
const lines = report.tests.map(redGreen);
const attempt = report.attempt ?? 0;
const same = (Array.isArray(reports) ? reports : []).filter((r) => (r.attempt ?? 0) === attempt && r !== report);
for (const other of same) {
lines.push({ check: 'report', file: '', message: `Report ${other.job || 'a job'} is on the same attempt.` });
}
return result(best(report.tests.map(verdictId)), lines, partial);
}

return {judge};
})();
export function judge(...a){return __bundle_judge.judge(...a)}
