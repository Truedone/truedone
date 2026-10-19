export function total(items) {
  return Math.ceil(items.reduce((sum, n) => sum + n, 0));
}
