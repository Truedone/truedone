import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const __m1=(()=>{
const __bundle_agents=(()=>{
function isAgent(login) {
const name = String(login || '').toLowerCase();
return name.includes('copilot') || name.includes('devin');
}

return {isAgent};
})();
function isAgent(...a){return __bundle_agents.isAgent(...a)}
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
function isListedBot(...a){return __bundle_bots.isListedBot(...a)}
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
function classify(...a){return __bundle_classify.classify(...a)}
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
function readConfig(...a){return __bundle_config.readConfig(...a)}
const __bundle_limits=(()=>{
const FILES = 300;
const LINES = 20000;
const FETCHED = 100;

return {FILES,LINES,FETCHED};
})();
const FILES=__bundle_limits.FILES;
const LINES=__bundle_limits.LINES;
const FETCHED=__bundle_limits.FETCHED;
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

const GROUPS = [
[['skip', 'focus', 'weakened', 'deleted', 'parametrised', 'timeout', 'snapshot'], 'Restore an equivalent test.', 'Confirm the test change is intended.'],
[['step', 'step_release'], 'Pin the truedone step to a published release.', 'Confirm the step change is intended.'],
[['runner_config'], null, 'Confirm the runner config change is intended.'],
[['unrun'], null, 'Run the changed tests: the next rung.'],
];

function nextStep(verdict, reasons) {

const giving = (reasons || []).filter((r) => (r.verdict ?? verdict) === verdict);
const out = [];
for (const [checks, ifTampered, otherwise] of GROUPS) {
if (!giving.some((r) => checks.includes(r.check))) continue;
out.push(verdict === 'tampered' && ifTampered ? ifTampered : otherwise);
}
return out.length ? out.join(' ') : NEXT[verdict] || '';
}

return {tampered,review,unrun,no_evidence,not_applicable,language,skip_focus,partial,bot,skip,focus,weakened,deleted,snapshot,parametrised,timeout,runner_config,step_release,step,claim,no_test,NEXT,nextStep};
})();
const tampered=__bundle_messages.tampered;
const review=__bundle_messages.review;
const unrun=__bundle_messages.unrun;
const no_evidence=__bundle_messages.no_evidence;
const not_applicable=__bundle_messages.not_applicable;
const language=__bundle_messages.language;
const skip_focus=__bundle_messages.skip_focus;
const partial=__bundle_messages.partial;
const bot=__bundle_messages.bot;
const skip=__bundle_messages.skip;
const focus=__bundle_messages.focus;
const weakened=__bundle_messages.weakened;
const deleted=__bundle_messages.deleted;
const snapshot=__bundle_messages.snapshot;
const parametrised=__bundle_messages.parametrised;
const timeout=__bundle_messages.timeout;
const runner_config=__bundle_messages.runner_config;
const step_release=__bundle_messages.step_release;
const step=__bundle_messages.step;
const claim=__bundle_messages.claim;
const no_test=__bundle_messages.no_test;
const NEXT=__bundle_messages.NEXT;
function nextStep(...a){return __bundle_messages.nextStep(...a)}
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

function skipQuoted(text, i) {
const q = text[i];
for (let j = i + 1; j < text.length; j += 1) {
if (text[j] === '\\') j += 1;
else if (text[j] === q) return j;
}
return text.length - 1;
}

function regexAt(text, i) {
let k = i - 1;
while (k >= 0 && /\s/.test(text[k])) k -= 1;
if (k >= 0 && !/[(,=:[!&|?{};+\-*%<>~^]/.test(text[k])) return -1;
let inClass = false;
for (let j = i + 1; j < text.length; j += 1) {
const c = text[j];
if (c === '\n') return -1;
if (c === '\\') j += 1;
else if (c === '[') inClass = true;
else if (c === ']') inClass = false;
else if (c === '/' && !inClass) return j;
}
return -1;
}

function argsAt(text, open) {
let depth = 0;
for (let i = open; i < text.length; i += 1) {
const c = text[i];
if (c === '"' || c === "'" || c === '`') { i = skipQuoted(text, i); continue; }
if (c === '/') { const end = regexAt(text, i); if (end > 0) { i = end; continue; } }
if (c === '(' || c === '[' || c === '{') depth += 1;
else if (c === ')' || c === ']' || c === '}') {
depth -= 1;
if (depth === 0) return { inner: text.slice(open + 1, i), end: i };
}
}
return null;
}

function splitArgs(inner) {
const out = [];
let depth = 0;
let from = 0;
for (let i = 0; i < inner.length; i += 1) {
const c = inner[i];
if (c === '"' || c === "'" || c === '`') { i = skipQuoted(inner, i); continue; }
if (c === '/') { const end = regexAt(inner, i); if (end > 0) { i = end; continue; } }
if (c === '(' || c === '[' || c === '{') depth += 1;
else if (c === ')' || c === ']' || c === '}') depth -= 1;
else if (c === ',' && depth === 0) { out.push(inner.slice(from, i).trim()); from = i + 1; }
}
out.push(inner.slice(from).trim());
return out;
}

function jsAssertions(body) {
const text = liveText(body);
const out = [];
for (const m of text.matchAll(/expect\s*\(/g)) {
const subject = argsAt(text, m.index + m[0].length - 1);
if (!subject) continue;
const call = text.slice(subject.end + 1).match(/^\s*\.\s*(not\.)?(toBeDefined|toBeTruthy|toBeTypeOf|toStrictEqual|toEqual|toBeNull|toBe)\s*\(/);
if (!call) continue;
const expected = argsAt(text, subject.end + call[0].length);
if (!expected) continue;
const kind = call[2];
if ((kind === 'toBe' || kind === 'toEqual' || kind === 'toStrictEqual') && boolLit(subject.inner) && boolLit(expected.inner)) continue;
out.push(kind);
}
for (const m of text.matchAll(/\bassert\s*(?:\.(\w+))?\s*\(/g)) {
const got = argsAt(text, m.index + m[0].length - 1);
if (!got) continue;
const method = m[1] || '';
const args = splitArgs(got.inner);
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

function pairByName(baseTests, headTests) {
const queues = new Map();
for (const t of headTests) {
if (!queues.has(t.name)) queues.set(t.name, []);
queues.get(t.name).push(t);
}
const pairs = [];
const consumed = new Set();
for (const b of baseTests) {
const q = queues.get(b.name);
const h = q && q.length ? q.shift() : null;
if (h) {
pairs.push([b, h]);
consumed.add(h);
}
}
const unmatched = headTests.filter((t) => !consumed.has(t));
return { pairs, unmatched };
}

function assertionsCover(base, head) {
if (head.length < base.length) return false;
const used = new Set();
for (const kind of base) {
const idx = head.findIndex((k, i) => !used.has(i) && rank(k) >= rank(kind));
if (idx < 0) return false;
used.add(idx);
}
return true;
}

function weakenedFromPairs(pairs) {
const names = [];
for (const [b, h] of pairs) {
if (!assertionsCover(b.assertions, h.assertions)) names.push(b.name);
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
const unmatchedByPath = new Map();
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
const { pairs } = pairByName(baseTests, headTests);
if (!unmatchedByPath.has(path)) unmatchedByPath.set(path, []);
for (const u of pairByName(baseTests, headTests).unmatched) unmatchedByPath.get(path).push(u);
for (const name of weakenedFromPairs(pairs)) findings.push(reason('weakened', path, name, 'tampered'));
for (const [b, h] of pairs) {
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
const consumedEquivalents = new Set();
for (const b of allTests.base) {
const still = allTests.head.some((h) => h.path === b.path && h.name === b.name);
if (still) continue;
const moved = headBodies.has(b.body) && allTests.head.some((h) => h.body === b.body && (h.path !== b.path || h.name !== b.name));
if (moved) {
findings.push(reason('unrun', b.path, b.path, 'unrun'));
continue;
}

const replacement = (unmatchedByPath.get(b.path) || []).find((u) => !consumedEquivalents.has(u) && assertionsCover(b.assertions, u.assertions));
if (replacement) {
consumedEquivalents.add(replacement);
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

return { verdict, reasons: findings.map(({ check, file, message, verdict: own }) => ({ check, file, message, verdict: own })) };
}

function staticVerdict(input = {}) {
return staticFindings(input).verdict;
}

return {staticFindings,staticVerdict};
})();
function staticFindings(...a){return __bundle_checks.staticFindings(...a)}
function staticVerdict(...a){return __bundle_checks.staticVerdict(...a)}
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
if (partial) out.push({ check: 'partial', file: '', message: partialMessage, verdict: 'review' });
return {
schema: 'truedone.verdict/1',
verdict,
label: LABELS[verdict] ?? null,
partial: Boolean(partial),
reasons: out,
next: nextStep(verdict, lines),
};
}

function analyse(input = {}) {
const who = loginOf(input.pr);
if (who && isListedBot(who) && !isAgent(who)) {
return pack('not_applicable', [{ check: 'bot', file: '', message: bot.replace('{name}', who), verdict: 'not_applicable' }], false);
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
reasons.push({ check: 'skip_focus', file: f.path, message: skip_focus.replace('{name}', f.path), verdict: 'not_applicable' });
}
}
const supported = slice.filter((f) => !UNSUPPORTED.has(extOf(f.path)));
if (unsupported.length && supported.length === 0) {
if (!reasons.length) reasons.push({ check: 'language', file: unsupported[0].path, message: language, verdict: 'not_applicable' });
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
function analyse(...a){return __bundle_analyse.analyse(...a)}
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
function baseToken(...a){return __bundle_outcome.baseToken(...a)}
function headToken(...a){return __bundle_outcome.headToken(...a)}
function outcome(...a){return __bundle_outcome.outcome(...a)}
function verdictId(...a){return __bundle_outcome.verdictId(...a)}
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

function result(verdict, reasons, partial) {
const all = (reasons || []).filter((r) => r && r.check !== 'partial');
return {
schema: 'truedone.verdict/1',
verdict,
label: LABELS[verdict] ?? null,
partial: Boolean(partial),
reasons: all.slice(0, 10),
next: nextStep(verdict, all),
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
verdict: id,
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
const lines = staticReasons.length ? staticReasons : [{ check: 'no_test', file: '', message: 'No report reached a result.', verdict: fallback }];
return result(fallback, lines, partial);
}
if (report.could_not_run && report.tests.length === 0) {
const why = report.could_not_run.reason || 'unknown';
const detail = report.could_not_run.detail || '';
const message = detail ? `${why}: ${detail}` : String(why);
return result('could_not_run', [{ check: 'could_not_run', file: '', message, verdict: 'could_not_run' }], partial);
}
const lines = report.tests.map(redGreen);
const verdict = best(report.tests.map(verdictId));
const attempt = report.attempt ?? 0;
const same = (Array.isArray(reports) ? reports : []).filter((r) => (r.attempt ?? 0) === attempt && r !== report);

for (const other of same) {
lines.push({ check: 'report', file: '', message: `Report ${other.job || 'a job'} is on the same attempt.`, verdict });
}
return result(verdict, lines, partial);
}

return {judge};
})();
function judge(...a){return __bundle_judge.judge(...a)}

return {isAgent,isListedBot,classify,readConfig,FILES,LINES,FETCHED,tampered,review,unrun,no_evidence,not_applicable,language,skip_focus,partial,bot,skip,focus,weakened,deleted,snapshot,parametrised,timeout,runner_config,step_release,step,claim,no_test,NEXT,nextStep,staticFindings,staticVerdict,analyse,baseToken,headToken,outcome,verdictId,judge};
})();
const __m3=(()=>{
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
const __m2=(()=>{
const { readConfig } = __m3;

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
const __m5=(()=>{
const BASE_RUNS = 2;
const HEAD_RUNS = 3;
const RUN_TIMEOUT_MS = 300000;
const STEP_TIMEOUT_MS = 1200000;
const MAX_TESTS = 50;

return {BASE_RUNS,HEAD_RUNS,RUN_TIMEOUT_MS,STEP_TIMEOUT_MS,MAX_TESTS};
})();
const __m7=(()=>{
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
const __m6=(()=>{
const { baseToken, headToken, outcome } = __m7;

return {baseToken,headToken,outcome};
})();
const __m8=(()=>{
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
const __m10=(()=>{
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
const __m9=(()=>{
const { classify } = __m10;

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
const __m4=(()=>{
const { BASE_RUNS, HEAD_RUNS, MAX_TESTS, RUN_TIMEOUT_MS, STEP_TIMEOUT_MS } = __m5;
const { baseToken, headToken, outcome } = __m6;
const { fromRoot, parseReport, symbolsAdded } = __m8;
const { restore, swapToBase } = __m9;

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

return {runSide,redGreen,BASE_RUNS,HEAD_RUNS,MAX_TESTS,RUN_TIMEOUT_MS,STEP_TIMEOUT_MS};
})();
const __m12=(()=>{
const LIMITS = { files: 300, lines: 20000, fetched: 100 };   
const CONTENT = new Set(['test', 'setup', 'runner_config', 'workflow', 'truedone_config']);   

const VERSION = '0.1.0';

return {LIMITS,CONTENT,VERSION};
})();
const __m11=(()=>{
const { CONTENT, LIMITS } = __m12;

class NoRepository extends Error {
constructor(why) { super(why); this.name = 'NoRepository'; }
}

function makeGit(cwd, env = process.env) {
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

function addedPatch(body) {
if (body.includes('\0')) return undefined;
const lines = body.split('\n');
const missingEol = !body.endsWith('\n');
if (!missingEol) lines.pop();
if (!lines.length) return undefined;
const head = `@@ -0,0 +1${lines.length === 1 ? '' : `,${lines.length}`} @@`;
return [head, ...lines.map((l) => `+${l}`), ...(missingEol ? ['\\ No newline at end of file'] : [])].join('\n');
}

function localInput(root, { classify, git = makeGit(root), branch: against = null }) {
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
try { f.head = fs.readFileSync(path.join(top, f.path), 'utf8'); } catch {  }
}
}
const title = git(['log', '-1', '--format=%s'], { quiet: true }) ?? '';
const login = git(['config', 'user.name'], { quiet: true }) ?? '';
return { input: { files, pr: { title, body: '', author: { login, type: 'User' } }, limits: LIMITS }, base, branch };
}

return {NoRepository,makeGit,localInput};
})();
const __m15=(()=>{
const MAX_BLOCKS = 3;

return {MAX_BLOCKS};
})();
const __m14=(()=>{
const { MAX_BLOCKS } = __m15;

const failing = (runs) => runs.filter((t) => t.runs.some((r) => r.status !== 'pass'));

function decide(facts, state = { blocks: 0, fingerprint: null, shown: [] }) {
const why = [];
if (facts.verdict === 'tampered') why.push(`Tampered: ${facts.reasons.map((r) => `${r.file}${r.line ? `:${r.line}` : ''} ${r.message}`).slice(0, 3).join('; ') || 'a test was weakened or disabled'}`);
const bad = failing(facts.runs);
if (bad.length) why.push(`${bad.length} changed test${bad.length === 1 ? '' : 's'} fail${bad.length === 1 ? 's' : ''} on a fresh run: ${bad.slice(0, 5).map((t) => `${t.file} ${t.name}`).join('; ')}`);
if (facts.changedTests > 0 && facts.claim && facts.ranAfterEdit === false) why.push('the last message says the tests pass, but the changed tests have not run since the last file edit');
const same = state.fingerprint === facts.fingerprint;
const next = { blocks: 0, fingerprint: facts.fingerprint, shown: [...(state.shown ?? [])] };
if (why.length) {
const blocks = same ? state.blocks + 1 : 1;
if (blocks > MAX_BLOCKS) {
return { block: false, message: `truedone stopped blocking after ${MAX_BLOCKS} blocks with no change: ${why.join('. ')}.`, state: { ...next, blocks } };
}
return { block: true, reason: `truedone: ${why.join('. ')}. Fix this, or say plainly in your reply that it is not fixed.`, state: { ...next, blocks } };
}
const notes = [];
if (facts.verdict === 'no_evidence') notes.push('No red-green evidence: source changed and no changed test fails without the change');
if (facts.runProblem) notes.push(`The changed tests could not run (${facts.runProblem.reason}): ${facts.runProblem.detail}`);
if (facts.verdict === 'review') notes.push(`Test changes: review: ${facts.reasons.map((r) => `${r.file} ${r.message}`).slice(0, 3).join('; ')}`);
const fresh = notes.filter((n) => !next.shown.includes(`${facts.fingerprint}:${n}`));
next.shown.push(...fresh.map((n) => `${facts.fingerprint}:${n}`));
return fresh.length ? { block: false, message: `truedone: ${fresh.join('. ')}.`, state: next } : { block: false, state: next };
}

return {decide};
})();
const __m16=(()=>{
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const RUNNER = /^(vitest|jest|mocha|pytest|py\.test)(\s|$)|^(node|tsx)\s(.*\s)?--test(\s|=|$)|^python3?\s+-m\s+(pytest|unittest)(\s|$)|^(npm|pnpm|yarn|bun)\s+(run\s+)?test(\s|$|:)|^truedone\s(.*\s)?--run(\s|$)/;
function isTestCommand(command) {
return String(command).split(/;|&&|\|\||\|/).some((seg) => {
let s = seg.trim().replace(/^\(+/, '');
while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(s)) s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '');
s = s.replace(/^(npx(\s+--?\S+)*|bunx|pnpm\s+exec|yarn(?=\s+(vitest|jest|mocha)))\s+/, '');
return RUNNER.test(s);
});
}

const CLAIM = /\b(all\s+(the\s+)?)?(\d+\s+)?(unit\s+|changed\s+|new\s+)?tests?\s+(now\s+|all\s+)?(pass(es|ed|ing)?|are\s+(passing|green)|succeed(ed)?|green)\b|\btest suite (passes|is green)\b|\bpassing tests\b/i;
const NOT = /\b(not|n't|never|no longer|fail(s|ed|ing)?)\b[^.]{0,40}\b(pass|green)|\b(pass|green)[^.]{0,20}\b(not|n't)\b/i;

function claimsTestsPass(message) {
if (typeof message !== 'string' || !message) return false;
return message.split(/(?<=[.!?\n])\s+/).some((s) => CLAIM.test(s) && !NOT.test(s));
}

function toolCalls(jsonl) {
const out = [];
for (const line of String(jsonl).split('\n')) {
if (!line.trim()) continue;
let row;
try { row = JSON.parse(line); } catch { continue; }
const content = row?.message?.role === 'assistant' || row?.type === 'assistant' ? row?.message?.content : null;
if (!Array.isArray(content)) continue;
for (const c of content) {
if (c?.type !== 'tool_use') continue;
if (EDIT_TOOLS.has(c.name)) out.push({ kind: 'edit', name: c.name, file: c.input?.file_path ?? c.input?.notebook_path });
else if (c.name === 'Bash' && typeof c.input?.command === 'string') out.push({ kind: isTestCommand(c.input.command) ? 'test' : 'other', name: 'Bash', command: c.input.command });
else out.push({ kind: 'other', name: c.name });
}
}
return out;
}

function ranTestsAfterLastEdit(calls) {
let lastEdit = -1;
calls.forEach((c, i) => { if (c.kind === 'edit') lastEdit = i; });
if (lastEdit < 0) return null;
return calls.slice(lastEdit + 1).some((c) => c.kind === 'test');
}

function holdsFinalMessage(jsonl, message) {
if (typeof message !== 'string' || !message.trim()) return false;
let last = null;
for (const line of String(jsonl).split('\n')) {
if (!line.trim()) continue;
let row;
try { row = JSON.parse(line); } catch { continue; }
if (row?.type !== 'assistant' || !Array.isArray(row?.message?.content)) continue;
const text = row.message.content.filter((c) => c?.type === 'text').map((c) => c.text).join('');
if (text) last = text;
}
return last !== null && last.trim() === message.trim();
}

return {isTestCommand,claimsTestsPass,toolCalls,ranTestsAfterLastEdit,holdsFinalMessage};
})();
const __m13=(()=>{
const { decide } = __m14;
const { claimsTestsPass, toolCalls, ranTestsAfterLastEdit, holdsFinalMessage } = __m16;

const TRANSCRIPT_CURRENT = true;

const RUN_TIMEOUT_MS = 120000;

async function hook(stdin, deps) {
const s = JSON.parse(stdin);
const root = s.cwd;
const { input } = deps.localInput(root, { classify: deps.classify });
if (!input.files.length) return null;
const result = deps.analyse(input);
const tests = input.files.filter((f) => f.status !== 'removed' && deps.classify(f.path) === 'test').map((f) => f.path);
const detected = tests.length ? deps.detect(root, tests).filter((d) => d.runner) : [];
const side = detected.length ? await deps.runSide({ root, tests: detected, side: 'head', times: 1, timeoutMs: RUN_TIMEOUT_MS }) : null;
const runs = side?.tests ?? [];
let transcript = '';
try { transcript = fs.readFileSync(s.transcript_path, 'utf8'); } catch {  }
const ran = transcript ? ranTestsAfterLastEdit(toolCalls(transcript)) : null;
const facts = {
verdict: result.verdict,
reasons: result.reasons ?? [],
runs,
runProblem: side?.problem ?? null,
changedTests: tests.length,
claim: claimsTestsPass(s.last_assistant_message),
ranAfterEdit: (deps.transcriptCurrent ?? TRANSCRIPT_CURRENT) && holdsFinalMessage(transcript, s.last_assistant_message) ? ran : null,
fingerprint: createHash('sha256').update(JSON.stringify([input.files.map((f) => [f.path, f.status, f.patch ?? '']), result.verdict, runs])).digest('hex').slice(0, 16),
};
const file = path.join(deps.dataDir, 'sessions', `${String(s.session_id).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
let state;
try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { state = undefined; }
const d = decide(facts, state);
fs.mkdirSync(path.dirname(file), { recursive: true });
d.state.shown = d.state.shown.slice(-50);
fs.writeFileSync(file, JSON.stringify(d.state));
if (d.block) return { decision: 'block', reason: d.reason };
if (d.message) return { systemMessage: d.message };
return null;
}

async function main(deps, { stdin = process.stdin, stdout = process.stdout } = {}) {
let text = '';
for await (const c of stdin) text += c;
let out;
try { out = await hook(text, deps); } catch (e) { out = { systemMessage: `truedone could not check this turn: ${e?.message ?? e}` }; }
if (out) stdout.write(JSON.stringify(out) + '\n');
}

return {TRANSCRIPT_CURRENT,hook,main};
})();
const { analyse, classify } = __m1;
const { detect } = __m2;
const { runSide } = __m4;
const { localInput } = __m11;
const { main } = __m13;

const REDGREEN_ENABLED = false;

main({
analyse, classify, detect, runSide, localInput,
dataDir: process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'truedone-plugin'),
});
