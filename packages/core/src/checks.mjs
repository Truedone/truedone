// Per-test checks over base and head text. First matching row wins.
// Callers pass file text in. This file does not read the disk.
import { classify } from './classify.mjs';
import {
  skip, focus, weakened as weakenedMsg, deleted, snapshot as snapshotMsg, parametrised,
  timeout as timeoutMsg, runner_config, step_release, step as stepMsg, claim, no_test, unrun, not_applicable,
} from './messages.mjs';

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

// From text[i], a quoted string or template literal, or a regex literal, ends at the returned index. A regex literal
// starts where an expression can: after an operator, an opening bracket, a comma or the start.
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

// The arguments of the call whose "(" is at text[open]: everything to the matching ")", nested brackets included and
// strings, template literals and regex literals skipped, so a call or a ")" in a string stays part of them (CORE-08).
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

// the arguments split at the commas between them, not those inside a call, a literal or a string
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

// judge(staticResult, reports) is the public export in judge.mjs.
// This name stays different so the single-file build can export both.
function reason(check, file, name, verdict) {
  const message = TEMPLATES[check].replaceAll('{name}', name || file || 'the change');
  return { check, file: file || '', message, verdict };
}

export function staticFindings(input = {}) {
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
  // each reason keeps the verdict it alone gives (CORE-09), so next and the views can tell a lesser finding apart
  return { verdict, reasons: findings.map(({ check, file, message, verdict: own }) => ({ check, file, message, verdict: own })) };
}

export function staticVerdict(input = {}) {
  return staticFindings(input).verdict;
}
