export function isValid(token, now) {
  return token.expires > now;
}
