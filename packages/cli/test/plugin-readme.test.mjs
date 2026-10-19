// PLG-05-AC01: Anthropic's plugin directory needs a README of at least 40 words outside code blocks in the plugin folder,
// and its review expects it to describe everything the plugin runs, sends or fetches. Each case reads its facts from the
// code the hook is built from (packages/cli/plugin/hooks/stop.mjs is the bundle of packages/cli/src/plugin/entry.mjs and
// what it imports), so the README fails here when it drifts from the code, not only when it is short: a new runner, a
// network call, another git command, a new store or a renamed plugin each needs its line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BLOCKS } from '../src/plugin/limits.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const text = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const README_PATH = 'packages/cli/plugin/README.md';
const readme = fs.existsSync(path.join(ROOT, README_PATH)) ? text(README_PATH) : '';
const prose = readme.replace(/```[\s\S]*?```/g, ' ');
const bundle = text('packages/cli/plugin/hooks/stop.mjs');
const hookSource = text('packages/cli/src/plugin/stop.mjs');
const plugin = JSON.parse(text('packages/cli/plugin/.claude-plugin/plugin.json'));
const market = JSON.parse(text('.claude-plugin/marketplace.json'));
const hooks = JSON.parse(text('packages/cli/plugin/hooks/hooks.json')).hooks;
const has = (s) => assert.ok(readme.includes(s), `the README does not say ${JSON.stringify(s)}`);
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

test('the plugin folder has a README of at least 40 words outside code blocks', () => {
  const words = prose.match(/[A-Za-z0-9][\w'.-]*/g) ?? [];
  assert.ok(words.length >= 40, `${words.length} words outside code blocks in ${README_PATH}`);
});

test('it names each hook event the plugin registers, with its timeout', () => {
  for (const [event, entries] of Object.entries(hooks)) {
    has(`\`${event}\``);
    for (const h of entries.flatMap((e) => e.hooks)) has(`${h.timeout} seconds`);
  }
});

test('it names every program the hook starts, every git command, and the run timeout', () => {
  const programs = new Set([...bundle.matchAll(/\b(?:execFileSync|execFile|spawnSync|spawn)\(\s*'([^']+)'/g)].map((m) => m[1]));
  assert.ok(programs.size > 0, 'the bundle starts no program');
  for (const p of programs) has(`\`${p}`);
  const local = text('packages/cli/src/local.mjs');
  const sub = new Set([...local.matchAll(/git\(\[(?:'-c', '[^']+', |'-C', \w+, )?'([a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(sub.size > 0, 'local.mjs runs no git command');
  for (const s of sub) has(`\`${s === 'config' ? 'config user.name' : s}\``);
  const ms = Number(/const RUN_TIMEOUT_MS = (\d+);/.exec(hookSource)?.[1]);
  has(`${ms / 1000} seconds`);
});

test("it names each runner's command, the truedone.yml override and the report file", () => {
  const commands = [...bundle.matchAll(/'([^'\n]+\{files\})'/g)].map((m) => m[1]);
  assert.ok(commands.length >= 5, `${commands.length} runner commands in the bundle`);
  for (const c of commands) has(`\`${c.split(/ --reporter| --json| --test-reporter| --junitxml/)[0].replace(/ run$/, '')}\``);
  assert.match(bundle, /path\.join\(root, '\.github', 'truedone\.yml'\)/);
  has('`.github/truedone.yml`');
  has('`test:`');
  assert.match(bundle, /\.truedone-report-/);
  has('`.truedone-report-');
});

test('it states the network use the code has', () => {
  const network = /\bfetch\(|from 'node:(?:https?|http2|net|tls|dgram)'|new WebSocket\(/.test(bundle);
  if (network) assert.doesNotMatch(prose, /no network/i);
  else assert.match(prose, /The hook makes no network request\./);
});

test('it says what the hook stores and where', () => {
  assert.match(bundle, /process\.env\.CLAUDE_PLUGIN_DATA \|\| path\.join\(os\.tmpdir\(\), 'truedone-plugin'\)/);
  assert.match(hookSource, /path\.join\(deps\.dataDir, 'sessions', /);
  has('`${CLAUDE_PLUGIN_DATA}/sessions/');
  has('`truedone-plugin`');
  has(`last ${/shown\.slice\(-(\d+)\)/.exec(hookSource)[1]} findings`);
});

test('it says when the hook blocks and when it only tells the user', () => {
  has(`After ${WORDS[MAX_BLOCKS] ?? MAX_BLOCKS} blocks in a row`);
  for (const s of ['Tampered', 'No red-green evidence', 'Test changes: review', 'exits 0']) has(s);
});

test('it gives the two install commands, from the marketplace the repository publishes', () => {
  const repo = new URL(plugin.repository).pathname.slice(1);
  has(`/plugin marketplace add ${repo}`);
  has(`/plugin install ${plugin.name}@${market.name}`);
});

test('it says how to turn the plugin off and remove it, its licence, and where to report a wrong verdict', () => {
  const id = `${plugin.name}@${market.name}`;
  has(`claude plugin disable ${id}`);
  has(`claude plugin uninstall ${id}`);
  has(plugin.license);
  assert.match(text('LICENSE'), /Apache License\s+Version 2\.0/);
  assert.ok(fs.existsSync(path.join(ROOT, '.github/ISSUE_TEMPLATE/wrong-verdict.yml')));
  has(`${plugin.repository}/issues/new?template=wrong-verdict.yml`);
});

test('it asks nothing of the reader (D40)', () => {
  assert.doesNotMatch(prose, /\b(please|you should|recommend|star (it|us|the)|spread|tell (others|your)|share (it|truedone))\b/i);
});
