// Test doubles for the web tests: a fetch that answers from test/fixtures/api (recorded GitHub responses) and counts
// requests per host, a DOM whose elements accept only the members lib/dom.mjs uses (any other property write
// throws, so markup can never be set), and stand-ins for core's analyse and classify. Real core.mjs is checked in
// Chromium by tools/check-browser.mjs.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../fixtures/api/', import.meta.url));
export const recorded = JSON.parse(fs.readFileSync(DIR + 'index.json', 'utf8'));

function response(status, body, headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { status, ok: status >= 200 && status < 300, headers: { get: (k) => h.get(k.toLowerCase()) ?? null }, json: async () => JSON.parse(body), text: async () => body };
}

// override: { '<full url>': { status, body, headers } } answered before the recording
export function fakeFetch(override = {}) {
  const log = [];
  const fetch = async (url, init = {}) => {
    log.push({ url, headers: { ...(init.headers ?? {}) } });
    if (override[url]) { const o = override[url]; return response(o.status, o.body ?? '', o.headers); }
    const u = new URL(url);
    const table = u.host === 'api.github.com' ? recorded.api : u.host === 'raw.githubusercontent.com' ? recorded.raw : null;
    const hit = table?.[u.pathname + u.search];
    if (!hit) return response(404, '{"message":"Not Found"}');
    return response(hit.status, fs.readFileSync(DIR + hit.file, 'utf8'));
  };
  const count = (host) => log.filter((r) => new URL(r.url).host === host).length;
  return { fetch, log, count };
}

const MEMBERS = new Set(['tag', 'attrs', 'children', 'textContent', 'listeners']);
function element(tag) {
  const e = {
    tag, attrs: {}, children: [], textContent: '', listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
    replaceChildren(...c) { this.children = c; },
    addEventListener(t, f) { this.listeners[t] = f; },
  };
  return new Proxy(e, { set(t, k, v) { if (!MEMBERS.has(k)) throw new Error(`the page wrote ${String(k)} on <${tag}>`); t[k] = v; return true; } });
}
export function fakeDoc() {
  const made = [];
  const doc = { createElement: (t) => { const e = element(t); made.push(e); return e; }, getElementById: () => null };
  return { doc, made, root: element('div') };
}
// All text under an element, in order
export const textOf = (e) => [e.textContent, ...e.children.map(textOf)].filter(Boolean).join('\n');
export const find = (e, pred) => (pred(e) ? [e] : []).concat(...e.children.map((c) => find(c, pred)));

export const classify = (p) => (/\.test\.js$/.test(p) ? 'test' : p.startsWith('.github/workflows/') ? 'workflow' : /^jest\.config\./.test(p) ? 'runner_config' : 'source');
export const verdict = (over = {}) => ({ schema: 'truedone.verdict/1', verdict: 'unrun', label: 'truedone:unrun', partial: false, reasons: [], next: 'a red-green run of the changed tests', ...over });
