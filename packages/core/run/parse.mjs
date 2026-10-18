// Turn one runner report into per-test results. Failure kinds follow docs/spec.md "Red-green outcomes":
// assertion, a missing symbol the diff adds, or any other error (never red).
// Each row is keyed by the test file's path from the repository root and the test's name (RUN-06), when the run says
// where it ran: at = { roots, cwd, files }, the root (and its real path), the run's directory relative to it, and the
// test files the run was given, relative to cwd. vitest, jest and mocha report absolute paths. node --test's junit
// report names no file, so the runner gives it one file a run; pytest's junit classname is the file's dotted path
// (tests.test_a, or tests.test_a.TestK for a class), which names one of the files given.
import path from 'node:path';

function escapeReg(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function symbolsAdded(files) {
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

export function classifyFailure(text, symbols) {
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

// a reported path, absolute or relative to cwd, as the path from the root
export function fromRoot(file, at) {
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

// pytest: the file given whose dotted path the classname starts with, or ends with when pytest's rootdir is above cwd
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

export function parseReport(text, reporter, symbols, at) {
  if (reporter === 'jest-json' || reporter === 'vitest-json') return parseJestLike(text, symbols, at);
  if (reporter === 'mocha-json') return parseMocha(text, symbols, at);
  if (reporter === 'junit') return parseJunit(text, symbols, at);
  throw new Error(`unknown reporter ${reporter}`);
}
