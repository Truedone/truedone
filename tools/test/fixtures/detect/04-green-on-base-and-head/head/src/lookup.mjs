export function lookup(table, name) {
  return table[name.trim()] ?? null;
}
