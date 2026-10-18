// Combines the static verdict with red-green reports (D10, D11).
// Tampered and review stand. The first report of the latest attempt that
// reached a result counts. Across its tests the best result counts.

import { verdictId } from './outcome.mjs';
import { nextStep } from './messages.mjs';

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

export function judge(staticResult, reports) {
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
  // a line about another report gives no verdict of its own: it carries the result's
  for (const other of same) {
    lines.push({ check: 'report', file: '', message: `Report ${other.job || 'a job'} is on the same attempt.`, verdict });
  }
  return result(verdict, lines, partial);
}
