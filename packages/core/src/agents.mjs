export function isAgent(login) {
  const name = String(login || '').toLowerCase();
  return name.includes('copilot') || name.includes('devin');
}
