// node tools/app-listing-check.mjs [--slug <slug>] [--urls] (OPS-09): the production App's public page equals its record,
// packages/app/app-manifest.json. GitHub answers https://api.github.com/apps/<slug> without a token only for a public
// app, so a 404 means the app is private or gone. The check compares the description, the homepage (external_url
// against the manifest's url), the permissions and the subscribed events, and names every difference. GitHub stores a
// description typed into its settings form with CRLF line ends, so line ends are compared as LF and trailing blank
// space at the end is ignored; every other byte must match. An empty description is a difference on its own. With --urls
// the check also reads every URL the manifest names (the homepage and each callback) live, and fails on any status other
// than 200 or a redirect: the setup URL and the Worker callback the page once named answered 404 (2026-10-18), so a new
// user landed on an error page after installing. No dependencies; unauthenticated requests only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST = path.join(ROOT, 'packages/app/app-manifest.json');

const text = (s) => String(s ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
const sorted = (o) => JSON.stringify(Object.keys(o ?? {}).sort().map((k) => [k, o[k]]));

// Pure: every difference between the manifest and GitHub's answer for the app, as one line each; [] when they match.
export function compare(manifest, status, app) {
  if (status !== 200) return [`GitHub answered ${status} for the app without a token; a public app answers 200`];
  const problems = [];
  if (!manifest.public) problems.push('the manifest does not say public: true');
  if (!text(manifest.description)) problems.push('the manifest has no description');
  if (text(app.description) !== text(manifest.description)) problems.push('the description differs from the manifest\'s');
  if ((app.external_url ?? '') !== (manifest.url ?? '')) problems.push(`the homepage is ${JSON.stringify(app.external_url)}, the manifest says ${JSON.stringify(manifest.url)}`);
  if (sorted(app.permissions) !== sorted(manifest.default_permissions)) {
    problems.push(`the permissions are ${sorted(app.permissions)}, the manifest says ${sorted(manifest.default_permissions)}`);
  }
  const ev = (a) => JSON.stringify([...(a ?? [])].sort());
  if (ev(app.events) !== ev(manifest.default_events)) problems.push(`the events are ${ev(app.events)}, the manifest says ${ev(manifest.default_events)}`);
  return problems;
}

// The URLs the manifest names: the homepage and each callback. A setup URL is never named, so none is read.
export const namedUrls = (manifest) => [manifest.url, ...(manifest.callback_urls ?? [])].filter(Boolean);

// Reads each URL without following redirects; a status of 200 or any redirect passes. Returns one line per URL that does
// not, or whose request fails.
export async function checkUrls(manifest, fetchImpl = fetch) {
  const problems = [];
  for (const url of namedUrls(manifest)) {
    try {
      const r = await fetchImpl(url, { redirect: 'manual', headers: { 'user-agent': 'truedone-app-listing-check' } });
      const ok = r.status === 200 || (r.status >= 300 && r.status < 400);
      if (!ok) problems.push(`${url} answered ${r.status}; the manifest names it, so it must answer 200 or a redirect`);
    } catch (err) {
      problems.push(`${url} could not be read: ${err?.message ?? err}`);
    }
  }
  return problems;
}

export async function fetchApp(slug, fetchImpl = fetch) {
  const r = await fetchImpl(`https://api.github.com/apps/${encodeURIComponent(slug)}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'truedone-app-listing-check' },
  });
  return { status: r.status, app: r.status === 200 ? await r.json() : null };
}

async function main(argv) {
  const i = argv.indexOf('--slug');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const slug = i >= 0 ? argv[i + 1] : manifest.name;
  const { status, app } = await fetchApp(slug);
  const problems = compare(manifest, status, app);
  const urls = argv.includes('--urls');
  if (urls) problems.push(...(await checkUrls(manifest)));
  for (const p of problems) console.error(`app-listing-check: ${p}`);
  if (problems.length) process.exit(1);
  console.log(`app-listing-check: https://github.com/apps/${slug} is public and equals packages/app/app-manifest.json${urls ? `; its ${namedUrls(manifest).length} URLs answer` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
