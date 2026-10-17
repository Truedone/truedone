// Combines the static verdict with red-green reports (D10, D11).
// Tampered and review stand. The first report of the latest attempt that
// reached a result counts. Across its tests the best result counts.

const STAND = new Set(['tampered', 'review']);
const RANK = ['proven', 'proven_new', 'proven_weak', 'no_evidence'];

function rowId(test) {
  const base = test.base || [];
  const head = test.head || [];
  const condition = test.condition || 'none';
  const named = test.asserts_new_symbol === true;
  const allHeadPass = head.length > 0 && head.every((token) => token === 'pass');
  const bothAssertion = base.length === 2 && base.every((token) => token === 'fail:assertion');
  const bothMissing = base.length === 2 && base.every((token) => token === 'fail:missing');
  const holds = condition === 'lines' || condition === 'imports';
  if (bothAssertion && allHeadPass && holds) return 'proven';
  if (bothMissing && allHeadPass && named) return 'proven_new';
  if ((bothAssertion || bothMissing) && allHeadPass) return 'proven_weak';
  if (base.length === 2 && base.every((token) => token === 'pass') && allHeadPass) return 'no_evidence';
  const baseFail = base.filter((token) => String(token).startsWith('fail')).length;
  const basePass = base.filter((token) => token === 'pass').length;
  if (baseFail === 1 && basePass === 1) return 'could_not_run';
  const headPass = head.filter((token) => token === 'pass').length;
  if (headPass === 1 || headPass === 2) return 'could_not_run';
  if (head.length === 3 && head.every((token) => token === 'fail')) return 'no_evidence';
  if (base.some((token) => token === 'fail:error')) return 'could_not_run';
  if ([...base, ...head].includes('timeout')) return 'could_not_run';
  return 'no_evidence';
}

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
    const ids = report.tests.map(rowId);
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
  const id = rowId(test);
  const name = test.name || 'a test';
  const cond = test.condition || 'none';
  const head = (test.head || []).join(',');
  return {
    check: 'red_green',
    file: test.file || '',
    message: `Test ${name} is ${id} on head ${head} with coverage ${cond}.`,
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
  return result(best(report.tests.map(rowId)), lines, partial);
}
