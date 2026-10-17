const LISTED = [
  'dependabot',
  'dependabot[bot]',
  'renovate',
  'renovate[bot]',
  'release-please',
  'release-please[bot]',
  'github-actions[bot]',
];

export function isListedBot(login) {
  return LISTED.includes(String(login || '').toLowerCase());
}
