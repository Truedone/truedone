// npx truedone report <PR link> (D39): the link to the wrong-verdict form on Truedone/truedone, filled with the pull request,
// its head and base commits, the verdict, its reason codes and the truedone version. The reporter says what is wrong (the form's
// kind field) and adds a note; nothing is sent from here. The form's field ids are pr, head, base, verdict, reasons, kind and
// version (.github/ISSUE_TEMPLATE/wrong-verdict.yml, COLLECT-01).
import { VERSION } from './constants.mjs';

export const FORM = 'https://github.com/Truedone/truedone/issues/new';

export function reportLink({ target, head, base, result, version = VERSION }) {
  const codes = [...new Set((result.reasons ?? []).map((r) => r.check).filter(Boolean))];
  const q = new URLSearchParams({
    template: 'wrong-verdict.yml',
    title: `Wrong verdict: ${target.owner}/${target.repo}#${target.number} (${result.verdict})`,
    pr: `https://github.com/${target.owner}/${target.repo}/pull/${target.number}`,
    head: head ?? '',
    base: base ?? '',
    verdict: result.verdict,
    reasons: codes.join(','),
    version,
  });
  return `${FORM}?${q}`;
}
