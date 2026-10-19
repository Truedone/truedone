// What each truedone.pages.dev page shows (WEB-01), as a plain tree that dom.mjs mounts with textContent only: PR text is
// never parsed as HTML (S7). Every page ends with the next rung, which says that red-green on someone else's PR
// executes that PR's code (PV-W05). The wording states what was observed and never addresses the PR's author.
// WEB-07: the verdict is a link to its section of /why; the label line says the app would set it; a reason that names
// its file is not prefixed with it, and reasons whose verdict is not the result's come after the others under "Also
// noted"; home links one example per verdict this static site can show; every footer offers sign-in.
// WEB-08: no sign-in link returns to the sign-in pages; a sign-in that did not complete says why and links to start
// again, back to the page the visitor came from; a PR read again after an expired sign-in says so; the rate-limit page
// says when the limit resets, in the visitor's local time.
// WEB-09: each reasons list has an accessible name, the first from a visually hidden label and the second from "Also
// noted"; titleOf names a view for document.title.
// WEB-11: a PR page shows the verdict ladder under its badge, the four rungs from Tampered to a green Proven with this
// PR's rung marked, and the line on where green comes from; home carries the line beside its examples.
// WEB-12: a surface not yet released (lib/release.mjs) says so wherever a page names it, with the link to follow the
// first release; home lists what works today.
// WEB-14 (D38, D39): a PR page offers the App's install for its repository, marked not released until release.mjs flips,
// and "This verdict is wrong", a link to the wrong-verdict form filled with the PR, its commits, the verdict, the reason
// codes and this site as the version, with no PR text.
// A node is { tag, text?, attrs?, children? }.
import { RELEASED, FOLLOW, SURFACES } from './release.mjs';
import { route } from './route.mjs';

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
// the class of each verdict's badge: verdict-<its label without truedone:>; Not applicable sets no label, so none
export const BADGE = {
  tampered: 'tampered', review: 'review', could_not_run: 'could-not-run', proven: 'yes', proven_new: 'yes',
  proven_weak: 'weak', no_evidence: 'no-evidence', pending: 'pending', unrun: 'unrun', not_applicable: 'none',
};
export const badgeClass = (verdict) => `verdict verdict-${BADGE[verdict] ?? 'none'}`;
// the verdict's section of /why: truedone-<label without truedone:>; Not applicable sets no label, so /why itself
export const whyHref = (verdict) => (BADGE[verdict] && verdict !== 'not_applicable' ? `/why#truedone-${BADGE[verdict]}` : '/why');
// one public pull request page per verdict the diff alone can give, each checked live on this site before it was added
export const EXAMPLES = [
  ['tampered', '/Truedone/truedone-sandbox/pull/31'],
  ['review', '/Truedone/truedone/pull/17'],
  ['no_evidence', '/Truedone/truedone/pull/47'],
  ['unrun', '/Truedone/truedone/pull/54'],
  ['not_applicable', '/Truedone/truedone/pull/43'],
];
// a visitor sent back to /signin/callback would finish a state already used, so the sign-in pages return to /
const signinPage = (path) => path === '/signin' || path.startsWith('/signin/');
export const signinHref = (path) => `/signin?return=${encodeURIComponent(path && !signinPage(path) ? path : '/')}`;
// x-ratelimit-reset, seconds since the epoch, as the visitor's local hour and minute
export const resetTime = (reset) => new Date(reset * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
export const TAGLINE = 'Checks whether a pull request\'s tests prove its change: red without it, green with it.';
export const FOOTER_LINKS = [['Why', '/why'], ['Privacy', '/privacy'], ['Terms', '/terms'], ['GitHub', 'https://github.com/Truedone/truedone']];
// AGENT-02 (D40): the home page, /why and the PR page link /llms.txt for coding agents, after the four links
export const AGENTS_LINK = ['For coding agents', '/llms.txt'];
const agentsPage = (path) => ['home', 'pr'].includes(route(path).kind);
export const MAX_REASONS = 10;
export const INSTALL_HREF = 'https://github.com/apps/truedone/installations/new';
export const REPORT_FORM = 'https://github.com/Truedone/truedone/issues/new';
export const SITE_VERSION = 'truedone.pages.dev';
// the wrong-verdict form (COLLECT-01) filled from what this page read: the PR's link, its commits, the verdict and the
// reasons' check codes, never a title, body, author or message
export function reportHref(result, pr) {
  const reasons = [...new Set((result.reasons ?? []).map((r) => r.check).filter(Boolean))].join(',');
  const q = new URLSearchParams({ template: 'wrong-verdict.yml', pr: pr.url, head: pr.head ?? '', base: pr.base ?? '', verdict: result.verdict, reasons, version: SITE_VERSION });
  return `${REPORT_FORM}?${q}`;
}
// the rungs the diff and a red-green run can give, from Tampered up to Proven; Proven (new behaviour) shares Proven's
// label and rung, and a verdict on no rung (No red-green evidence, Could not run, Waiting, Proven (weak)) marks none
export const LADDER = ['tampered', 'review', 'unrun', 'proven'];
const RUNG_OF = { proven_new: 'proven' };
export const NEXT_RUNG_COMMAND = 'npx truedone <PR link> --run';
export const RED_GREEN_WARNING = "Red-green on someone else's PR executes that PR's code on your machine; --docker runs it in a container.";

const el = (tag, text, attrs, children) => ({ tag, ...(text !== undefined ? { text: String(text) } : {}), ...(attrs ? { attrs } : {}), ...(children ? { children } : {}) });

// every page: the name and what it does above, the four links below
export function siteHeader() {
  return el('header', undefined, { class: 'site-header' }, [
    el('p', undefined, { class: 'name' }, [el('a', 'truedone', { href: '/' })]),
    el('p', TAGLINE, { class: 'tagline' }),
  ]);
}

// the four links, on the home and PR pages the link for coding agents, then sign-in, which returns to the page it was
// offered on (WEB-02)
export function siteFooter(path = '/') {
  return el('footer', undefined, { class: 'site-footer' }, [
    el('ul', undefined, undefined, [
      ...[...FOOTER_LINKS, ...(agentsPage(path) ? [AGENTS_LINK] : [])].map(([text, href]) => el('li', undefined, undefined, [el('a', text, { href })])),
      el('li', undefined, { class: 'signin-item' }, [el('a', 'Sign in with GitHub', { href: signinHref(path) })]),
    ]),
  ]);
}

// a view's main between the header and the footer; page.mjs mounts every view through it, with the page's path
export function shell(main, path = '/') {
  return el('div', undefined, { class: 'page' }, [siteHeader(), main, siteFooter(path)]);
}

// the line under the ladder, and beside home's examples: the site reads the diff, so green needs a run
export function greenLine() {
  return el('p', undefined, { class: 'green-line' }, [el('span', 'Green comes from running the tests: '), el('a', 'add the truedone step', { href: '/why#truedone-yes' })]);
}

// "Not released yet" for a surface release.mjs still holds false, with the link to follow the first release
export function notReleased(surface) {
  return RELEASED[surface] ? [] : [el('p', undefined, { class: `not-released not-released-${surface}` }, [el('span', 'Not released yet: '), el('a', 'follow the first release', { href: FOLLOW }), el('span', '.')])];
}
const greenBlock = () => [greenLine(), ...notReleased('action')];

// the four rungs in order, this PR's marked by aria-current and a visible "(this PR)", so not by colour alone; Proven
// always in the green badge style
export function ladder(verdict) {
  const at = LADDER.includes(verdict) ? verdict : RUNG_OF[verdict] ?? null;
  return el('div', undefined, { class: 'ladder-block' }, [
    el('ol', undefined, { class: 'ladder', 'aria-label': 'The verdict ladder' }, LADDER.map((v) => el('li', undefined, v === at ? { 'aria-current': 'step' } : undefined, [
      el('span', VERDICTS[v], { class: v === at || v === 'proven' ? badgeClass(v) : 'rung' }),
      ...(v === at ? [el('span', ' (this PR)', { class: 'this-pr' })] : []),
    ]))),
    ...greenBlock(),
  ]);
}

// verdict: whether the page shows a verdict, the only kind of page whose reading of the diff can be claimed
export function nextRung(link, { verdict = false } = {}) {
  return el('section', undefined, { class: 'next' }, [
    el('h2', 'Next rung: run the PR\'s own tests on your machine'),
    el('p', verdict ? 'This page reads the diff only. To run the PR\'s own tests against base and head, run:' : 'To run a pull request\'s own tests against base and head, run:'),
    el('pre', link ? `npx truedone ${link} --run` : NEXT_RUNG_COMMAND),
    ...notReleased('cli'),
    el('p', RED_GREEN_WARNING, { class: 'warning' }),
    el('p', 'For your own agent, the truedone Claude Code plugin runs the same checks before it reports a task done.'),
    ...notReleased('plugin'),
  ]);
}

// the reasons that give the verdict, then, under "Also noted", those whose own verdict is lesser (CORE-09). A reason
// with no file, such as the partial note, or whose message already names its file, is its message alone.
function reasonLists(reasons, verdict) {
  const shown = reasons.slice(0, MAX_REASONS);
  const where = (r) => (r.file && !r.message.includes(r.file) ? `${r.file}${r.line ? `:${r.line}` : ''}: ` : '');
  const item = (r) => el('li', `${where(r)}${r.message}`);
  const main = shown.filter((r) => (r.verdict ?? verdict) === verdict).map(item);
  const also = shown.filter((r) => (r.verdict ?? verdict) !== verdict).map(item);
  if (reasons.length > shown.length) (also.length ? also : main).push(el('li', `${reasons.length - shown.length} more not shown`));
  const out = [];
  if (main.length) out.push(el('p', 'Reasons for the verdict', { class: 'visually-hidden', id: 'reasons-label' }), el('ul', undefined, { class: 'reasons', 'aria-labelledby': 'reasons-label' }, main));
  if (also.length) out.push(el('p', 'Also noted', { class: 'also', id: 'also-noted' }), el('ul', undefined, { class: 'reasons also-list', 'aria-labelledby': 'also-noted' }, also));
  return out;
}

// expired: the PR's path when the page dropped a token GitHub no longer accepts and read the PR without it
export function prView(result, pr, { truncated = false, analysed = 0, expired = null } = {}) {
  const name = VERDICTS[result.verdict] ?? result.verdict;
  const children = [
    ...(expired ? [el('p', undefined, { class: 'notice' }, [
      el('span', 'Your GitHub sign-in has expired, so this page was read without it. '),
      el('a', 'Sign in with GitHub', { href: signinHref(expired), class: 'signin' }),
    ])] : []),
    el('p', `${pr.owner}/${pr.repo}#${pr.number}`, { class: 'target' }),
    el('h1', pr.title, { class: 'title' }),
    // the badge is the verdict's name alone, a link to what it means; "Verdict: " is there for screen readers and the
    // tools that read the page (check-browser, the web bench), out of sight
    el('p', undefined, { class: 'verdict-line' }, [
      el('span', 'Verdict: ', { class: 'visually-hidden' }),
      el('a', `${name}${result.partial || truncated ? ' (partial)' : ''}`, { class: badgeClass(result.verdict), href: whyHref(result.verdict) }),
    ]),
  ];
  if (result.verdict !== 'not_applicable') children.push(ladder(result.verdict));
  if (result.label) children.push(el('p', `Label the app would set: ${result.label}`, { class: 'label' }));
  if (truncated) children.push(el('p', `Analysed ${analysed} of the ${pr.changed_files} changed files.`, { class: 'partial' }));
  if (result.reasons?.length) children.push(...reasonLists(result.reasons, result.verdict));
  if (result.next) children.push(el('p', `What would change the verdict: ${result.next}`, { class: 'change' }));
  children.push(el('p', undefined, undefined, [el('a', 'The PR on GitHub', { href: pr.url })]));
  children.push(el('p', undefined, { class: 'install' }, [el('a', `Install on ${pr.owner}/${pr.repo}`, { href: INSTALL_HREF })]), ...notReleased('app'));
  children.push(el('p', undefined, { class: 'report' }, [el('a', 'This verdict is wrong', { href: reportHref(result, pr) })]));
  children.push(nextRung(pr.url, { verdict: true }));
  return el('main', undefined, undefined, children);
}

// document.title for a view (WCAG 2.4.2): a PR page names its verdict and the PR; any other view, its heading
export const SITE_TITLE = ' - truedone';
export function titleOf(view, { result = null, pr = null } = {}) {
  if (result && pr) return `${VERDICTS[result.verdict] ?? result.verdict}: ${pr.owner}/${pr.repo}#${pr.number}${SITE_TITLE}`;
  const h1 = (function find(n) { return n.tag === 'h1' ? n : (n.children ?? []).map(find).find(Boolean); })(view);
  return `${h1?.text ?? 'truedone'}${SITE_TITLE}`;
}

export function precomputedView(data, owner, repo) {
  const rows = (data.prs ?? []).map((p) => el('li', undefined, undefined, [
    el('a', `#${p.number} ${p.title ?? ''}`, { href: `/${owner}/${repo}/pull/${p.number}` }),
    el('span', VERDICTS[p.result?.verdict] ?? p.result?.verdict ?? '', { class: badgeClass(p.result?.verdict) }),
  ]));
  return el('main', undefined, undefined, [
    el('h1', `${owner}/${repo}: the last ${rows.length} PRs`),
    el('p', `Precomputed${data.computed_at ? ` at ${data.computed_at}` : ''}${data.core_version ? ` with core ${data.core_version}` : ''}, from the diff alone.`, { class: 'precomputed' }),
    el('ul', undefined, { class: 'prs' }, rows),
    nextRung(null, { verdict: true }),
  ]);
}

// a repository with no precomputed list: the site serves its single page for a missing file, so this says so plainly
export function noListView(owner, repo) {
  return el('main', undefined, undefined, [
    el('h1', `${owner}/${repo} has no list yet`),
    el('p', 'Lists are precomputed for a few public repositories. Paste a pull request link on the home page to check one.'),
    el('p', undefined, undefined, [el('a', 'Check a pull request', { href: '/' })]),
    nextRung(null),
  ]);
}

export function homeView() {
  return el('main', undefined, undefined, [
    el('h1', 'Check a pull request'),
    el('p', 'Paste a GitHub pull request link to see what its diff shows about its tests.'),
    el('form', undefined, { id: 'go' }, [
      el('input', undefined, { name: 'target', type: 'text', placeholder: 'https://github.com/owner/repo/pull/1', 'aria-label': 'Pull request link' }),
      el('button', 'Check', { type: 'submit' }),
    ]),
    el('h2', 'Examples'),
    el('ul', undefined, { class: 'examples' }, EXAMPLES.map(([verdict, href]) => el('li', undefined, undefined, [
      el('a', VERDICTS[verdict], { href, class: badgeClass(verdict) }),
      el('span', ` ${href.slice(1).replace(/\/pull\//, '#')}`, { class: 'example-target' }),
    ]))),
    ...greenBlock(),
    ...worksToday(),
    nextRung(null),
  ]);
}

// home's "What works today": this site now, and each surface release.mjs holds false as coming with the first release
const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
export function worksToday() {
  const names = (on) => Object.keys(SURFACES).filter((s) => RELEASED[s] === on).map((s) => SURFACES[s]);
  const now = names(true);
  const later = names(false);
  const items = [el('li', `This site checks any public pull request now${now.length ? `, and ${and(now)} ${now.length > 1 ? 'are' : 'is'} released` : ''}.`)];
  if (later.length) {
    const who = and(later);
    items.push(el('li', undefined, undefined, [el('span', `${who[0].toUpperCase()}${who.slice(1)} come${later.length > 1 ? '' : 's'} with the first release: `), el('a', 'follow it on GitHub', { href: FOLLOW }), el('span', '.')]));
  }
  return [el('h2', 'What works today'), el('ul', undefined, { class: 'works-today' }, items)];
}

// reset: x-ratelimit-reset when GitHub sent it (RateLimited.reset), else null
export function rateLimitView(returnPath, reset = null) {
  return el('main', undefined, undefined, [
    el('h1', 'GitHub\'s hourly limit for anonymous reads is used up'),
    el('p', 'Sign in with GitHub to keep going. The sign-in asks for no scopes, and the token stays in this tab.'),
    ...(Number.isFinite(reset) ? [el('p', `The limit resets at ${resetTime(reset)}, your local time.`, { class: 'reset' })] : []),
    el('p', undefined, undefined, [el('a', 'Sign in with GitHub', { href: signinHref(returnPath), class: 'signin' })]),
    nextRung(null),
  ]);
}

// a sign-in that did not complete: its line, and in the same paragraph the link to start again, back to the kept page
export function signinErrorView(line, back) {
  return el('main', undefined, undefined, [
    el('h1', 'The sign-in did not complete'),
    el('p', undefined, { class: 'signin-error' }, [el('span', `${line} `), el('a', 'Start it again', { href: signinHref(back), class: 'signin' }), el('span', '.')]),
    nextRung(null),
  ]);
}

export function errorView(message) {
  return el('main', undefined, undefined, [el('h1', 'This page could not be shown'), el('p', message), nextRung(null)]);
}

export function notFoundView() {
  return el('main', undefined, undefined, [el('h1', 'Not a truedone.pages.dev page'), el('p', 'truedone.pages.dev pages look like /owner/repo/pull/123.'), nextRung(null)]);
}
