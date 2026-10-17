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

export function judge(staticResult, reports) {
  const standing = staticResult && staticResult.verdict;
  if (STAND.has(standing)) {
    return { schema: 'truedone.verdict/1', verdict: standing };
  }
  const report = pick(reports);
  if (!report) {
    return { schema: 'truedone.verdict/1', verdict: standing || 'no_evidence' };
  }
  return { schema: 'truedone.verdict/1', verdict: best(report.tests.map(rowId)) };
}
