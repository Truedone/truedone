// The token exchange (WEB-02, PV-W02): the only server code of the site, a Cloudflare Worker on an origin of its own,
// https://truedone-exchange.ledgerguard-global.workers.dev, while the site is https://truedone.pages.dev (D26).
// GET /exchange/start?state=<s> sends the visitor to GitHub's authorization page for the GitHub App, with the callback
// on the site; POST /exchange with {code}, from the site's pages only, trades the code for a user token and returns it.
// The answers to the site, and the preflight before its post, allow the site's origin and no other. The Worker has no
// storage binding and no state between requests, and it logs nothing. GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are
// Worker secrets that Ryan sets (OPS-02, S5); the secret never leaves the Worker.
const SITE = 'https://truedone.pages.dev';
const CORS = { 'access-control-allow-origin': SITE };
const AUTHORIZE = 'https://github.com/login/oauth/authorize';
const TOKEN = 'https://github.com/login/oauth/access_token';
const STATE = /^[A-Za-z0-9_-]{16,128}$/;
const CODE = /^[A-Za-z0-9_-]{1,100}$/;

const reply = (status, body, headers = {}) => new Response(body === null ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
});

export async function handle(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  const fromSite = request.headers.get('origin') === SITE;
  if (url.pathname === '/exchange' && request.method === 'OPTIONS') {
    if (!fromSite) return reply(403, { error: 'wrong origin' });
    return reply(204, null, { ...CORS, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' });
  }
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return reply(500, { error: 'not configured' }, fromSite ? CORS : {});
  if (url.pathname === '/exchange/start' && request.method === 'GET') {
    const state = url.searchParams.get('state') ?? '';
    if (!STATE.test(state)) return reply(400, { error: 'bad state' });
    const to = new URL(AUTHORIZE);
    to.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    to.searchParams.set('redirect_uri', `${SITE}/signin/callback`);
    to.searchParams.set('state', state);
    return reply(302, null, { location: to.toString() });
  }
  if (url.pathname === '/exchange' && request.method === 'POST') {
    if (!fromSite) return reply(403, { error: 'wrong origin' });
    let code;
    try { ({ code } = await request.json()); } catch { /* not JSON */ }
    if (typeof code !== 'string' || !CODE.test(code)) return reply(400, { error: 'bad code' }, CORS);
    const res = await fetchImpl(TOKEN, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
    });
    let j = {};
    try { j = await res.json(); } catch { /* not JSON */ }
    if (!res.ok || typeof j.access_token !== 'string') return reply(502, { error: typeof j.error === 'string' ? j.error : 'exchange failed' }, CORS);
    return reply(200, { token: j.access_token }, CORS);
  }
  return reply(404, { error: 'not found' });
}

export default { fetch: (request, env) => handle(request, env) };
