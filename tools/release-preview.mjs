// tools/release-preview.mjs (REL-P1, D35): the 0.1.0 preview, checked from what a user installs.
//   node tools/release-preview.mjs cli
// packs packages/cli with npm in a scratch directory under an empty npm config, and checks the tarball: exactly
// truedone.mjs, package.json, README.md and LICENSE; package.json's version; no file over 1 MB; no secret pattern. It
// installs the tarball into a scratch prefix with HOME in the scratch directory (a local tarball with no dependencies,
// --offline, so no registry is asked), runs the installed truedone --version, and runs it with --json on the five
// examples the site lists (EXAMPLES in packages/web/lib/view.mjs), each expecting the verdict the site lists for it.
// The commands and the measured lines go to the "## The command line" section of docs/releases/preview-0.1.0.md.
// The examples are live GitHub reads (GITHUB_TOKEN is passed through when the caller sets one); before them the script
// reads /rate_limit, which costs no quota, and stops with exit 4 and the reset time when too few requests are left,
// so a rate limit never reads as a verdict miss. Exit 0 when every check holds, 1 when one does not, 2 for a usage
// error. Publishing stays Ryan's, from his terminal (REL-P5).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FILES = ['package/LICENSE', 'package/README.md', 'package/package.json', 'package/truedone.mjs'];
export const MAX_BYTES = 1024 * 1024;
// Credential shapes no published file may carry: npm, GitHub and AWS tokens, Slack tokens, PEM private keys.
export const SECRETS = [
  ['an npm token', /npm_[A-Za-z0-9]{36}/],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ['a GitHub fine-grained token', /github_pat_[A-Za-z0-9_]{22,}/],
  ['an AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
export const NOTES = 'docs/releases/preview-0.1.0.md';
export const SECTION = '## The command line';
const CALLS_PER_EXAMPLE = 4;   // the pull request, its file page, the release tags, and one spare

// A gzipped tar as npm pack writes it (ustar), read into [{ name, size, data }] for its regular files. Pax and GNU
// long-name records are honoured, so a long path is never read under a truncated name.
export function readTarball(gz) {
  const buf = gunzipSync(gz);
  const out = [];
  let longName = null;
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(345, 500);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g') {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      if (m && type === 'x') longName = m[1];
      continue;
    }
    if (type === 'L') { longName = data.toString('utf8').replace(/\0.*$/s, ''); continue; }
    const name = longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    longName = null;
    if (type === '0' || type === '\0' || type === '7') out.push({ name, size, data: Buffer.from(data) });
    else out.push({ name, size, data: Buffer.alloc(0), type });
  }
  return out;
}

// The checks on a tarball's entries; [] when it may be published as version.
export function checkTarball(entries, { version }) {
  const problems = [];
  const names = entries.map((e) => e.name).sort();
  const extra = names.filter((n) => !FILES.includes(n));
  const missing = FILES.filter((n) => !names.includes(n));
  if (extra.length) problems.push(`files that are not published: ${extra.join(', ')}`);
  if (missing.length) problems.push(`files missing: ${missing.join(', ')}`);
  for (const e of entries) if (e.type) problems.push(`${e.name} is not a regular file (type ${e.type})`);
  const pkg = entries.find((e) => e.name === 'package/package.json');
  if (pkg) {
    let v = null;
    try { v = JSON.parse(pkg.data.toString('utf8')).version; } catch { problems.push('package/package.json is not JSON'); }
    if (v !== null && v !== version) problems.push(`package.json says version ${v}, not ${version}`);
  }
  for (const e of entries) {
    if (e.size > MAX_BYTES) problems.push(`${e.name} is ${e.size} bytes, over ${MAX_BYTES}`);
    const text = e.data.toString('latin1');
    for (const [what, re] of SECRETS) if (re.test(text)) problems.push(`${e.name} holds ${what}`);
  }
  return problems;
}

// Replace (or add) one "## " section of a notes file, keeping every other section as it is.
export function writeSection(text, heading, body) {
  const block = `${heading}\n\n${body.trim()}\n`;
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l === heading);
  if (at < 0) return `${text.replace(/\n*$/, '')}\n\n${block}`;
  let end = lines.findIndex((l, i) => i > at && /^## /.test(l));
  if (end < 0) end = lines.length;
  return [...lines.slice(0, at), ...block.split('\n'), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

// The examples the site lists, read from packages/web/lib/view.mjs: [[verdict, '/owner/repo/pull/n'], ...].
export async function siteExamples() {
  const { EXAMPLES } = await import(path.join(ROOT, 'packages/web/lib/view.mjs'));
  return EXAMPLES;
}

async function cli() {
  const lines = [];
  const say = (s) => { console.log(s); lines.push(s); };
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/cli/package.json'), 'utf8')).version;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-release-'));
  const home = path.join(scratch, 'home'), prefix = path.join(scratch, 'prefix');
  // two empty files: npm refuses one file loaded as both its user and its global config
  const userrc = path.join(scratch, 'user.npmrc'), globalrc = path.join(scratch, 'global.npmrc');
  fs.mkdirSync(home); fs.writeFileSync(userrc, ''); fs.writeFileSync(globalrc, '');
  const env = { PATH: process.env.PATH, HOME: home, NPM_CONFIG_USERCONFIG: userrc, NPM_CONFIG_GLOBALCONFIG: globalrc, NPM_CONFIG_CACHE: path.join(scratch, 'cache'), NPM_CONFIG_UPDATE_NOTIFIER: 'false', NPM_CONFIG_FUND: 'false', NPM_CONFIG_AUDIT: 'false' };
  if (process.env.GITHUB_TOKEN) env.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  let failed = false;
  try {
    const npm = (args) => {
      try { return execFileSync('npm', args, { cwd: scratch, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) {
        throw new Error(`npm ${args[0]} failed (exit ${e.status}): ${String(e.stderr || '').trim().split('\n').slice(0, 3).join(' | ')}`);
      }
    };
    const packed = JSON.parse(npm(['pack', path.join(ROOT, 'packages/cli'), '--pack-destination', scratch, '--json']))[0];
    const tgz = path.join(scratch, packed.filename);
    say(`$ npm pack packages/cli --json (empty npm config, HOME in a scratch directory)`);
    say(`tarball ${packed.filename}, ${fs.statSync(tgz).size} bytes, integrity ${packed.integrity}`);
    const entries = readTarball(fs.readFileSync(tgz));
    for (const e of entries) say(`  ${e.name} ${e.size} bytes`);
    const problems = checkTarball(entries, { version });
    say(problems.length ? `tarball check: FAIL: ${problems.join('; ')}` : `tarball check: pass (exactly the four files, version ${version}, none over ${MAX_BYTES} bytes, no secret pattern)`);
    if (problems.length) failed = true;

    npm(['install', '--global', '--offline', '--prefix', prefix, tgz]);
    const bin = path.join(prefix, 'bin', 'truedone');
    say(`$ npm install --global --offline --prefix <scratch> ${packed.filename}`);
    const shown = execFileSync(bin, ['--version'], { env, encoding: 'utf8' }).trim();
    const want = `truedone ${version} (preview)`;
    say(`$ truedone --version\n${shown}${shown === want ? '' : `   FAIL: expected ${want}`}`);
    if (shown !== want) failed = true;

    const examples = await siteExamples();
    const rl = await (await fetch('https://api.github.com/rate_limit', { headers: { 'user-agent': 'truedone-release-preview', ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) } })).json();
    const core = rl.resources?.core ?? rl.rate ?? {};
    console.log(`GitHub API: ${core.remaining} of ${core.limit} requests left${env.GITHUB_TOKEN ? ' (GITHUB_TOKEN)' : ' (no token)'}`);
    if (!(core.remaining >= examples.length * CALLS_PER_EXAMPLE)) {
      console.error(`rate limited: ${core.remaining} GitHub API requests left, ${examples.length * CALLS_PER_EXAMPLE} needed; resets at ${new Date((core.reset ?? 0) * 1000).toISOString()}. Not a verdict miss: run again after the reset, or with GITHUB_TOKEN.`);
      return 4;
    }
    for (const [expected, href] of examples) {
      const url = `https://github.com${href}`;
      let got;
      try {
        got = JSON.parse(execFileSync(bin, [url, '--json'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).verdict;
      } catch (e) {
        got = `error (exit ${e.status}): ${String(e.stderr || e.message).trim().split('\n')[0]}`;
      }
      say(`$ truedone ${url} --json   -> ${got}${got === expected ? '' : `   FAIL: the site lists ${expected}`}`);
      if (got !== expected) failed = true;
    }
  } catch (e) {
    say(`FAIL: ${e.message}`);
    failed = true;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  say(failed ? 'result: FAIL' : 'result: pass');
  const notes = path.join(ROOT, NOTES);
  const before = fs.existsSync(notes) ? fs.readFileSync(notes, 'utf8') : '# The 0.1.0 preview\n\nEach section is written by `node tools/release-preview.mjs <surface>` from what it measured (D35).\n';
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.writeFileSync(notes, writeSection(before, SECTION, `Written by \`node tools/release-preview.mjs cli\`.\n\n\`\`\`text\n${lines.join('\n')}\n\`\`\``));
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const what = process.argv[2];
  if (what === 'cli') process.exitCode = await cli();
  else { console.error('usage: node tools/release-preview.mjs cli'); process.exitCode = 2; }
}
