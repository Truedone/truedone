// Sign-in on truedone.pages.dev (WEB-02). start() keeps a random state and the page to return to in sessionStorage and
// hands over to the exchange Worker, which has an origin of its own (D26) and sends the visitor to GitHub. finish() runs
// on /signin/callback: it checks the state, posts the code to the Worker's /exchange, keeps the token in sessionStorage
// only, and goes back. The token is read by page.mjs and sent to api.github.com only (S8).
export const TOKEN_KEY = 'truedone.token';
// the exchange Worker; _headers lets the pages connect to it
const EXCHANGE = 'https://truedone-exchange.ledgerguard-global.workers.dev';
const STATE_KEY = 'truedone.state';
const RETURN_KEY = 'truedone.return';

// a same-site path only: never a scheme or another host
export const safeReturn = (p) => (typeof p === 'string' && /^\/(?!\/)[A-Za-z0-9._~/%-]*$/.test(p) ? p : '/');

export function readToken(storage) {
  try { return storage?.getItem(TOKEN_KEY) || null; } catch { return null; }
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
  if (!want || q.get('state') !== want || !q.get('code')) return { ok: false, why: 'The sign-in did not match this tab. Start it again.' };
  // the Worker is another origin: a fetch that rejects (Worker down, preflight refused) is an answer too
  const res = await fetch(`${EXCHANGE}/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: q.get('code') }) }).catch(() => null);
  if (!res) return { ok: false, why: 'The sign-in service did not answer. Start it again.' };
  const j = await res.json().catch(() => ({}));
  if (!res.ok || typeof j.token !== 'string') return { ok: false, why: 'GitHub did not complete the sign-in.' };
  storage.setItem(TOKEN_KEY, j.token);
  const back = safeReturn(storage.getItem(RETURN_KEY));
  storage.removeItem(RETURN_KEY);
  loc.replace(back);
  return { ok: true };
}

// 24 random bytes as base64url, from the browser's crypto
export const randomState = (crypto) => () => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
