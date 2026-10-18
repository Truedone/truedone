// What npx truedone accepts as a PR (CLI-01): a github.com or truedone.pages.dev PR link, or owner/repo#n.
const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const REPO = '[A-Za-z0-9._-]{1,100}';

export function parseTarget(text) {
  const s = String(text).trim();
  let m = s.match(new RegExp(`^(?:https?://)?(?:www\\.)?(?:github\\.com|truedone\\.pages\\.dev)/(${OWNER})/(${REPO})/pull/([1-9][0-9]{0,9})(?:[/?#].*)?$`));
  if (!m) m = s.match(new RegExp(`^(${OWNER})/(${REPO})#([1-9][0-9]{0,9})$`));
  if (!m || m[2] === '.' || m[2] === '..') return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}
