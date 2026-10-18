// Sign-in on truedone.pages.dev (WEB-02). start() keeps a random state and the page to return to in sessionStorage and
// hands over to the exchange Worker, which has an origin of its own (D26) and sends the visitor to GitHub. finish() runs
// on /signin/callback: it checks the state, posts the code to the Worker's /exchange, keeps the token in sessionStorage
// only, and goes back. The token is read by page.mjs and sent to api.github.com only (S8). WEB-08: a failed callback
// returns the kept page with its line, so the error page's links start again back to it; GitHub's error answer after
// a matching state (a cancel is access_denied) has its own line.
export const TOKEN_KEY = 'truedone.token';
// the exchange Worker; _headers lets the pages connect to it
const EXCHANGE = 'https://truedone-exchange.ledgerguard-global.workers.dev';
const STATE_KEY = 'truedone.state';
const RETURN_KEY = 'truedone.return';

// the callback's lines; GitHub's own error values are named only from this list, never echoed from the URL
export const LINES = {
  mismatch: 'The sign-in did not match this tab.',
  cancelled: 'The sign-in was cancelled on GitHub.',
  stopped: 'GitHub stopped the sign-in',
  silent: 'The sign-in service did not answer.',
  refused: 'GitHub did not complete the sign-in.',
};
const GITHUB_ERRORS = new Set(['redirect_uri_mismatch', 'application_suspended']);

// a same-site path only: never a scheme or another host
export const safeReturn = (p) => (typeof p === 'string' && /^\/(?!\/)[A-Za-z0-9._~/%-]*$/.test(p) ? p : '/');

export function readToken(storage) {
  try { return storage?.getItem(TOKEN_KEY) || null; } catch { return null; }
}

// a token GitHub no longer accepts (WEB-08): page.mjs drops it and reads as an anonymous visitor
export function dropToken(storage) {
  try { storage?.removeItem(TOKEN_KEY); } catch { /* storage refused */ }
}

export function start(loc, storage, random) {
  const state = random();
  storage.setItem(STATE_KEY, state);
  storage.setItem(RETURN_KEY, safeReturn(new URLSearchParams(loc.search).get('return')));
  loc.assign(`${EXCHANGE}/exchange/start?state=${encodeURIComponent(state)}`);
}

export async function finish(loc, storage, fetch) {
  const q = new URLSearchParams(loc.search);
  const want = storage.getItem(STATE_KEY);
  storage.removeItem(STATE_KEY);
  const back = safeReturn(storage.getItem(RETURN_KEY));
  const no = (why) => ({ ok: false, why, back });
  if (!want || q.get('state') !== want) return no(LINES.mismatch);
  // GitHub answers a cancel, or an app it cannot sign in to, with an error and no code
  const error = q.get('error');
  if (error !== null) return no(error === 'access_denied' ? LINES.cancelled : `${LINES.stopped}${GITHUB_ERRORS.has(error) ? ` (${error})` : ''}.`);
  if (!q.get('code')) return no(LINES.mismatch);
  // the Worker is another origin: a fetch that rejects (Worker down, preflight refused) is an answer too
  const res = await fetch(`${EXCHANGE}/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: q.get('code') }) }).catch(() => null);
  if (!res) return no(LINES.silent);
  const j = await res.json().catch(() => ({}));
  if (!res.ok || typeof j.token !== 'string') return no(LINES.refused);
  storage.setItem(TOKEN_KEY, j.token);
  storage.removeItem(RETURN_KEY);
  loc.replace(back);
  return { ok: true };
}

// 24 random bytes as base64url, from the browser's crypto
export const randomState = (crypto) => () => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
