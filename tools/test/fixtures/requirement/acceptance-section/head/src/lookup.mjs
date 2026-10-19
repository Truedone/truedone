export function lookup(table, name) {
  const key = name.trim();
  if (!key) throw new Error('a blank name');
  return table[key] ?? null;
}
