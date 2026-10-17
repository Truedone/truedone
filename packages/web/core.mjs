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
const __bundle_checks=(()=>{
const STRONG = new Set(['toBe', 'toEqual', 'toStrictEqual', 'assertEqual', 'assertEq']);
const WEAK = new Set(['toBeDefined', 'toBeTruthy', 'toBeNull', 'toBeTypeOf', 'assertTrue', 'assertIsNotNone', 'assertBare']);

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

function jsAssertions(body) {
const out = [];
const re = /(?:^|[^\w])(?:not\.)?(toBeDefined|toBeTruthy|toBeTypeOf|toStrictEqual|toEqual|toBeNull|toBe)\s*\(/g;
for (const m of body.matchAll(re)) out.push(m[1] === 'toBeNull' && /not\.toBeNull\s*\(/.test(body) ? 'toBeNull' : m[1]);
return out;
}

function pyAssertions(body) {
const out = [];
for (const m of body.matchAll(/\b(assertEqual|assertTrue|assertIsNotNone)\s*\(/g)) out.push(m[1]);
for (const m of body.matchAll(/^\s*assert\s+(.+)$/gm)) {
out.push(/==|!=/.test(m[1]) ? 'assertEq' : 'assertBare');
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
skip: m[1] === 'xit' || m[1] === 'xtest' || m[3] === 'skip',
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
skip: marks.some((d) => /pytest\.mark\.(skip|skipif|xfail)\b/.test(d) || /\.skip\b/.test(d)),
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

function weakened(baseTests, headTests) {
const headBy = new Map(headTests.map((t) => [t.name, t]));
for (const b of baseTests) {
const h = headBy.get(b.name);
if (!h) continue;
if (h.assertions.length < b.assertions.length) return true;
const used = new Set();
for (const kind of b.assertions) {
const idx = h.assertions.findIndex((k, i) => !used.has(i) && rank(k) >= rank(kind) && (k === kind || rank(k) >= rank(kind)));
if (idx < 0) return true;
if (rank(h.assertions[idx]) < rank(kind)) return true;
used.add(idx);
}
}
return false;
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

function judge(input = {}) {
const files = fileMap(input.files);
const releases = new Set(input.releases || []);
const pr = String(input.pr || '');
const allTests = { base: [], head: [] };
let testChanged = false;
let sourceChanged = false;
let runnerChanged = false;
let snapshotChanged = false;
let timeoutUp = false;
let paramDown = false;
let stepSame = true;
let stepGone = false;
let stepRelease = false;
let stepOther = false;
let sawWorkflow = false;

for (const [path, entry] of files) {
const kind = classify(path);
const diff = changed(entry);
if (kind === 'test' || kind === 'test_helper') {
const baseTests = parseTests(path, entry.base);
const headTests = parseTests(path, entry.head);
allTests.base.push(...baseTests.map((t) => ({ ...t, path })));
allTests.head.push(...headTests.map((t) => ({ ...t, path })));
if (diff) testChanged = true;
if (weakened(baseTests, headTests)) return 'tampered';
for (const b of baseTests) {
const h = headTests.find((t) => t.name === b.name);
if (!h) continue;
if (!b.skip && h.skip) return 'tampered';
if (!b.focus && h.focus) return 'tampered';
if (h.timeout > b.timeout && h.timeout > 0) timeoutUp = true;
if (b.eachCount > 0 && h.eachCount > 0 && h.eachCount < b.eachCount) paramDown = true;
}
}
if (kind === 'source' && diff) sourceChanged = true;
if ((kind === 'runner_config' || kind === 'setup' || kind === 'workflow') && diff) runnerChanged = true;
if (path.endsWith('.snap') && diff) snapshotChanged = true;
if (kind === 'workflow') {
sawWorkflow = true;
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
if (moved) return 'unrun';
const kept = (b.imports || []).every((spec) => sourceStillThere(files, spec));
if ((b.imports || []).length && !kept) return 'review';
return 'tampered';
}

if (snapshotChanged) return 'review';
if (paramDown) return 'review';
if (timeoutUp) return 'review';
if (sawWorkflow && !stepSame && stepRelease && !stepGone) return 'review';
if (sawWorkflow && !stepSame && (stepGone || stepOther)) return 'tampered';
if (runnerChanged && !sawWorkflow) return 'review';
if (/adds tests/i.test(pr) && !testChanged) return 'no_evidence';
if (sourceChanged && !testChanged) return 'no_evidence';
if (testChanged && !input.report) return 'unrun';
if (sawWorkflow && stepSame && !testChanged) return 'not_applicable';
if (!testChanged && !sourceChanged) return 'not_applicable';
return 'unrun';
}

return {judge};
})();
export function judge(...a){return __bundle_checks.judge(...a)}
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

return {tampered,review,unrun,no_evidence,not_applicable,language,skip_focus,partial,bot};
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
unrun: 'Run the changed tests.',
no_evidence: 'Add a test that fails before the change and passes after it.',
not_applicable: 'No test change is in this set.',
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
return {
schema: 'truedone.verdict/1',
verdict,
label: LABELS[verdict] ?? null,
partial: Boolean(partial),
reasons: reasons.slice(0, 10),
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
let verdict = judge({
files: supported,
pr: prBody(input.pr),
releases: input.releases || [],
report: input.report,
});
if (partial && verdict === 'not_applicable') verdict = 'review';
if (partial) reasons.push({ check: 'partial', file: '', message: partialMessage });
return pack(verdict, reasons, partial);
}

return {analyse};
})();
export function analyse(...a){return __bundle_analyse.analyse(...a)}
