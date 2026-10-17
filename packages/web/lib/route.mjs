// The routes of truedone.pages.dev (WEB-01): /<owner>/<repo>/pull/<n>, /p/<owner>/<repo> and /. parseTarget reads what a
// visitor pastes on the home page: a github.com or truedone.pages.dev PR link, or owner/repo#n.
const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const REPO = '[A-Za-z0-9._-]{1,100}';

export function route(pathname) {
  let m = pathname.match(new RegExp(`^/(${OWNER})/(${REPO})/pull/([1-9][0-9]{0,9})/?$`));
  if (m && m[2] !== '.' && m[2] !== '..') return { kind: 'pr', owner: m[1], repo: m[2], number: Number(m[3]) };
  m = pathname.match(new RegExp(`^/p/(${OWNER})/(${REPO})/?$`));
  if (m && m[2] !== '.' && m[2] !== '..') return { kind: 'precomputed', owner: m[1], repo: m[2] };
  if (pathname === '/' || pathname === '/index.html') return { kind: 'home' };
  return { kind: 'not_found' };
}

export function parseTarget(text) {
  const s = String(text).trim();
  let m = s.match(new RegExp(`^(?:https?://)?(?:www\\.)?(?:github\\.com|truedone\\.pages\\.dev)/(${OWNER})/(${REPO})/pull/([1-9][0-9]{0,9})(?:[/?#].*)?$`));
  if (!m) m = s.match(new RegExp(`^(${OWNER})/(${REPO})#([1-9][0-9]{0,9})$`));
  if (!m || m[2] === '.' || m[2] === '..') return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]), path: `/${m[1]}/${m[2]}/pull/${m[3]}` };
}
