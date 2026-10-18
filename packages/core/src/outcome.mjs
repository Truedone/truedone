// The one red-green table. judge() and the runner both call outcome().
// A timeout token is neither a pass nor a fail, so it falls through to the last row
// unless an earlier row already matched on the pass and fail tokens.
// Before the table: a test without two base runs and three head runs, because a run gave
// no result for it, is Could not run: incomplete runs, never No red-green evidence (RUN-06).

export function baseToken(run) {
  if (run.status === 'timeout') return 'timeout';
  if (run.status === 'pass') return 'pass';
  return `fail:${run.failure}`;
}

export function headToken(run) {
  if (run.status === 'timeout') return 'timeout';
  if (run.status === 'pass') return 'pass';
  return 'fail';
}

function failCount(tokens) {
  return tokens.filter((token) => token.startsWith('fail')).length;
}

export function outcome(row) {
  const base = row.base || [];
  const head = row.head || [];
  const condition = row.condition ?? 'none';
  const named = row.asserts_new_symbol === true;
  const allHeadPass = head.length > 0 && head.every((token) => token === 'pass');
  const bothAssertion = base.length === 2 && base.every((token) => token === 'fail:assertion');
  const bothMissing = base.length === 2 && base.every((token) => token === 'fail:missing');
  const conditionHolds = condition === 'lines' || condition === 'imports';

  if (base.length < 2 || head.length < 3) {
    return { result: 'Could not run: incomplete runs', reason: 'incomplete runs', detail: 'incomplete runs' };
  }
  if (bothAssertion && allHeadPass && conditionHolds) {
    return { result: 'Proven', reason: null, detail: null };
  }
  if (bothMissing && allHeadPass && named) {
    return { result: 'Proven (new behaviour)', reason: null, detail: null };
  }
  if ((bothAssertion || bothMissing) && allHeadPass) {
    return { result: 'Proven (weak)', reason: null, detail: null };
  }
  if (base.length === 2 && base.every((token) => token === 'pass') && allHeadPass) {
    return { result: 'No red-green evidence', reason: null, detail: null };
  }
  if (failCount(base) === 1 && base.filter((token) => token === 'pass').length === 1) {
    return { result: 'Could not run: flaky on base', reason: 'flaky', detail: 'flaky on base' };
  }
  const headPass = head.filter((token) => token === 'pass').length;
  if (headPass === 1 || headPass === 2) {
    return { result: 'Could not run: flaky on head', reason: 'flaky', detail: 'flaky on head' };
  }
  if (head.length === 3 && head.every((token) => token === 'fail')) {
    return { result: 'No red-green evidence', reason: 'fails on head', detail: 'fails on head' };
  }
  if (base.some((token) => token === 'fail:error')) {
    return { result: 'Could not run: errored', reason: 'error', detail: row.errorType || 'Error' };
  }
  if ([...base, ...head].includes('timeout')) {
    return { result: 'Could not run: timed out', reason: 'timeout', detail: 'a run exceeds 5 minutes' };
  }
  return { result: 'No red-green evidence', reason: null, detail: null };
}

export function verdictId(row) {
  const text = outcome(row).result || '';
  if (text === 'Proven') return 'proven';
  if (text === 'Proven (new behaviour)') return 'proven_new';
  if (text === 'Proven (weak)') return 'proven_weak';
  if (text.startsWith('Could not run')) return 'could_not_run';
  return 'no_evidence';
}
