// What each truedone.pages.dev page shows (WEB-01), as a plain tree that dom.mjs mounts with textContent only: PR text is
// never parsed as HTML (S7). Every page ends with the next rung, which says that red-green on someone else's PR
// executes that PR's code (PV-W05). The wording states what was observed and never addresses the PR's author.
// A node is { tag, text?, attrs?, children? }.
export const VERDICTS = {
  tampered: 'Tampered',
  review: 'Test changes: review',
  could_not_run: 'Could not run',
  proven: 'Proven',
  proven_new: 'Proven (new behaviour)',
  proven_weak: 'Proven (weak)',
  no_evidence: 'No red-green evidence',
  pending: 'Waiting for approval',
  unrun: 'Tests changed: not run',
  not_applicable: 'Not applicable',
};
export const MAX_REASONS = 10;
export const NEXT_RUNG_COMMAND = 'npx truedone <PR link> --run';
export const RED_GREEN_WARNING = "Red-green on someone else's PR executes that PR's code on your machine; --docker runs it in a container.";

const el = (tag, text, attrs, children) => ({ tag, ...(text !== undefined ? { text: String(text) } : {}), ...(attrs ? { attrs } : {}), ...(children ? { children } : {}) });

export function nextRung(link) {
  return el('section', undefined, { class: 'next' }, [
    el('h2', 'Next rung: red-green on your machine'),
    el('p', 'This page reads the diff only. To run the PR\'s own tests against base and head, run:'),
    el('pre', link ? `npx truedone ${link} --run` : NEXT_RUNG_COMMAND),
    el('p', RED_GREEN_WARNING, { class: 'warning' }),
    el('p', 'For your own agent, the truedone Claude Code plugin runs the same checks before it reports a task done.'),
  ]);
}

function reasonList(reasons) {
  const shown = reasons.slice(0, MAX_REASONS);
  const items = shown.map((r) => el('li', `${r.file}${r.line ? `:${r.line}` : ''}: ${r.message}`));
  if (reasons.length > shown.length) items.push(el('li', `${reasons.length - shown.length} more not shown`));
  return el('ul', undefined, { class: 'reasons' }, items);
}

export function prView(result, pr, { truncated = false, analysed = 0 } = {}) {
  const name = VERDICTS[result.verdict] ?? result.verdict;
  const children = [
    el('p', `${pr.owner}/${pr.repo}#${pr.number}`, { class: 'target' }),
    el('h1', pr.title, { class: 'title' }),
    el('p', `Verdict: ${name}${result.partial || truncated ? ' (partial)' : ''}`, { class: `verdict v-${result.verdict}` }),
  ];
  if (result.label) children.push(el('p', `Label: ${result.label}`, { class: 'label' }));
  if (truncated) children.push(el('p', `Analysed ${analysed} of the ${pr.changed_files} changed files.`, { class: 'partial' }));
  if (result.reasons?.length) children.push(reasonList(result.reasons));
  if (result.next) children.push(el('p', `What would change the verdict: ${result.next}`, { class: 'change' }));
  children.push(el('p', undefined, undefined, [el('a', 'The PR on GitHub', { href: pr.url })]));
  children.push(nextRung(pr.url));
  return el('main', undefined, undefined, children);
}

export function precomputedView(data, owner, repo) {
  const rows = (data.prs ?? []).map((p) => el('li', undefined, undefined, [
    el('a', `#${p.number} ${p.title ?? ''}`, { href: `/${owner}/${repo}/pull/${p.number}` }),
    el('span', ` ${VERDICTS[p.result?.verdict] ?? p.result?.verdict ?? ''}`, { class: `verdict v-${p.result?.verdict}` }),
  ]));
  return el('main', undefined, undefined, [
    el('h1', `${owner}/${repo}: the last ${rows.length} PRs`),
    el('p', `Precomputed${data.computed_at ? ` at ${data.computed_at}` : ''}${data.core_version ? ` with core ${data.core_version}` : ''}, from the diff alone.`, { class: 'precomputed' }),
    el('ul', undefined, { class: 'prs' }, rows),
    nextRung(null),
  ]);
}

export function homeView() {
  return el('main', undefined, undefined, [
    el('h1', 'truedone'),
    el('p', 'Paste a GitHub pull request link to see what its diff shows about its tests.'),
    el('form', undefined, { id: 'go' }, [
      el('input', undefined, { name: 'target', type: 'text', placeholder: 'https://github.com/owner/repo/pull/1', 'aria-label': 'Pull request link' }),
      el('button', 'Check', { type: 'submit' }),
    ]),
    nextRung(null),
  ]);
}

export function rateLimitView(returnPath) {
  return el('main', undefined, undefined, [
    el('h1', 'GitHub\'s hourly limit for anonymous reads is used up'),
    el('p', 'Sign in with GitHub to keep going. The sign-in asks for no scopes, and the token stays in this tab.'),
    el('p', undefined, undefined, [el('a', 'Sign in with GitHub', { href: `/signin?return=${encodeURIComponent(returnPath)}`, class: 'signin' })]),
    nextRung(null),
  ]);
}

export function errorView(message) {
  return el('main', undefined, undefined, [el('h1', 'This page could not be shown'), el('p', message), nextRung(null)]);
}

export function notFoundView() {
  return el('main', undefined, undefined, [el('h1', 'Not a truedone.pages.dev page'), el('p', 'truedone.pages.dev pages look like /owner/repo/pull/123.'), nextRung(null)]);
}
