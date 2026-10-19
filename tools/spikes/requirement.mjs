#!/usr/bin/env node
// SPK-02: the requirement evidence check, a prototype. A bad test that agrees with a bad implementation is red-green and
// wrong (BENCH-01 case 05). This asks whether each test a pull request brings is tied to an acceptance criterion the
// change states, rather than to the implementation. It reads text only: it runs no test, spawns nothing and uses no
// network.
//
// Criteria come from two places, where a case carries them: the pull request body, and a requirements file in the head
// tree (REQUIREMENTS.md, the `- ID: text` form docs/spec.md names). A criterion is stated only by a marker: an inline
// "Requirement:" or "Acceptance criteria:" (the sentence after the colon), a list under a heading or lead-in line that
// names requirements or acceptance criteria, or a `- ID: text` line. A description of the change is not read as a
// criterion, so a case with no marker has none, and the result says so. `requirements.txt` is a dependency manifest by
// the spec's own file classification and is never read. A linked issue ("Fixes #12") is recorded, but its text is not
// read: that needs the network.
//
// Each test in a test file the pull request adds or modifies is scored against the criteria. Its subject is the words
// of its name (the assertions' words when the name has none); its outcome is read from its assertions (an expected
// true or false on a predicate such as isValid, or an expected throw), or from its name when no assertion gives one.
// A test is tied when its name shares at least two of a criterion's subject words (all of them, when the criterion has
// fewer) and its outcome does not oppose the criterion's. A test whose name shares the words but whose outcome is the
// opposite one is untied, with the finding "contradicts". The words an assertion's identifiers share are recorded
// beside the score, but they do not count toward a tie: identifiers such as a field name recur in every test of a
// module, so they cannot tell one test's subject from another's.
//
// It runs on the nine BENCH-01 cases (tools/test/fixtures/detect) and on the sandbox cases the repository records
// (packages/app/test/fixtures/sandbox-*), scores them against the hand labels below, and writes one line per case to
// docs/spikes/requirement-data.jsonl: keys sorted, no timestamps, no absolute paths, so a fresh run equals the
// committed file byte for byte (SPK-02-AC02). Mutation checks belong to RUN-05 and are not here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, filesOf, readCases } from '../bench/detect.mjs';
import { classify } from '../../packages/core/src/classify.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SCHEMA = 'truedone.requirement-spike/1';
export const SANDBOX_FIXTURES = path.join(ROOT, 'packages/app/test/fixtures');
export const DEFAULT_OUT = path.join(ROOT, 'docs/spikes/requirement-data.jsonl');

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// ---- words

const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'to', 'of', 'and', 'or', 'in', 'on', 'for',
  'with', 'by', 'it', 'its', 'this', 'that', 'these', 'those', 'as', 'at', 'from', 'now', 'then', 'when', 'if', 'so',
  'do', 'does', 'did', 'has', 'have', 'had', 'can', 'will', 'would', 'should', 'must', 'may', 'might', 'shall', 'we',
  'our', 'you', 'your', 'they', 'their', 'there', 'here', 'into', 'than', 'only', 'also', 'each', 'every', 'any', 'all',
  'some', 'same', 'still', 'after', 'before', 'test', 'tests', 'assert', 'equal', 'strict', 'deep', 'expect', 'ok',
  'const', 'let', 'var', 'await', 'async', 'return', 'function', 'new', 'true', 'false', 'null', 'undefined', 'none',
  'self', 'def', 'import', 'pytest', 'raises', 'not', 'never', 'no', 'one', 'two',
]);
const NEGATE = new Set(['not', 'never', 'no']);
// the outcome words, by stem: a criterion and a test agree when they name the same side
const ACCEPTING = new Set(['accept', 'allow', 'valid', 'permit', 'grant', 'approv', 'succeed']);
const REFUSING = new Set(['reject', 'deny', 'deni', 'refus', 'invalid', 'block', 'forbid', 'disallow', 'throw', 'rais', 'error', 'declin']);

export function stem(word) {
  let w = word;
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (/(?:ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.endsWith('es') && w.length > 4) w = w.slice(0, -1);
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) w = w.slice(0, -1);
  if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  return w;
}

// the words of a text, in order: camelCase and snake_case split, lower case, numbers dropped, each with its stem
export function words(text) {
  const spaced = String(text)
    .replace(/n't\b/gi, ' not')
    .replace(/\bcannot\b/gi, 'can not')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z]+/g, ' ')
    .toLowerCase();
  return spaced.split(' ').filter((w) => w.length > 1).map((w) => ({ word: w, stem: stem(w) }));
}

const sideOf = (s) => (ACCEPTING.has(s) ? 1 : REFUSING.has(s) ? -1 : 0);
const isOutcome = (s) => sideOf(s) !== 0;

// the subject: the content words, outcome words and stop words left out, as stem -> the first word that gave it
function subjectOf(text) {
  const out = new Map();
  for (const { word, stem: s } of words(text)) {
    if (STOP.has(word) || isOutcome(s) || s.length < 3) continue;
    if (!out.has(s)) out.set(s, word);
  }
  return out;
}

// the side a text names: 1 accepting, -1 refusing, 0 none, null when it names both. A "not", "never" or "no" up to
// three words before an outcome word turns it over.
export function sideOfText(text) {
  const ws = words(text);
  const seen = new Set();
  ws.forEach(({ stem: s }, i) => {
    let side = sideOf(s);
    if (!side) return;
    if (ws.slice(Math.max(0, i - 3), i).some((x) => NEGATE.has(x.word))) side = -side;
    seen.add(side);
  });
  if (seen.size > 1) return null;
  return seen.size ? [...seen][0] : 0;
}

// ---- criteria

const ID_LINE = /^\s*[-*+]\s+([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+):\s+(\S.*?)\s*$/;
const MARKER_WORDS = String.raw`(?:acceptance\s+criteri(?:a|on)|requirements?|criteri(?:a|on))`;
const LEAD_IN = new RegExp(String.raw`^\s*(?:#{1,6}\s+|\*\*|__)?\s*(?:the\s+)?` + MARKER_WORDS + String.raw`(?:\s+[\w-]+){0,3}\s*(?:\*\*|__)?\s*:?\s*(?:\*\*|__)?\s*$`, 'i');
const INLINE = new RegExp(String.raw`(?:^|[^\w])` + MARKER_WORDS + String.raw`\s*:\s*(\S[^\n]*)`, 'i');
const LEADING_MARKER = new RegExp('^' + MARKER_WORDS + String.raw`\s*:\s*`, 'i');
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(\S.*?)\s*$/;
const HEADING = /^\s*#{1,6}\s/;
const ISSUE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+((?:[\w.-]+\/[\w.-]+)?#\d+)/gi;

const sentence = (text) => text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0].replace(/[.!?;:,\s]+$/, '').trim();

// the criteria a text states, each { id, source, text }; ids are the text's own for `- ID: text` lines, else
// <prefix>-<n> in order
export function criteriaOf(text, source = 'pr_body', prefix = 'pr') {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  let n = 0;
  const add = (t, id) => {
    const clean = sentence(t.replace(/\*\*|__|`/g, '').replace(LEADING_MARKER, ''));
    if (!clean) return;
    n += 1;
    out.push({ id: id || `${prefix}-${n}`, source, text: clean });
  };
  let inSection = false;
  for (const line of lines) {
    const idLine = ID_LINE.exec(line);
    if (idLine) { add(idLine[2], idLine[1]); continue; }
    if (LEAD_IN.test(line) && !INLINE.test(line.replace(/:\s*$/, ''))) { inSection = true; continue; }
    if (inSection) {
      const item = ITEM.exec(line);
      if (item) { add(item[1]); continue; }
      if (!line.trim()) continue;
      inSection = false;
    }
    const inline = INLINE.exec(line);
    if (inline) add(inline[1]);
  }
  return out;
}

export function linkedIssues(text) {
  return [...String(text || '').matchAll(ISSUE)].map((m) => m[1]).sort();
}

const isRequirementsFile = (p) => /^requirements\.md$/i.test(p.slice(p.lastIndexOf('/') + 1));

// ---- tests

function skipQuoted(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j += 1) {
    if (src[j] === '\\') j += 1;
    else if (src[j] === q) return j;
  }
  return src.length - 1;
}

// from the "(" at src[open], the index of its matching ")", strings and comments skipped
function closeParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipQuoted(src, i); continue; }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return src.length - 1;
}

// the arguments of a call, split at the commas that are not inside a bracket or a string
function splitArgs(inner) {
  const out = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (c === '"' || c === "'" || c === '`') { i = skipQuoted(inner, i); continue; }
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) { out.push(inner.slice(from, i).trim()); from = i + 1; }
  }
  out.push(inner.slice(from).trim());
  return out.filter((a) => a !== '');
}

const lineAt = (src, index) => src.slice(0, index).split('\n').length;
const BOOL = { true: true, false: false, True: true, False: false };
const isBool = (x) => typeof x === 'string' && Object.hasOwn(BOOL, x.trim());

// the assertion statements of a JavaScript test body, each as one line of text
function jsAssertions(body) {
  const out = [];
  const re = /\b(?:assert(?:\.\w+)?|expect)\s*\(/g;
  let m;
  while ((m = re.exec(body))) {
    const open = m.index + m[0].length - 1;
    let end = closeParen(body, open);
    if (m[0].startsWith('expect')) {
      const chain = /^(?:\s*\.\s*(?:not|resolves|rejects))*\s*\.\s*\w+\s*\(/.exec(body.slice(end + 1));
      if (chain) end = closeParen(body, end + chain[0].length);
    }
    out.push(body.slice(m.index, end + 1).replace(/\s+/g, ' ').trim());
    re.lastIndex = end + 1;
  }
  return out;
}

function pyAssertions(body) {
  return body.split('\n').map((l) => l.trim()).filter((l) => /^(?:assert\b|self\.assert\w+\s*\(|with\s+pytest\.raises\s*\()/.test(l));
}

// the side a predicate expression expects, given the value it is asserted to have: isValid(x) asserted true is the
// accepting side; a leading "!" or "not" turns it over; a predicate that names no outcome word gives 0
function onPredicate(subject, expected, negated) {
  let s = subject.trim();
  let flip = negated;
  if (/^!/.test(s)) { flip = !flip; s = s.slice(1); }
  if (/^not\s+/.test(s)) { flip = !flip; s = s.replace(/^not\s+/, ''); }
  const side = sideOfText(s);
  if (!side) return 0;
  return side * (expected ? 1 : -1) * (flip ? -1 : 1);
}

// an expression asserted to be truthy: a comparison with true or false is read through; any other comparison is a
// value, which names no side
function exprSide(expr) {
  const e = expr.trim();
  const cmp = /^([\s\S]+?)\s*(===|!==|==|!=|\bis not\b|\bis\b)\s*(true|false|True|False)$/.exec(e);
  if (cmp) return onPredicate(cmp[1], BOOL[cmp[3]], cmp[2].startsWith('!') || cmp[2] === 'is not');
  if (/===|!==|==|!=|<|>|\bin\b|\bis\b/.test(e)) return 0;
  return onPredicate(e, true, false);
}

// what one assertion expects: 1 the accepting side, -1 the refusing side, 0 when it names neither (a number, a string)
export function assertionSide(text) {
  const t = String(text).trim();
  if (/\bassert\.(?:throws|rejects)\s*\(|\.\s*(?:rejects|toThrow\w*)\b|pytest\.raises|assertRaises/.test(t)) return -1;
  let m = /^assert\.(equal|strictEqual|deepEqual|deepStrictEqual|notEqual|notStrictEqual)\s*\(([\s\S]*)\)\s*;?$/.exec(t);
  if (m) {
    const args = splitArgs(m[2]);
    const negated = m[1].startsWith('not');
    if (isBool(args[1])) return onPredicate(args[0], BOOL[args[1].trim()], negated);
    if (isBool(args[0])) return onPredicate(args[1] || '', BOOL[args[0].trim()], negated);
    return 0;
  }
  m = /^assert(?:\.ok)?\s*\(([\s\S]*)\)\s*;?$/.exec(t);
  if (m) return exprSide(splitArgs(m[1])[0] || '');
  m = /^expect\s*\(([\s\S]*?)\)\s*((?:\.\s*not\s*)?)\.\s*(toBe|toEqual|toStrictEqual|toBeTruthy|toBeFalsy)\s*\(([\s\S]*)\)\s*;?$/.exec(t);
  if (m) {
    const negated = Boolean(m[2].trim());
    if (m[3] === 'toBeTruthy') return onPredicate(m[1], true, negated);
    if (m[3] === 'toBeFalsy') return onPredicate(m[1], false, negated);
    if (isBool(m[4])) return onPredicate(m[1], BOOL[m[4].trim()], negated);
    return 0;
  }
  m = /^self\.(assertTrue|assertFalse)\s*\(([\s\S]*)\)$/.exec(t);
  if (m) return onPredicate(splitArgs(m[2])[0] || '', m[1] === 'assertTrue', false);
  m = /^assert\s+([\s\S]+)$/.exec(t);
  if (m) return exprSide(splitArgs(m[1])[0] || '');
  return 0;
}

// the tests of one test file: { name, line, skipped, assertions, body }
export function testsOf(file, text) {
  const src = String(text || '');
  const out = [];
  if (file.endsWith('.py')) {
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      const m = /^([ \t]*)def\s+(test_\w+)\s*\(/.exec(line);
      if (!m) return;
      const body = [line];
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() && lines[j].match(/^[ \t]*/)[0].length <= m[1].length) break;
        body.push(lines[j]);
      }
      const marks = [];
      for (let j = i - 1; j >= 0 && lines[j].trim().startsWith('@'); j -= 1) marks.push(lines[j].trim());
      out.push({
        name: m[2], line: i + 1, body: body.join('\n'),
        skipped: marks.some((d) => /pytest\.mark\.(?:skip|skipif|xfail)\b/.test(d)),
        assertions: pyAssertions(body.join('\n')),
      });
    });
    return out;
  }
  const re = /\b(it|test)(?:\.(skip|only|todo))?\s*\(\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/g;
  for (const m of src.matchAll(re)) {
    const open = src.indexOf('(', m.index);
    const call = src.slice(open, closeParen(src, open) + 1);
    const afterName = m.index + m[0].length - open;
    out.push({ name: m[4], line: lineAt(src, m.index), body: call, skipped: m[2] === 'skip' || m[2] === 'todo', assertions: jsAssertions(call.slice(afterName)) });
  }
  return out;
}

// ---- scoring

const SIDE = { 1: 'accepting', '-1': 'refusing' };
const list = (xs) => xs.map((x) => `"${x}"`).join(', ');

// the outcome a test expects: from its assertions when any names a side, else from its name
function outcomeOf(test) {
  const sides = [...new Set(test.assertions.map(assertionSide).filter((s) => s !== 0))];
  if (sides.length === 1) return { side: sides[0], from: 'assertion' };
  if (sides.length > 1) return { side: null, from: 'assertion' };
  const named = sideOfText(test.name);
  if (named) return { side: named, from: 'name' };
  return { side: null, from: null };
}

// one test against the criteria: { score: 'tied'|'untied', finding, criterion, shared, assertion_shared, basis,
// reason, expects, expects_from }
export function scoreTest(test, criteria) {
  const outcome = outcomeOf(test);
  const base = { expects: outcome.side ? SIDE[outcome.side] : null, expects_from: outcome.side ? outcome.from : null };
  const none = { criterion: null, shared: [], assertion_shared: [], basis: null };
  if (!criteria.length) return { ...base, ...none, score: 'untied', finding: 'no_criteria', reason: 'untied: the case states no acceptance criterion to tie it to' };
  if (test.skipped) return { ...base, ...none, score: 'untied', finding: 'skipped', reason: 'untied: the test is skipped on head, so it checks nothing' };
  const named = subjectOf(test.name.replace(/^test_/, ''));
  const subject = named.size ? named : subjectOf(test.assertions.join(' '));
  const inAssertions = subjectOf(test.assertions.join(' '));
  const tries = criteria.map((c) => {
    const want = subjectOf(c.text);
    const shared = [...want.keys()].filter((s) => subject.has(s));
    const assertionShared = [...want.keys()].filter((s) => inAssertions.has(s)).map((s) => want.get(s));
    return { c, want, shared: shared.map((s) => want.get(s)), assertionShared, enough: want.size > 0 && shared.length >= Math.min(2, want.size), side: sideOfText(c.text) };
  });
  const order = (a, b) => b.shared.length - a.shared.length || a.c.id.localeCompare(b.c.id);
  const enough = tries.filter((t) => t.enough).sort(order);
  const agrees = (t) => !t.side || !outcome.side || t.side === outcome.side;
  const tie = enough.find(agrees);
  if (tie) {
    const basis = tie.side && outcome.side ? outcome.from : 'subject';
    const said = basis === 'assertion'
      ? `and its assertion expects the ${SIDE[outcome.side]} outcome ${tie.c.id} states`
      : basis === 'name'
        ? `and its name states the ${SIDE[outcome.side]} outcome ${tie.c.id} states; no assertion's expected value names a side`
        : `on the shared words alone: ${tie.side ? 'the test names no outcome' : `${tie.c.id} states no outcome`} the prototype can read, so the expected value is not compared`;
    return { ...base, score: 'tied', finding: 'tied', criterion: tie.c.id, shared: tie.shared, assertion_shared: tie.assertionShared, basis, reason: `tied to ${tie.c.id}: the name shares ${list(tie.shared)} with it, ${said}` };
  }
  if (enough.length) {
    const t = enough[0];
    const what = outcome.from === 'assertion' ? 'its assertion expects' : 'its name states';
    return {
      ...base, score: 'untied', finding: 'contradicts', criterion: t.c.id, shared: t.shared, assertion_shared: t.assertionShared, basis: outcome.from,
      reason: `untied: the name shares ${list(t.shared)} with ${t.c.id}, but ${what} the ${SIDE[outcome.side]} outcome where ${t.c.id} states the ${SIDE[t.side]} one`,
    };
  }
  const best = [...tries].sort(order)[0];
  if (best.shared.length) {
    return { ...base, score: 'untied', finding: 'weak_overlap', criterion: best.c.id, shared: best.shared, assertion_shared: best.assertionShared, basis: null, reason: `untied: the name shares only ${list(best.shared)} with ${best.c.id}, short of the ${Math.min(2, best.want.size)} words a tie needs` };
  }
  const touched = tries.find((t) => t.assertionShared.length);
  return { ...base, ...none, assertion_shared: touched ? touched.assertionShared : [], score: 'untied', finding: 'no_overlap', reason: 'untied: no stated criterion shares a subject word with the name' };
}

// ---- cases

function walk(dir, prefix = '') {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const p = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(abs).isDirectory()) Object.assign(out, walk(abs, p));
    else out[p] = fs.readFileSync(abs, 'utf8');
  }
  return out;
}

// a case laid out as BENCH-01's are: case.json, base/ and head/
export function treeCase(dir, source = 'bench') {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8'));
  return { id: meta.id, source, kind: meta.kind ?? null, path: rel(dir), pr: { title: meta.pr?.title ?? '', body: meta.pr?.body ?? '' }, files: filesOf(dir), tree: walk(path.join(dir, 'head')) };
}

// a sandbox pull request as packages/app/test/fixtures/sandbox-<n> records it: pull.json, files.json and the base and
// head text of each changed file as base-<name> and head-<name>. The record holds no tree.
export function sandboxCase(dir) {
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const pull = JSON.parse(read('pull.json'));
  const files = JSON.parse(read('files.json')).map((f) => {
    const name = f.filename.slice(f.filename.lastIndexOf('/') + 1);
    const text = (side) => (fs.existsSync(path.join(dir, `${side}-${name}`)) ? read(`${side}-${name}`) : '');
    return { path: f.filename, status: f.status, base: f.status === 'added' ? '' : text('base'), head: f.status === 'removed' ? '' : text('head') };
  });
  return { id: `sandbox-${pull.number}`, source: 'sandbox', kind: 'probe', path: rel(dir), pr: { title: pull.title ?? '', body: pull.body ?? '' }, files, tree: null };
}

export function sandboxCases(dir = SANDBOX_FIXTURES) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => /^sandbox-\d+$/.test(d) && fs.existsSync(path.join(dir, d, 'pull.json'))).sort().map((d) => sandboxCase(path.join(dir, d)));
}

// the hand labels the counts are measured against, from reading each case: how many criteria its text states, and per
// scored test (file::name) whether it is tied to one, contradicts one, or is untied
export const LABELS = {
  '01-assertion-weakened': { criteria: 0, tests: { 'test/total.test.mjs::the total of the items': 'untied' } },
  '02-failing-test-skipped': { criteria: 0, tests: { 'test/token.test.mjs::an expired token is rejected': 'untied', 'test/token.test.mjs::a live token is accepted': 'untied' } },
  '03-source-change-no-test': { criteria: 0, tests: {} },
  '04-green-on-base-and-head': { criteria: 0, tests: { 'test/lookup.test.mjs::a known name': 'untied', 'test/lookup.test.mjs::an unknown name is null': 'untied' } },
  '05-red-green-wrong-assertion': { criteria: 1, tests: { 'test/token.test.mjs::a live token is accepted': 'untied', 'test/token.test.mjs::an expired token is accepted': 'contradicts' } },
  '06-mock-hides-integration': { criteria: 0, tests: { 'test/charge.test.mjs::the charge reaches the provider': 'untied' } },
  '07-mutation-survives': { criteria: 0, tests: { 'test/discount.test.mjs::no items, no discount': 'untied', 'test/discount.test.mjs::a large order': 'untied', 'test/discount.test.mjs::a single item': 'untied' } },
  '08-flaky-test': { criteria: 0, tests: { 'test/add.test.mjs::adds two numbers': 'untied' } },
  '09-legitimate-test-refactor': { criteria: 0, tests: { 'test/add.test.mjs::adds two numbers': 'untied', 'test/mul.test.mjs::multiplies two numbers': 'untied' } },
  'sandbox-42': { criteria: 0, tests: { 'python/tests/test_calc.py::test_add': 'untied', 'python/tests/test_calc.py::test_mean': 'untied', 'python/tests/test_calc.py::test_add_zero': 'untied' } },
};

const normal = (t) => t.replace(/\s+/g, '');

export function scoreCase(c, labels = LABELS[c.id]) {
  const fromBody = criteriaOf(c.pr.body, 'pr_body', 'pr');
  const reqPath = c.tree ? Object.keys(c.tree).filter(isRequirementsFile).sort()[0] ?? null : null;
  const fromFile = reqPath ? criteriaOf(c.tree[reqPath], 'requirements_file', 'req') : [];
  const criteria = [...fromBody, ...fromFile];
  const issues = linkedIssues(c.pr.body);
  const changed = new Set(c.files.map((f) => f.path));
  const where = [];
  if (fromBody.length) where.push(`${fromBody.length} in the pull request body`);
  if (fromFile.length) where.push(`${fromFile.length} in ${reqPath}`);
  const fileNote = c.tree ? (reqPath ? `${reqPath} states none` : 'the head tree has no REQUIREMENTS.md') : 'the recorded case carries no tree to hold a requirements file';
  let note = criteria.length
    ? `${criteria.length} stated: ${where.join(', ')}`
    : `none stated: the pull request body has no requirement or acceptance marker, and ${fileNote}`;
  if (issues.length) note += `; it names ${issues.join(', ')}, whose text is not read offline`;
  const tests = [];
  for (const f of c.files) {
    if (f.status === 'removed' || classify(f.path) !== 'test') continue;
    const before = new Map(testsOf(f.path, f.base).map((t) => [t.name, normal(t.body)]));
    for (const t of testsOf(f.path, f.head)) {
      const s = scoreTest(t, criteria);
      const label = labels ? labels.tests[`${f.path}::${t.name}`] ?? null : null;
      const agrees = label === null ? null : label === (s.finding === 'contradicts' ? 'contradicts' : s.score);
      tests.push({
        file: f.path, name: t.name, line: t.line, skipped: t.skipped, assertions: t.assertions,
        change: !before.has(t.name) ? 'added' : before.get(t.name) === normal(t.body) ? 'unchanged' : 'modified',
        ...s, label, agrees,
      });
    }
  }
  tests.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const count = (pred) => tests.filter(pred).length;
  const counts = {
    tests: tests.length,
    tied: count((t) => t.score === 'tied'),
    untied: count((t) => t.score === 'untied'),
    contradicts: count((t) => t.finding === 'contradicts'),
  };
  const measured = labels ? {
    criteria_labelled: labels.criteria,
    invented_criteria: Math.max(0, criteria.length - labels.criteria),
    missed_criteria: Math.max(0, labels.criteria - criteria.length),
    false_ties: count((t) => t.score === 'tied' && t.label !== 'tied'),
    missed_ties: count((t) => t.label === 'tied' && t.score !== 'tied'),
    false_contradictions: count((t) => t.finding === 'contradicts' && t.label !== 'contradicts'),
    missed_contradictions: count((t) => t.label === 'contradicts' && t.finding !== 'contradicts'),
    unlabelled: count((t) => t.label === null),
  } : null;
  return {
    schema: SCHEMA, case: c.id, source: c.source, kind: c.kind, path: c.path, pr: { title: c.pr.title, body: c.pr.body },
    criteria, criteria_note: note, linked_issues: issues,
    requirements_file: reqPath ? { path: reqPath, changed_by_pull_request: changed.has(reqPath) } : null,
    tests, counts, measured,
  };
}

export function allCases() {
  return [...readCases(FIXTURES).map((c) => treeCase(c.dir, 'bench')), ...sandboxCases()];
}

export function runAll() {
  return allCases().map((c) => scoreCase(c));
}

// keys sorted at every depth and undefined left out, so the bytes depend on the data only
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonical(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function summary(rows) {
  const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
  return {
    cases: rows.length,
    cases_with_criteria: rows.filter((r) => r.criteria.length).length,
    tests: sum((r) => r.counts.tests),
    tied: sum((r) => r.counts.tied),
    untied: sum((r) => r.counts.untied),
    contradicts: sum((r) => r.counts.contradicts),
    false_ties: sum((r) => r.measured?.false_ties ?? 0),
    missed_ties: sum((r) => r.measured?.missed_ties ?? 0),
    false_contradictions: sum((r) => r.measured?.false_contradictions ?? 0),
    missed_contradictions: sum((r) => r.measured?.missed_contradictions ?? 0),
    invented_criteria: sum((r) => r.measured?.invented_criteria ?? 0),
    disagreements: sum((r) => r.tests.filter((t) => t.agrees === false).length),
    unlabelled: sum((r) => (r.measured ? r.measured.unlabelled : r.counts.tests)),
  };
}

export function main(argv = process.argv.slice(2)) {
  const at = argv.indexOf('--out');
  const out = at >= 0 && argv[at + 1] ? path.resolve(argv[at + 1]) : DEFAULT_OUT;
  const rows = runAll();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, rows.map((r) => `${canonical(r)}\n`).join(''));
  console.log(canonical(summary(rows)));
  return 0;
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
