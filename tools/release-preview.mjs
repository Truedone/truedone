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
// so a rate limit never reads as a verdict miss. Exit 0 when every check holds, and only then is the section written;
// 1 when one does not, with the notes left as they were; 2 for a usage error. Publishing stays Ryan's, from his terminal (REL-P5).
//   node tools/release-preview.mjs plugin [--local <path>]
// (REL-P3) adds the marketplace Truedone/truedone with the claude CLI in a scratch HOME (or, with --local, the
// marketplace in a clone at <path>, labelled so in the notes, while the plugin is not yet on GitHub's main), installs
// truedone@truedone from it, and checks the installed copy: its Stop hook is registered in hooks/hooks.json and its
// file is there, its manifest's version is packages/cli/package.json's and its homepage is the site. It then runs the
// installed hook the way Claude Code runs it (sh -c with CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA set) in a scratch
// git repository on the recorded transcript of the plugin's own case "row 3" (packages/cli/test/fixtures/
// transcripts/index.json), expecting the block its tests expect, and on its case "row 3, not met", expecting nothing.
// The lines go to "## The plugin".
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
export const PLUGIN_SECTION = '## The plugin';
// the plugin's own recorded cases the installed hook runs: the claim with no test run after the last edit, which it
// blocks, and the same claim after a test run, which it lets through with nothing to say, so a hook that blocks every
// turn fails as surely as one that blocks none
export const PLUGIN_CASES = [['row 3:', 'block'], ['row 3, not met: the claim follows a test run', 'nothing']];
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

// Only a passing run writes its section: a failed one leaves the notes as they were, so a failing check never dirties
// the tree it checks, and the committed lines are always a passing run's.
function unchanged() {
  console.log(`${NOTES} unchanged: only a passing run writes its section`);
  return 1;
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
  if (failed) return unchanged();
  const notes = path.join(ROOT, NOTES);
  const before = fs.existsSync(notes) ? fs.readFileSync(notes, 'utf8') : '# The 0.1.0 preview\n\nEach section is written by `node tools/release-preview.mjs <surface>` from what it measured (D35).\n';
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.writeFileSync(notes, writeSection(before, SECTION, `Written by \`node tools/release-preview.mjs cli\`.\n\n\`\`\`text\n${lines.join('\n')}\n\`\`\``));
  return 0;
}

// The installed copy of plugin@marketplace from a claude CLI's installed_plugins.json (version 2): { installPath,
// version, gitCommitSha }, or null.
export function installedPlugin(json, id = 'truedone@truedone') {
  const rows = json?.plugins?.[id];
  return Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
}
// The command of the plugin's Stop hook from its hooks.json, or null.
// The notes line for the installed copy. From a clone the copy is its working tree. From GitHub it is a commit of main,
// which every landing moves, so the line names the source and not the commit: a passing run writes the notes the last
// passing run wrote, and the commit is printed outside the notes.
export function installedLine(inst, { local, source, home }) {
  const root = inst.installPath;
  return `installed: version ${inst.version}, ${local ? 'from this clone' : `from ${source} on GitHub`}, at <scratch HOME>${root.startsWith(home) ? root.slice(home.length) : root}`;
}

export function stopCommand(hooks) {
  const cmd = hooks?.hooks?.Stop?.[0]?.hooks?.find((h) => h.type === 'command')?.command;
  return typeof cmd === 'string' ? cmd : null;
}

async function plugin(args) {
  const lines = [];
  const say = (s) => { console.log(s); lines.push(s); };
  const at = args.indexOf('--local');
  const local = at >= 0 ? path.resolve(args[at + 1] || ROOT) : null;
  const source = local ?? 'Truedone/truedone';
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/cli/package.json'), 'utf8')).version;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-plugin-'));
  const home = path.join(scratch, 'home'), data = path.join(scratch, 'data'), repo = path.join(scratch, 'repo');
  for (const d of [home, data, repo]) fs.mkdirSync(d);
  const env = { PATH: process.env.PATH, HOME: home, TERM: 'dumb' };
  let failed = false;
  const check = (ok, line) => { say(ok ? line : `${line}   FAIL`); if (!ok) failed = true; };
  try {
    const claude = (a) => {
      try { return execFileSync('claude', a, { env, encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) {
        throw new Error(`claude ${a.join(' ')} failed (exit ${e.status}): ${String(e.stderr || e.stdout || '').trim().split('\n').slice(-2).join(' | ')}`);
      }
    };
    say(`$ claude --version\n${claude(['--version'])}`);
    say(`$ claude plugin marketplace add ${local ? '<this clone>' : source}   (HOME in a scratch directory)`);
    if (local) say('  a local path: the marketplace in this clone, not yet Truedone/truedone on GitHub, until the plugin is on main');
    say(`  ${claude(['plugin', 'marketplace', 'add', source]).split('\n').pop()}`);
    say('$ claude plugin install truedone@truedone');
    say(`  ${claude(['plugin', 'install', 'truedone@truedone']).split('\n').pop()}`);
    const inst = installedPlugin(JSON.parse(fs.readFileSync(path.join(home, '.claude/plugins/installed_plugins.json'), 'utf8')));
    if (!inst) throw new Error('installed_plugins.json names no truedone@truedone');
    const root = inst.installPath;
    if (!local) console.log(`  installed from commit ${inst.gitCommitSha ?? 'none recorded'} (printed here, not written to the notes)`);
    say(installedLine(inst, { local, source, home }));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'));
    check(manifest.version === version, `manifest version ${manifest.version} (the release is ${version})`);
    check(manifest.homepage === 'https://truedone.pages.dev', `manifest homepage ${manifest.homepage}`);
    const cmd = stopCommand(JSON.parse(fs.readFileSync(path.join(root, 'hooks/hooks.json'), 'utf8')));
    check(cmd === 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"' && fs.existsSync(path.join(root, 'hooks/stop.mjs')), `Stop hook registered: ${cmd}`);
    const hookText = fs.readFileSync(path.join(root, 'hooks/stop.mjs'), 'utf8');
    const rg = /^const REDGREEN_ENABLED = (true|false);$/m.exec(hookText)?.[1];
    say(`red-green in the hook: ${rg === 'true' ? 'on' : 'off'} (const REDGREEN_ENABLED = ${rg};): ${rg === 'true' ? 'PLG-03 is in this build' : "this preview's hook has no red-green; it comes with PLG-03"}`);

    // the scratch repository: main holds a module and its test; the working branch changes both, and the test passes
    const git = (...a) => execFileSync('git', a, { cwd: repo, env: { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }, encoding: 'utf8' });
    const put = (p, t) => { fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); fs.writeFileSync(path.join(repo, p), t); };
    git('init', '-q', '-b', 'main');
    put('package.json', JSON.stringify({ name: 'demo', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n');
    put('src/add.mjs', 'export const add = (a, b) => a + b;\n');
    put('test/add.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.mjs';\ntest('add sums', () => {\n  assert.equal(add(1, 2), 3);\n});\n");
    git('add', '-A'); git('commit', '-qm', 'add');
    git('checkout', '-qb', 'work');
    put('src/add.mjs', 'export const add = (a, b) => Number(a) + Number(b);\n');
    put('test/add.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.mjs';\ntest('add sums', () => {\n  assert.equal(add(1, 2), 3);\n  assert.equal(add(2, 2), 4);\n});\n");
    const { cases } = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/cli/test/fixtures/transcripts/index.json'), 'utf8'));
    say(`$ ${cmd}   (sh -c, CLAUDE_PLUGIN_ROOT the installed copy, in a scratch repository on branch work: src/add.mjs and test/add.test.mjs changed, the test passing)`);
    for (const [prefix, want] of PLUGIN_CASES) {
      const c = cases.find((x) => x.name.startsWith(prefix));
      if (!c) throw new Error(`no recorded case "${prefix}" in the plugin's transcripts`);
      const transcript = path.join(scratch, `session-${want}.jsonl`);
      fs.writeFileSync(transcript, c.transcript.map((r) => JSON.stringify(r)).join('\n') + '\n');
      const stdin = JSON.stringify({ session_id: `release-preview-${want}`, transcript_path: transcript, cwd: repo, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: c.last_assistant_message });
      say(`  on the recorded transcript of the plugin's case "${c.name}", last message "${c.last_assistant_message}"`);
      const out = execFileSync('sh', ['-c', cmd], { cwd: repo, env: { ...env, CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: data }, input: stdin, encoding: 'utf8', timeout: 300000 }).trim();
      let answer = null;
      try { answer = out ? JSON.parse(out) : {}; } catch { /* checked below */ }
      say(`  -> ${out || '(nothing)'}`);
      if (want === 'block') check(answer?.decision === 'block' && new RegExp(c.expect.reason).test(answer?.reason ?? ''), `the hook blocks with "${c.expect.reason}", as the plugin's own test expects`);
      else check(answer !== null && answer.decision === undefined && answer.systemMessage === undefined, 'the hook lets the turn end and says nothing, as the plugin\'s own test expects');
    }
  } catch (e) {
    say(`FAIL: ${e.message}`);
    failed = true;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  say(failed ? 'result: FAIL' : 'result: pass');
  if (failed) return unchanged();
  const notes = path.join(ROOT, NOTES);
  const before = fs.existsSync(notes) ? fs.readFileSync(notes, 'utf8') : '# The 0.1.0 preview\n\nEach section is written by `node tools/release-preview.mjs <surface>` from what it measured (D35).\n';
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.writeFileSync(notes, writeSection(before, PLUGIN_SECTION, `Written by \`node tools/release-preview.mjs plugin${local ? ' --local <this clone>' : ''}\`.\n\n\`\`\`text\n${lines.join('\n')}\n\`\`\``));
  return 0;
}

// compared as real paths: run through a symlink (macOS's /tmp and /var are ones), the plain comparison failed, and the
// script did nothing and exited 0, a pass for any criterion that expects exit 0
const isMain = process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const what = process.argv[2];
  if (what === 'cli') process.exitCode = await cli();
  else if (what === 'plugin') process.exitCode = await plugin(process.argv.slice(3));
  else { console.error('usage: node tools/release-preview.mjs cli | plugin [--local <path>]'); process.exitCode = 2; }
}
