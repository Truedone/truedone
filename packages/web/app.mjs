// truedone.pages.dev (WEB-01): a static page with no build step. lib/page.mjs reads the route, loads the PR from GitHub in
// the visitor's browser and mounts core.analyse's result as text. The API and raw hosts can be pointed elsewhere
// only by <meta> tags in the served page, never by the URL, so a link cannot redirect the page's requests;
// tools/check-browser.mjs uses the tags to serve recorded responses.
import { analyse, classify } from './core.mjs';
import { page } from './lib/page.mjs';
import { API, RAW } from './lib/github.mjs';
import { randomState } from './lib/signin.mjs';

const session = () => { try { return globalThis.sessionStorage; } catch { return null; } };   // blocked storage throws
const meta = (name, fallback) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || fallback;
page(location, {
  fetch: (...a) => globalThis.fetch(...a), doc: document, root: document.getElementById('app'),
  analyse, classify, storage: session(), random: randomState(globalThis.crypto),
  api: meta('truedone-api', API), raw: meta('truedone-raw', RAW),
}).then(() => { document.documentElement.dataset.state = 'done'; });
