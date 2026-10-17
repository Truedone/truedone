// Per-test checks over base and head text. First matching row wins.
// Callers pass file text in. This file does not read the disk.
import { classify } from './classify.mjs';

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

export function judge(input = {}) {
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
