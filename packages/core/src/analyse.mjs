import { staticFindings } from './checks.mjs';
import { isListedBot } from './bots.mjs';
import { isAgent } from './agents.mjs';
import { FILES, LINES, FETCHED } from './limits.mjs';
import { bot, language, partial as partialMessage, skip_focus, nextStep } from './messages.mjs';

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

export function analyse(input = {}) {
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
