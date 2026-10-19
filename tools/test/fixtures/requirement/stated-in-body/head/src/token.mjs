export function isValid(token, now) {
  return token.expires > now;
}

export function stamp(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
