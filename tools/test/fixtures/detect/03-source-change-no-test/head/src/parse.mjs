export function parseAmount(text) {
  const negative = text.startsWith('-');
  const n = Number(text.replace(/[-,]/g, ''));
  return negative ? -n : n;
}
