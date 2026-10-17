// Turn one runner report into per-test results. Failure kinds follow docs/spec.md "Red-green outcomes":
// assertion, a missing symbol the diff adds, or any other error (never red).

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

function parseJestLike(text, symbols) {
  const data = JSON.parse(text);
  const out = [];
  for (const suite of data.testResults || []) {
    const file = suite.name || '';
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

function parseMocha(text, symbols) {
  const data = JSON.parse(text);
  const failed = new Set((data.failures || []).map((test) => `${test.file}\0${test.fullTitle || test.title}`));
  const out = [];
  for (const test of data.tests || []) {
    const key = `${test.file}\0${test.fullTitle || test.title}`;
    const err = test.err || {};
    const broken = failed.has(key) || Boolean(err.message || err.name || err.stack);
    if (!broken) {
      out.push(row(test.file, test.fullTitle || test.title, 'pass', null, test.duration, null));
      continue;
    }
    const kind = classifyFailure([err.name, err.message, err.stack].filter(Boolean).join('\n'), symbols);
    out.push(row(test.file, test.fullTitle || test.title, 'fail', kind.failure, test.duration, kind.errorType));
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

function parseJunit(text, symbols) {
  const out = [];
  const re = /<testcase\b([^>]*?)\/>|<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g;
  for (const match of String(text).matchAll(re)) {
    const meta = attrs(match[1] || match[2]);
    const body = match[3] || '';
    const file = meta.file || meta.classname || '';
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

export function parseReport(text, reporter, symbols) {
  if (reporter === 'jest-json' || reporter === 'vitest-json') return parseJestLike(text, symbols);
  if (reporter === 'mocha-json') return parseMocha(text, symbols);
  if (reporter === 'junit') return parseJunit(text, symbols);
  throw new Error(`unknown reporter ${reporter}`);
}
