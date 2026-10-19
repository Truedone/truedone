export function total(items) {
  return Math.round(items.reduce((sum, n) => sum + n, 0));
}
