// node tools/plugin-checklist.mjs <plugin folder> (PLG-10): Anthropic's pre-submission checklist for the Claude plugin
// directory, https://claude.com/docs/plugins/pre-submission-checklist (read 2026-10-19), for the rows the plugin's files
// can show. Each finding is one line: the result the checklist gives it (Blocks, Validation stops, Held for a reviewer,
// Warning or Note), the rule's id, the file, what was found, and the row's own words. The tool exits 1 on any Blocks or
// Validation stops finding, and on any Held for a reviewer finding whose report title is not in CONFIRMATIONS, the holds
// a reviewer is asked to confirm, each with its reason; it exits 0 otherwise, and 2 on a bad argument.
//
// The portal's scanner decides some holds from what the code does, which no file check can show. CONFIRMATIONS names
// those this plugin expects and why, and every run prints them, so a reader sees each one beside the findings.
//
// The repository is the git work tree that holds the folder (git rev-parse --show-toplevel); outside one, the folder is
// taken as the root of its own repository. It decides three rows: the folders on the path to the plugin, the
// .gitattributes files that apply, and the ${CLAUDE_PLUGIN_ROOT} row, which blocks only in a plugin folder below the
// repository root. Files are read from the folder as it is on disk, without following symbolic links.
//
// Hook events and types are those of https://code.claude.com/docs/en/hooks, and component keys those of
// https://code.claude.com/docs/en/plugins/manifest-reference, both read 2026-10-19. No dependencies and no network.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BLOCKS = 'Blocks';
export const STOPS = 'Validation stops';
export const HELD = 'Held for a reviewer';
export const WARNING = 'Warning';
export const NOTE = 'Note';

// The rows, in the page's order, in its own words ("What to do"), with the title the report gives a finding, if any.
export const RULES = {
  manifest: { row: 'Submit a folder that contains .claude-plugin/plugin.json' },
  inside: { row: 'Keep every file that a hook, an MCP server command, or a script uses inside the plugin folder, and point every component path in plugin.json inside it' },
  'regular-files': { row: 'Commit regular files and folders for everything the plugin loads, not symbolic links, Git submodules, or Git LFS pointer files' },
  'system-files': { row: 'Remove .DS_Store, Thumbs.db, desktop.ini, and __MACOSX entries from the plugin folder', title: 'This is a macOS or Windows system file' },
  names: { row: 'Use file and folder names that are valid on both Windows and macOS: no colon, no trailing dot or space, no Windows device name such as con.md or prn, and no two names that differ only by capitalization', title: 'Couldn’t validate that repository' },
  'plugin-path': { row: 'Name each folder on the path to the plugin with letters, digits, dots, hyphens, and underscores only, and enter the plugin path with the same capitalization as the repository', title: 'Couldn’t validate that repository' },
  gitattributes: { row: 'Keep export-ignore and export-subst out of every .gitattributes file. Keep filter, Git LFS included, and other attributes that rewrite file contents out of .gitattributes files at the repository root, above the plugin folder, and inside it.', title: 'Couldn’t validate that repository' },
  'file-size': { row: 'Keep the repository under 50 MiB as GitHub archives it and under 256 MiB unpacked, with fewer than 10,000 files and folders, and keep every file in the plugin folder under 5 MiB', title: 'Repository too large to validate' },
  'name-pattern': { row: 'Use a name made of lowercase letters, digits, and hyphens, up to 64 characters, that starts and ends with a letter or digit' },
  'name-reserved': { row: 'Build the name around your own distinctive product or project name: not a reserved word such as claude, anthropic, official, plugin, mcp, or test as the whole name, not a marketplace name reserved for Anthropic, and nothing that presents the plugin as official' },
  'display-names': { row: 'Write displayName and author.name in one writing system, without look-alike letters or invisible characters' },
  'component-keys': { row: 'Spell the keys that declare components, such as hooks and mcpServers, exactly as the plugins reference does, and keep them out of the experimental object' },
  metadata: { row: 'Set description, author, and version' },
  readme: { row: 'Put a README of at least 40 words in the plugin folder, preferably named README.md. Words inside code blocks don\'t count.' },
  licence: { row: 'Add a LICENSE file to the plugin folder, or set license in plugin.json', title: 'License missing' },
  'text-size': { row: 'Keep every file that isn\'t an image or font under 256 KiB', title: 'Files or downloads the validator couldn’t inspect' },
  'file-count': { row: 'Keep the plugin to 512 files or fewer', title: 'Files or downloads the validator couldn’t inspect' },
  'file-types': { row: 'Include only text files, SVG included, complete PNG, JPEG, GIF, and WebP images, and font files. Any other binary file, such as an .ico, .pdf, or .zip file or a compiled executable, is held.', title: 'Files or downloads the validator couldn’t inspect' },
  'image-refs': { row: 'To show a bundled image in the README, use Markdown image syntax. Don\'t refer to bundled images or fonts from commands, hooks, or scripts, or write their paths in backticks or a code block.' },
  'launcher-pin': { row: 'Pin every package that a launcher runs to an exact version, such as npx <package>@1.2.3 or uvx <package>==1.2.3, not a range or @latest. Run uv run with --locked or --frozen.' },
  'package-source': { row: 'In a plugin that uses a launcher or runs a package install, don\'t include a package-manager configuration file that sets a registry, index, proxy, or other package source, such as .npmrc, bunfig.toml, or uv.toml' },
  credentials: { row: 'Keep real credentials out of every file, documentation and examples included. Ask for each value through a userConfig entry in plugin.json with sensitive: true, and refer to it as ${user_config.KEY}.' },
  'hook-paths': { row: 'In the command of a hook or an MCP server, write each path in full from ${CLAUDE_PLUGIN_ROOT}, with no other variable, command substitution, wildcard, or inline program such as python3 -c' },
  'hooks-json': { row: 'Make hooks/hooks.json valid JSON with a top-level hooks object, a modules array for a mod, or both. In hooks, use only the hook events and hook types in the hooks reference, and an https:// URL on each HTTP hook' },
  'hooks-listed': { row: 'Leave hooks/hooks.json out of the hooks field in plugin.json, because Claude Code loads that file automatically' },
  'front-matter': { row: 'Write valid YAML front matter in each skill, command, and agent file, with description as a single text value, not a list' },
};

// Holds a reviewer is asked to confirm. A Held for a reviewer finding with one of these titles does not fail the run.
export const CONFIRMATIONS = [
  {
    title: 'Uses a credential from the user’s machine',
    row: 'Don\'t read a credential that is already set in the user\'s environment, such as $GITHUB_TOKEN, and send it to a server, even in a README example. Ask for it through userConfig instead.',
    reason: 'the test runner (packages/core/run) runs the project\'s own changed tests with the session\'s environment, because those tests may need it, and the hook sends nothing anywhere',
  },
];

export const MANIFEST = '.claude-plugin/plugin.json';
export const HOOKS_FILE = 'hooks/hooks.json';
const MIB = 1024 * 1024;
export const MAX_FILE = 5 * MIB;
export const MAX_TEXT = 256 * 1024;
export const MAX_FILES = 512;
export const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
export const RESERVED = ['claude', 'anthropic', 'official', 'plugin', 'mcp', 'test'];
export const SYSTEM_FILES = ['.ds_store', 'thumbs.db', 'desktop.ini', '__macosx'];
export const HOOK_EVENTS = [
  'SessionStart', 'Setup', 'UserPromptSubmit', 'UserPromptExpansion', 'PreToolUse', 'PermissionRequest', 'PermissionDenied',
  'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'Notification', 'MessageDisplay', 'SubagentStart', 'SubagentStop',
  'TaskCreated', 'TaskCompleted', 'Stop', 'StopFailure', 'TeammateIdle', 'InstructionsLoaded', 'ConfigChange', 'CwdChanged',
  'DirectoryAdded', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove', 'PreCompact', 'PostCompact', 'PreModelSwitch',
  'PostModelSwitch', 'Elicitation', 'ElicitationResult', 'SessionEnd',
];
export const HOOK_TYPES = ['command', 'http', 'mcp_tool', 'prompt', 'agent'];
// the manifest's top-level fields, and the keys among them that declare components
export const FIELDS = [
  '$schema', 'name', 'displayName', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords',
  'metadata', 'icon', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl', 'defaultEnabled',
  'dependencies', 'settings', 'userConfig', 'types', 'channels', 'skills', 'commands', 'agents', 'hooks', 'mcpServers',
  'lspServers', 'outputStyles', 'workflows', 'experimental',
];
export const COMPONENT_KEYS = ['skills', 'commands', 'agents', 'hooks', 'mcpServers', 'lspServers', 'outputStyles', 'workflows'];
export const EXPERIMENTAL_KEYS = ['themes', 'monitors', 'evals'];
// where Claude Code loads components from when the manifest does not point elsewhere
const DEFAULT_LOADED = [MANIFEST, HOOKS_FILE, 'skills', 'commands', 'agents', 'output-styles', 'workflows', 'themes',
  'monitors/monitors.json', '.mcp.json', '.lsp.json', 'settings.json', 'bin', 'SKILL.md'];
// credential shapes, as tools/release-preview.mjs writes them, for the prefixes the entry names
export const CREDENTIALS = [
  ['a GitHub token', /\bghp_[A-Za-z0-9]{36,}/],
  ['a GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{22,}/],
  ['an Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['an AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['a Slack bot token', /\bxoxb-[A-Za-z0-9-]{10,}/],
  ['a Slack user token', /\bxoxp-[A-Za-z0-9-]{10,}/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
// package-manager files, and the settings in each that name a package source
export const SOURCE_FILES = {
  '.npmrc': /^\s*(?:@[^:=\s]+:)?registry\s*=|^\s*(?:https-)?proxy\s*=|^\s*replace-registry-host\s*=/mi,
  'bunfig.toml': /^\s*registry\s*=|^\s*\[install\.(?:scopes|registry)\]/m,
  'uv.toml': /^\s*(?:index-url|extra-index-url|find-links|python-install-mirror|pypy-install-mirror)\s*=|^\s*\[\[index\]\]/m,
};
const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'bun.lockb'];
const INSTALL_RE = /\b(?:npm\s+(?:install|i|ci|add)|pnpm\s+(?:install|i|add)|yarn\s+(?:install|add)|bun\s+(?:install|i|add)|pip3?\s+install|python3?\s+-m\s+pip\s+install|uv\s+(?:pip\s+install|sync|add)|poetry\s+install)\b/;
const SCRIPT_EXT = /\.(?:sh|bash|zsh|js|mjs|cjs|ts|mts|cts|py|rb|pl|php|ps1|bat|cmd)$/i;
const PATH_EXT = /\.(?:sh|bash|zsh|js|mjs|cjs|ts|mts|cts|py|rb|pl|php|ps1|bat|cmd|exe|jar|json|ya?ml|toml)$/i;
const TEXT_DOC = /\.(?:md|mdx|markdown|txt|rst)$/i;
const ROOT_VAR = /^\$(?:\{CLAUDE_PLUGIN_ROOT\}|CLAUDE_PLUGIN_ROOT(?![A-Za-z0-9_]))/;
// an interpreter, and the option that hands it a program on the command line
const INLINE = [
  [/^(?:sh|bash|zsh|dash|ksh|fish)$/, /^-[A-Za-z]*c[A-Za-z]*$/],
  [/^(?:python[0-9.]*|py)$/, /^-[A-Za-z]*c$/],
  [/^(?:node|nodejs|bun)$/, /^(?:-e|-p|--eval|--print)(?:=.*)?$/],
  [/^deno$/, /^eval$/],
  [/^perl$/, /^-[A-Za-z]*[eE]$/],
  [/^ruby$/, /^-[A-Za-z]*e$/],
  [/^php$/, /^-r$/],
  [/^(?:pwsh|powershell)$/, /^-(?:c|command|e|ec|encodedcommand)$/i],
  [/^cmd$/, /^\/c$/i],
  [/^osascript$/, /^-e$/],
];

const posix = (p) => p.split(path.sep).join('/');
const asText = (buf) => buf.toString('utf8');
const squash = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');
const relOf = (p) => posix(path.normalize(String(p).replace(/^\.\//, ''))).replace(/\/$/, '').replace(/^\.$/, '');
const norm = (t) => String(t ?? '').replace(/[’‘]/g, '\'');

// --- reading the folder -------------------------------------------------------------------------------------------

// Every entry under the folder, without following symbolic links: { rel, abs, kind, size }. A folder holding a .git
// entry is a submodule (or another repository) and is not entered. The folder's own .git is skipped.
export function walk(root) {
  const out = [];
  const visit = (dir, rel) => {
    const names = fs.readdirSync(dir).sort();
    for (const name of names) {
      if (!rel && name === '.git') continue;
      const abs = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) out.push({ rel: r, abs, kind: 'symlink', size: 0 });
      else if (st.isDirectory()) {
        let sub = false;
        try { fs.lstatSync(path.join(abs, '.git')); sub = true; } catch { /* no .git: a plain folder */ }
        out.push({ rel: r, abs, kind: sub ? 'submodule' : 'dir', size: 0 });
        if (!sub) visit(abs, r);
      } else out.push({ rel: r, abs, kind: st.isFile() ? 'file' : 'other', size: st.size });
    }
  };
  visit(root, '');
  return out;
}

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * MIB });
  } catch {
    return null;
  }
}

// The repository the folder is in: its root, and the folder's path from that root ('' at the root, or outside git).
export function repositoryOf(root) {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (top === null || !top.trim()) return { git: false, top: root, rel: '' };
  const real = fs.realpathSync.native(top.trim());
  const rel = posix(path.relative(real, root));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { git: false, top: root, rel: '' };
  return { git: true, top: real, rel };
}

// --- file contents ------------------------------------------------------------------------------------------------

const starts = (buf, bytes, at = 0) => bytes.every((b, i) => buf[at + i] === b);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const utf8 = new TextDecoder('utf-8', { fatal: true });

// 'image', 'font', 'text', 'incomplete' (an image cut short) or 'binary'
export function classify(buf, rel = '') {
  if (starts(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return buf.length >= 20 && starts(buf, ascii('IEND'), buf.length - 8) ? 'image' : 'incomplete';
  }
  if (starts(buf, [0xff, 0xd8, 0xff])) {
    let end = buf.length;
    while (end > 0 && buf[end - 1] === 0) end -= 1;
    return end >= 4 && buf[end - 2] === 0xff && buf[end - 1] === 0xd9 ? 'image' : 'incomplete';
  }
  if (starts(buf, ascii('GIF87a')) || starts(buf, ascii('GIF89a'))) return buf[buf.length - 1] === 0x3b ? 'image' : 'incomplete';
  if (starts(buf, ascii('RIFF')) && starts(buf, ascii('WEBP'), 8)) {
    return buf.length >= 12 && buf.readUInt32LE(4) + 8 <= buf.length ? 'image' : 'incomplete';
  }
  if (['wOFF', 'wOF2', 'OTTO', 'ttcf', 'true', 'typ1'].some((m) => starts(buf, ascii(m))) || starts(buf, [0, 1, 0, 0])) return 'font';
  if (!buf.includes(0)) {
    try {
      utf8.decode(buf);
      return /\.svg$/i.test(rel) ? 'image' : 'text';
    } catch { /* not UTF-8 */ }
  }
  return 'binary';
}

export const isLfsPointer = (buf) => buf.length < 1024 && buf.subarray(0, 40).toString('latin1') === 'version https://git-lfs.github.com/spec/';

// Markdown split into prose and the contents of its fenced code blocks
export function fences(text) {
  const prose = [];
  const code = [];
  let fence = null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!fence && m) { fence = m[1]; continue; }
    if (fence && new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}\\s*$`).test(line)) { fence = null; continue; }
    (fence ? code : prose).push(line);
  }
  return { prose: prose.join('\n'), code: code.join('\n') };
}

export const words = (text) => (String(text).match(/\S+/g) ?? []).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

// --- YAML front matter ------------------------------------------------------------------------------------------

const YAML_NULL = /^(?:~|null|Null|NULL)?$/;
const YAML_BOOL = /^(?:true|True|TRUE|false|False|FALSE)$/;
const YAML_NUM = /^(?:[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|0o[0-7]+|0x[0-9a-fA-F]+|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;

// closes a quoted scalar that starts at text[0]; returns the rest after the closing quote, or null when it never closes
function afterQuote(text) {
  const q = text[0];
  for (let i = 1; i < text.length; i++) {
    if (q === '"' && text[i] === '\\') { i++; continue; }
    if (text[i] === q) {
      if (q === '\'' && text[i + 1] === '\'') { i++; continue; }
      return text.slice(i + 1);
    }
  }
  return null;
}

// a flow collection closes on the same bracket depth it opened at, outside quotes
function flowCloses(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === '\'') {
      const rest = afterQuote(text.slice(i));
      if (rest === null) return false;
      i = text.length - rest.length - 1;
    } else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return /^\s*(?:#.*)?$/.test(text.slice(i + 1));
    }
  }
  return false;
}

// the kind of one value: 'string', 'list', 'map', 'number', 'boolean' or 'null'; an Error when it does not parse
function valueKind(v, cont, at) {
  const nonBlank = cont.filter((l) => l.trim() && !/^\s*#/.test(l));
  if (cont.some((l) => /^\t/.test(l))) return new Error(`${at}: a tab indents a line under it`);
  if (v === '' || v.startsWith('#')) {
    if (!nonBlank.length) return 'null';
    if (/^\s*-(?:\s|$)/.test(nonBlank[0])) return 'list';
    if (/^\s*[^\s#'"][^:]*:(?:\s|$)/.test(nonBlank[0])) return 'map';
    return valueKind(nonBlank.map((l) => l.trim()).join(' '), [], at);
  }
  if (/^[|>]/.test(v)) return /^[|>][-+1-9]{0,2}\s*(?:#.*)?$/.test(v) ? 'string' : new Error(`${at}: a block scalar header ${JSON.stringify(v)} does not parse`);
  if (v[0] === '"' || v[0] === '\'') {
    const rest = afterQuote([v, ...cont].join('\n'));
    if (rest === null) return new Error(`${at}: a quoted value never closes`);
    if (!/^\s*(?:#.*)?$/.test(rest)) return new Error(`${at}: text follows a quoted value`);
    return 'string';
  }
  if (v[0] === '[' || v[0] === '{') {
    if (!flowCloses([v, ...cont].join('\n'))) return new Error(`${at}: a ${v[0] === '[' ? 'list' : 'mapping'} in brackets never closes`);
    return v[0] === '[' ? 'list' : 'map';
  }
  if (v[0] === '&' || v[0] === '!') {
    const rest = v.replace(/^[&!]\S*\s*/, '');
    return valueKind(rest, cont, at);
  }
  if (v[0] === '*') return new Error(`${at}: an alias with no anchor in the front matter`);
  if (v[0] === '@' || v[0] === '`') return new Error(`${at}: a plain value cannot start with ${v[0]}`);
  if (/^-(?:\s|$)/.test(v)) return new Error(`${at}: a list item on the key's own line`);
  if (/^\?(?:\s|$)/.test(v)) return new Error(`${at}: a complex key`);
  const pieces = [v, ...nonBlank.map((l) => l.trim())].map((p) => p.replace(/(?:^|\s+)#.*$/, '').trim());
  if (pieces.some((p) => /:(?:\s|$)/.test(p))) return new Error(`${at}: a plain value holds a colon followed by a space; quote the value`);
  const joined = pieces.filter(Boolean).join(' ');
  if (YAML_NULL.test(joined)) return 'null';
  if (YAML_BOOL.test(joined)) return 'boolean';
  if (YAML_NUM.test(joined)) return 'number';
  return 'string';
}

// The front matter of a Markdown file: { found: false }, { found: true, error }, or { found: true, keys: Map(key -> kind) }.
// It reads the subset of YAML front matter is written in, a mapping of keys to scalars, lists and mappings, and treats
// what that subset cannot read as not parsing.
export function frontMatter(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  if (!/^---\s*$/.test(lines[0])) return { found: false };
  const end = lines.findIndex((l, i) => i > 0 && /^(?:---|\.\.\.)\s*$/.test(l));
  if (end < 0) return { found: true, error: 'the front matter has no closing ---' };
  const body = lines.slice(1, end);
  const keys = new Map();
  for (let i = 0; i < body.length;) {
    const line = body[i];
    const at = `line ${i + 2}`;
    if (/^\s*(?:#.*)?$/.test(line)) { i++; continue; }
    if (/^\s/.test(line)) return { found: true, error: `${at}: an indented line with no key above it` };
    const m = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[A-Za-z0-9_$][^:#]*?)\s*:(?:[ \t]+(.*?))?\s*$/.exec(line);
    if (!m) return { found: true, error: `${at}: not a "key: value" line` };
    const key = /^["']/.test(m[1]) ? m[1].slice(1, -1) : m[1];
    if (keys.has(key)) return { found: true, error: `${at}: the key ${key} appears twice` };
    const v = (m[2] ?? '').trim();
    i++;
    const cont = [];
    const listUnder = v === '' || v.startsWith('#');
    while (i < body.length && (/^\s/.test(body[i]) || body[i] === '' || (listUnder && /^-(?:\s|$)/.test(body[i])))) cont.push(body[i++]);
    const kind = valueKind(v, cont, at);
    if (kind instanceof Error) return { found: true, error: kind.message };
    keys.set(key, kind);
  }
  return { found: true, keys };
}

// --- commands -----------------------------------------------------------------------------------------------------

// A shell command as sh would split it into words, quotes removed; operators are words of their own.
export function shellWords(s) {
  const out = [];
  let cur = null;
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === '\'') { if (c === '\'') q = null; else cur += c; continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === '\\' && '"\\$`'.includes(s[i + 1] ?? '')) cur += s[++i];
      else cur += c;
      continue;
    }
    if (c === '\'' || c === '"') { q = c; cur ??= ''; continue; }
    if (c === '\\' && i + 1 < s.length) { cur = (cur ?? '') + s[++i]; continue; }
    if (/\s/.test(c)) { if (cur !== null) out.push(cur); cur = null; continue; }
    if (';&|<>()'.includes(c)) {
      if (cur !== null) out.push(cur);
      cur = null;
      let op = c;
      while (op.length < 2 && ';&|<>'.includes(s[i + 1] ?? '\0')) op += s[++i];
      out.push(op);
      continue;
    }
    cur = (cur ?? '') + c;
  }
  if (cur !== null) out.push(cur);
  return out;
}

const isOp = (w) => /^[;&|<>()]+$/.test(w);
// the words of a hook or MCP command: exec form (args) is taken as written, shell form as sh splits it
const wordsOf = (c) => (c.args ? [c.command, ...c.args] : shellWords(c.command));
const rawOf = (c) => (c.args ? [c.command, ...c.args] : [c.command]);

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const local = (spec) => /^(?:\.|\/|\$|~)/.test(spec);
export function npmPinned(spec) {
  if (local(spec)) return true;
  const at = spec.lastIndexOf('@');
  return at > 0 && EXACT_SEMVER.test(spec.slice(at + 1));
}
export function pyPinned(spec) {
  if (local(spec)) return true;
  return /^[A-Za-z0-9._-]+(?:\[[^\]]*\])?\s*(?:==|@)\s*[0-9][0-9A-Za-z.+!-]*$/.test(spec);
}

// The launchers in one command's words: [{ launcher, problem }] for each one that runs a package not pinned exactly.
export function launchers(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = path.basename(words[i]);
    let kind = null;
    let j = i + 1;
    if (w === 'npx' || w === 'bunx' || w === 'uvx') kind = w;
    else if ((w === 'pnpm' || w === 'yarn') && words[i + 1] === 'dlx') { kind = `${w} dlx`; j = i + 2; }
    else if (w === 'pipx' && words[i + 1] === 'run') { kind = 'pipx run'; j = i + 2; }
    else if (w === 'uv' && words[i + 1] === 'run') { kind = 'uv run'; j = i + 2; }
    if (!kind) continue;
    const rest = [];
    for (let k = j; k < words.length && !isOp(words[k]); k++) rest.push(words[k]);
    out.push({ launcher: kind, specs: launcherSpecs(kind, rest) });
  }
  return out.map(({ launcher, specs }) => {
    if (launcher === 'uv run') return { launcher, problem: specs.locked ? null : 'uv run without --locked or --frozen' };
    const pinned = ['uvx', 'pipx run'].includes(launcher) ? pyPinned : npmPinned;
    const loose = specs.list.filter((s) => !pinned(s));
    if (!specs.list.length) return { launcher, problem: `${launcher} names no package` };
    return { launcher, problem: loose.length ? `${launcher} runs ${loose.join(', ')}, not pinned to an exact version` : null };
  });
}

// the package specs a launcher's arguments name, and for uv run whether it is locked
function launcherSpecs(kind, rest) {
  const named = { npx: ['-p', '--package'], bunx: ['-p', '--package'], 'pnpm dlx': ['--package'], 'yarn dlx': ['-p', '--package'], uvx: ['--from', '--with'], 'pipx run': ['--spec'] }[kind] ?? [];
  const valued = { npx: ['-c', '--call', '--cache', '--userconfig', '--registry'], uvx: ['--python', '-p', '--index-url', '--extra-index-url', '--with-requirements', '--index'], 'pipx run': ['--python', '--index-url', '--pip-args'], 'uv run': ['--python', '-p', '--with', '--project', '--directory'] }[kind] ?? [];
  const list = [];
  let positional = null;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === '--') { positional = rest[i + 1] ?? null; break; }
    const eq = t.indexOf('=');
    const opt = t.startsWith('-') && eq > 0 ? t.slice(0, eq) : t;
    if (named.includes(opt)) { list.push(eq > 0 && t.startsWith('-') ? t.slice(eq + 1) : rest[++i]); continue; }
    if (valued.includes(opt)) { if (!(eq > 0)) i++; continue; }
    if (t.startsWith('-')) continue;
    positional = t;
    break;
  }
  const fromNamed = kind === 'uvx' ? rest.some((t) => t === '--from' || t.startsWith('--from=')) : list.length > 0;
  if (positional && !fromNamed) list.push(positional);
  return { list: list.filter((s) => s !== undefined), locked: rest.includes('--locked') || rest.includes('--frozen') };
}

// What breaks the ${CLAUDE_PLUGIN_ROOT} row in one command: other variables, substitutions, wildcards, inline programs
// and paths that do not start at the plugin root.
export function commandProblems(c) {
  const out = [];
  for (const raw of rawOf(c)) {
    for (const m of String(raw).matchAll(/\$(\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/g)) {
      if (!/^(?:\{CLAUDE_PLUGIN_ROOT\}|CLAUDE_PLUGIN_ROOT)$/.test(m[1])) out.push(`the variable $${m[1]}`);
    }
    if (/\$\(|`/.test(raw)) out.push('a command substitution');
    if (/[*?]|\[[^\]]*\]/.test(raw)) out.push('a wildcard');
  }
  const ws = wordsOf(c);
  ws.forEach((w, i) => {
    const base = path.basename(w).replace(/\.exe$/i, '').toLowerCase();
    const hit = INLINE.find(([exe, flag]) => exe.test(base) && flag.test(ws[i + 1] ?? ''));
    if (hit) out.push(`an inline program (${base} ${ws[i + 1]})`);
    const value = w.startsWith('-') && w.includes('=') ? w.slice(w.indexOf('=') + 1) : w;
    if (!value || value.startsWith('-') || isOp(value) || ROOT_VAR.test(value)) return;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) || /^@[^/\s]+\/[^/\s]+$/.test(value)) return;
    if (value.includes('/') || value.includes('\\') || PATH_EXT.test(value)) out.push(`the path ${value}, not written from \${CLAUDE_PLUGIN_ROOT}`);
  });
  return [...new Set(out)];
}

// the paths a command names from ${CLAUDE_PLUGIN_ROOT}, relative to the plugin root (may start with ..)
const rootPaths = (c) => wordsOf(c).filter((w) => ROOT_VAR.test(w)).map((w) => posix(path.normalize(`.${w.replace(ROOT_VAR, '')}`))).filter((p) => p !== '.');

// --- names --------------------------------------------------------------------------------------------------------

const DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
// What makes each path's last name invalid on Windows or macOS, and each group of paths that differ only by case.
export function nameProblems(rels) {
  const out = [];
  for (const rel of rels) {
    const name = rel.split('/').pop();
    // eslint-disable-next-line no-control-regex
    if (/[<>:"|?*\\\x00-\x1f]/.test(name)) out.push({ rel, problem: `the name ${JSON.stringify(name)} holds a character Windows or macOS does not allow` });
    if (/[. ]$/.test(name)) out.push({ rel, problem: `the name ${JSON.stringify(name)} ends with a ${name.endsWith('.') ? 'dot' : 'space'}` });
    if (DEVICE.test(name)) out.push({ rel, problem: `the name ${JSON.stringify(name)} is a Windows device name` });
  }
  const byCase = new Map();
  for (const rel of rels) byCase.set(rel.toLowerCase(), [...(byCase.get(rel.toLowerCase()) ?? []), rel]);
  for (const group of byCase.values()) if (group.length > 1) out.push({ rel: group[0], problem: `${group.join(' and ')} differ only by capitalization` });
  return out;
}

// --- .gitattributes -----------------------------------------------------------------------------------------------

// The attributes a .gitattributes file sets that the checklist names: [{ line, attr }]
export function attributeProblems(text, { filter = true } = {}) {
  const out = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const rest = t.startsWith('"') ? (afterQuote(t) ?? '') : t.replace(/^\S+/, '');
    for (const a of rest.trim().split(/\s+/).filter(Boolean)) {
      if (a.startsWith('-') || a.startsWith('!')) continue;
      const key = a.split('=')[0];
      if (key === 'export-ignore' || key === 'export-subst' || (filter && key === 'filter')) out.push({ line: i + 1, attr: a });
    }
  });
  return out;
}

// --- the check ----------------------------------------------------------------------------------------------------

const readJson = (abs) => JSON.parse(fs.readFileSync(abs, 'utf8'));
const pathList = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

// The plugin folder against the checklist: { root, repository, findings: [{ id, result, file, detail, title }] }.
export function check(folder) {
  const root = fs.realpathSync.native(folder);
  const repository = repositoryOf(root);
  const subfolder = repository.rel !== '';
  const entries = walk(root);
  const byRel = new Map(entries.map((e) => [e.rel, e]));
  const isFile = (rel) => byRel.get(rel)?.kind === 'file';
  const findings = [];
  const add = (id, result, file, detail, title = RULES[id].title) => findings.push({ id, result, file, detail, title });
  const contents = new Map();
  const read = (rel) => {
    if (!contents.has(rel)) contents.set(rel, isFile(rel) ? fs.readFileSync(path.join(root, rel)) : null);
    return contents.get(rel);
  };
  const inside = (p) => {
    const rel = posix(path.relative(root, path.resolve(root, p)));
    return !(rel === '..' || rel.startsWith('../') || path.isAbsolute(rel));
  };

  // the manifest
  let manifest = null;
  if (!isFile(MANIFEST)) {
    const skillsOnly = !entries.some((e) => e.rel.split('/').pop() === 'plugin.json') && entries.some((e) => e.kind === 'file' && /^skills\/[^/]+\/SKILL\.md$/.test(e.rel));
    if (skillsOnly) add('manifest', NOTE, MANIFEST, 'no plugin.json, and skills/<name>/SKILL.md folders: it passes and is listed for Claude Code only');
    else add('manifest', BLOCKS, MANIFEST, 'the folder holds no .claude-plugin/plugin.json');
  } else {
    try {
      manifest = readJson(path.join(root, MANIFEST));
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        add('manifest', BLOCKS, MANIFEST, 'plugin.json is not a JSON object');
        manifest = null;
      }
    } catch (err) {
      add('manifest', BLOCKS, MANIFEST, `plugin.json is not valid JSON: ${err.message}`);
    }
  }

  // hook commands, from hooks/hooks.json and the manifest's hooks, and MCP server commands
  const commands = [];
  const hookConfig = (config, file) => {
    for (const [event, groups] of Object.entries(config)) {
      if (!HOOK_EVENTS.includes(event)) { add('hooks-json', BLOCKS, file, `the hook event ${event} is not in the hooks reference`); continue; }
      if (!Array.isArray(groups)) { add('hooks-json', BLOCKS, file, `hooks.${event} is not a list`); continue; }
      for (const g of groups) {
        if (!g || typeof g !== 'object' || !Array.isArray(g.hooks)) { add('hooks-json', BLOCKS, file, `a ${event} entry has no hooks list`); continue; }
        for (const h of g.hooks) {
          if (!h || typeof h !== 'object' || !HOOK_TYPES.includes(h.type)) { add('hooks-json', BLOCKS, file, `a ${event} hook has the type ${JSON.stringify(h?.type)}, not one in the hooks reference`); continue; }
          if (h.type === 'http' && !/^https:\/\//.test(String(h.url ?? ''))) add('hooks-json', BLOCKS, file, `a ${event} HTTP hook's url ${JSON.stringify(h.url)} is not an https:// URL`);
          if (h.type === 'command' && typeof h.command === 'string') {
            commands.push({ file, where: `${event} hook`, command: h.command, args: Array.isArray(h.args) ? h.args.map(String) : null });
          }
        }
      }
    }
  };
  const hooksFile = (rel) => {
    let parsed;
    try { parsed = readJson(path.join(root, rel)); } catch (err) { add('hooks-json', BLOCKS, rel, `not valid JSON: ${err.message}`, 'hooks.json is invalid'); return; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { add('hooks-json', BLOCKS, rel, 'not a JSON object'); return; }
    const hasHooks = parsed.hooks !== undefined;
    const hasModules = parsed.modules !== undefined;
    if (!hasHooks && !hasModules) { add('hooks-json', BLOCKS, rel, 'no top-level hooks object or modules array'); return; }
    if (hasModules && !Array.isArray(parsed.modules)) add('hooks-json', BLOCKS, rel, 'modules is not an array');
    if (hasHooks) {
      if (!parsed.hooks || typeof parsed.hooks !== 'object' || Array.isArray(parsed.hooks)) add('hooks-json', BLOCKS, rel, 'hooks is not an object');
      else hookConfig(parsed.hooks, rel);
    }
  };
  if (isFile(HOOKS_FILE)) hooksFile(HOOKS_FILE);
  const manifestHooks = manifest?.hooks === undefined ? [] : Array.isArray(manifest.hooks) ? manifest.hooks : [manifest.hooks];
  for (const h of manifestHooks) {
    if (typeof h === 'string') {
      if (relOf(h) === HOOKS_FILE) add('hooks-listed', WARNING, MANIFEST, `hooks names ${h}, which Claude Code loads on its own`);
      else if (inside(h) && isFile(relOf(h))) hooksFile(relOf(h));
    } else if (h && typeof h === 'object') hookConfig(h, MANIFEST);
  }
  const mcpMap = (map, file) => {
    const servers = map && typeof map.mcpServers === 'object' && map.mcpServers ? map.mcpServers : map;
    for (const [name, s] of Object.entries(servers ?? {})) {
      if (s && typeof s === 'object' && typeof s.command === 'string') {
        commands.push({ file, where: `MCP server ${name}`, command: s.command, args: Array.isArray(s.args) ? s.args.map(String) : [] });
      }
    }
  };
  if (isFile('.mcp.json')) { try { mcpMap(readJson(path.join(root, '.mcp.json')), '.mcp.json'); } catch { /* another row's finding */ } }
  for (const m of manifest?.mcpServers === undefined ? [] : Array.isArray(manifest.mcpServers) ? manifest.mcpServers : [manifest.mcpServers]) {
    if (typeof m === 'string') {
      if (/\.json$/i.test(m) && inside(m) && isFile(relOf(m))) { try { mcpMap(readJson(path.join(root, relOf(m))), relOf(m)); } catch { /* another row's finding */ } }
    } else if (m && typeof m === 'object') mcpMap(m, MANIFEST);
  }

  // component paths in the manifest, and the files the commands name
  const componentPaths = [];
  if (manifest) {
    const exp = manifest.experimental && typeof manifest.experimental === 'object' ? manifest.experimental : {};
    const keyed = [
      ...['skills', 'agents', 'outputStyles', 'workflows', 'types', 'hooks', 'lspServers'].map((k) => [k, pathList(manifest[k])]),
      ['mcpServers', pathList(manifest.mcpServers).filter((p) => !/^https?:\/\//i.test(p))],
      ['commands', manifest.commands && typeof manifest.commands === 'object' && !Array.isArray(manifest.commands)
        ? Object.values(manifest.commands).map((c) => c?.source).filter((s) => typeof s === 'string')
        : pathList(manifest.commands)],
      ['experimental.themes', pathList(exp.themes)],
      ['experimental.monitors', pathList(exp.monitors)],
    ];
    for (const [key, list] of keyed) {
      for (const p of list) {
        if (path.isAbsolute(p) || !inside(p)) add('inside', BLOCKS, MANIFEST, `${key} names ${p}, outside the plugin folder`);
        else componentPaths.push(relOf(p));
      }
    }
  }
  const named = [];
  for (const c of commands) {
    for (const p of rootPaths(c)) {
      if (p === '..' || p.startsWith('../')) add('inside', BLOCKS, c.file, `the ${c.where} runs \${CLAUDE_PLUGIN_ROOT}/${p}, outside the plugin folder`);
      else named.push(p);
    }
  }

  // symbolic links, submodules and LFS pointers
  const loadedPaths = [...DEFAULT_LOADED, ...componentPaths, ...named];
  const loaded = (rel) => loadedPaths.some((p) => p === '' || rel === p || rel.startsWith(`${p}/`) || p.startsWith(`${rel}/`));
  if (repository.git) {
    const staged = git(repository.top, ['--literal-pathspecs', 'ls-files', '-s', '-z', '--', repository.rel || '.']) ?? '';
    for (const rec of staged.split('\0').filter(Boolean)) {
      const [meta, file] = rec.split('\t');
      if (!meta.startsWith('160000')) continue;
      const rel = posix(path.relative(root, path.join(repository.top, file)));
      const e = byRel.get(rel);
      if (e) e.kind = 'submodule';
      else { const n = { rel, abs: path.join(root, rel), kind: 'submodule', size: 0 }; entries.push(n); byRel.set(rel, n); }
    }
  }
  for (const e of entries) {
    const what = e.kind === 'symlink' ? 'a symbolic link' : e.kind === 'submodule' ? 'a Git submodule' : e.kind === 'file' && isLfsPointer(read(e.rel)) ? 'a Git LFS pointer file' : null;
    if (what) add('regular-files', loaded(e.rel) ? BLOCKS : WARNING, e.rel, loaded(e.rel) ? `${what} where the plugin loads it` : `${what}, in a place the plugin does not load`);
  }

  // system files and names
  for (const e of entries) {
    if (SYSTEM_FILES.includes(e.rel.split('/').pop().toLowerCase())) add('system-files', BLOCKS, e.rel, 'a macOS or Windows system file');
  }
  for (const { rel, problem } of nameProblems(entries.map((e) => e.rel))) add('names', STOPS, rel, problem);
  for (const seg of repository.rel ? repository.rel.split('/') : []) {
    if (!/^[A-Za-z0-9._-]+$/.test(seg)) add('plugin-path', STOPS, '.', `the folder ${JSON.stringify(seg)} on the path ${repository.rel} holds a character other than letters, digits, dots, hyphens and underscores`);
  }

  // .gitattributes: every one for export-ignore and export-subst; those at the root, above and inside for filter
  const attrFiles = new Map();
  for (const e of entries) if (e.kind === 'file' && e.rel.split('/').pop() === '.gitattributes') attrFiles.set(e.abs, true);
  if (subfolder) {
    for (let dir = path.dirname(root); ; dir = path.dirname(dir)) {
      const f = path.join(dir, '.gitattributes');
      if (fs.existsSync(f)) attrFiles.set(f, true);
      if (dir === repository.top || dir === path.dirname(dir)) break;
    }
  }
  if (repository.git) {
    const listed = git(repository.top, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(glob)**/.gitattributes']) ?? '';
    for (const f of listed.split('\0').filter(Boolean)) {
      const abs = path.join(repository.top, f);
      if (!attrFiles.has(abs) && fs.existsSync(abs)) attrFiles.set(abs, false);
    }
  }
  for (const [abs, applies] of attrFiles) {
    for (const { line, attr } of attributeProblems(fs.readFileSync(abs, 'utf8'), { filter: applies })) {
      add('gitattributes', STOPS, `${posix(path.relative(root, abs))}:${line}`, `sets ${attr}`);
    }
  }

  // sizes, the file count and file types
  const kinds = new Map();
  for (const e of entries) {
    if (e.kind !== 'file') continue;
    const buf = read(e.rel);
    const kind = classify(buf, e.rel);
    kinds.set(e.rel, kind);
    if (e.size >= MAX_FILE) add('file-size', STOPS, e.rel, `${e.size} bytes, not under 5 MiB (${MAX_FILE} bytes)`);
    if (kind !== 'image' && kind !== 'font' && e.size >= MAX_TEXT) add('text-size', HELD, e.rel, `${e.size} bytes, not under 256 KiB (${MAX_TEXT} bytes), and not an image or font`);
    if (kind === 'binary') add('file-types', HELD, e.rel, 'a binary file that is not a PNG, JPEG, GIF or WebP image or a font');
    if (kind === 'incomplete') add('file-types', HELD, e.rel, 'an image that is cut short');
  }
  const fileCount = entries.filter((e) => e.kind !== 'dir' && e.kind !== 'submodule').length;
  if (fileCount > MAX_FILES) add('file-count', HELD, '.', `${fileCount} files, more than ${MAX_FILES}`);

  // bundled images and fonts named from commands, hooks or scripts, or in backticks or a code block
  const assets = [...kinds].filter(([, k]) => k === 'image' || k === 'font').map(([rel]) => rel);
  if (assets.length) {
    const cmdFiles = new Set(componentFiles(manifest, entries).command);
    const mentions = (text, rel) => {
      const name = rel.split('/').pop();
      return [rel, name].some((n) => new RegExp(`(?<![A-Za-z0-9_-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`).test(text));
    };
    const sources = [];
    for (const c of commands) sources.push([c.file, rawOf(c).join(' '), `the ${c.where}'s command`]);
    for (const e of entries) {
      if (e.kind !== 'file' || kinds.get(e.rel) !== 'text') continue;
      const text = asText(read(e.rel));
      if (SCRIPT_EXT.test(e.rel) || named.includes(e.rel)) sources.push([e.rel, text, 'a script']);
      else if (cmdFiles.has(e.rel)) sources.push([e.rel, text, 'a command']);
      else if (TEXT_DOC.test(e.rel)) {
        const { prose, code } = fences(text);
        sources.push([e.rel, [...prose.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).join('\n'), 'backticks']);
        sources.push([e.rel, code, 'a code block']);
      }
    }
    for (const rel of assets) {
      for (const [file, text, how] of sources) if (mentions(text, rel)) add('image-refs', HELD, file, `${how} names the bundled ${kinds.get(rel)} ${rel}`);
    }
  }

  // credentials
  for (const e of entries) {
    if (e.kind !== 'file') continue;
    const text = read(e.rel).toString('latin1');
    for (const [what, re] of CREDENTIALS) {
      const m = re.exec(text);
      if (m) add('credentials', BLOCKS, `${e.rel}:${text.slice(0, m.index).split('\n').length}`, `${what}`);
    }
  }

  // launchers, package sources, and the ${CLAUDE_PLUGIN_ROOT} row
  let launcherUsed = false;
  for (const c of commands) {
    for (const { launcher, problem } of launchers(wordsOf(c))) {
      launcherUsed = true;
      const title = launcher === 'npx' ? 'Unpinned npx launcher' : launcher === 'uvx' ? 'Unpinned uvx launcher' : undefined;
      if (problem) add('launcher-pin', BLOCKS, c.file, `the ${c.where}: ${problem}`, title);
    }
    if (subfolder) for (const p of commandProblems(c)) add('hook-paths', BLOCKS, c.file, `the ${c.where}'s command holds ${p}`);
  }
  const lockfileInstall = isFile('package.json') && LOCKFILES.some(isFile);
  const installs = lockfileInstall || commands.some((c) => INSTALL_RE.test(rawOf(c).join(' ')));
  for (const e of entries) {
    const re = SOURCE_FILES[e.rel.split('/').pop()];
    if (e.kind !== 'file' || !re || !re.test(asText(read(e.rel)))) continue;
    if (launcherUsed) add('package-source', BLOCKS, e.rel, 'sets a package source, and a hook or MCP server runs a launcher');
    else if (installs) add('package-source', HELD, e.rel, `sets a package source, and ${lockfileInstall ? 'package.json sits beside a lockfile' : 'a hook or MCP server runs a package install'}`, 'Install may use a custom registry or package source');
  }

  // the manifest's fields
  if (manifest) {
    const name = manifest.name;
    if (typeof name === 'string' && /[^\x00-\x7f]/.test(name)) add('name-pattern', BLOCKS, MANIFEST, `name ${JSON.stringify(name)} holds a character outside ASCII`, 'Non-ASCII identifier');
    else if (typeof name !== 'string' || !NAME_RE.test(name)) add('name-pattern', WARNING, MANIFEST, `name ${JSON.stringify(name)} does not match ${NAME_RE.source}`);
    if (typeof name === 'string') {
      const parts = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      if (RESERVED.includes(name.toLowerCase())) add('name-reserved', BLOCKS, MANIFEST, `name ${JSON.stringify(name)} is a reserved word on its own`, 'Name is taken');
      else if (parts.length > 1 && parts.every((p) => RESERVED.includes(p))) add('name-reserved', HELD, MANIFEST, `name ${JSON.stringify(name)} is made only of generic words`, 'Name may be confused with an existing listing');
    }
    for (const [field, value] of [['displayName', manifest.displayName], ['author.name', manifest.author?.name]]) {
      if (value === undefined) continue;
      const odd = [...String(value)].filter((ch) => !/^[\x20-\x7e]$/.test(ch));
      if (typeof value !== 'string' || odd.length) {
        add('display-names', BLOCKS, MANIFEST, `${field} ${JSON.stringify(value)} is not plain ASCII${odd.length ? ` (${[...new Set(odd)].map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(', ')})` : ''}`);
      }
    }
    for (const key of Object.keys(manifest)) {
      if (FIELDS.includes(key) || EXPERIMENTAL_KEYS.includes(key)) continue;
      const meant = [...COMPONENT_KEYS, ...EXPERIMENTAL_KEYS].find((k) => squash(k) === squash(key));
      if (meant) add('component-keys', BLOCKS, MANIFEST, `the key ${JSON.stringify(key)} is not spelled as the plugins reference spells ${meant}`);
    }
    if (manifest.experimental && typeof manifest.experimental === 'object') {
      for (const key of Object.keys(manifest.experimental)) {
        const meant = COMPONENT_KEYS.find((k) => squash(k) === squash(key));
        if (meant) add('component-keys', BLOCKS, MANIFEST, `the component key ${JSON.stringify(key)} sits under experimental`);
      }
    }
    const set = (v) => (typeof v === 'string' ? v.trim() !== '' : v && typeof v === 'object');
    if (!set(manifest.description)) add('metadata', WARNING, MANIFEST, 'description is not set');
    if (!set(manifest.author) || (typeof manifest.author === 'object' && !set(manifest.author.name))) add('metadata', WARNING, MANIFEST, 'author is not set');
    if (!set(manifest.version)) add('metadata', WARNING, MANIFEST, 'version is not set');
  }

  // README and licence
  const top = entries.filter((e) => e.kind === 'file' && !e.rel.includes('/'));
  const readme = top.find((e) => e.rel === 'README.md') ?? top.find((e) => /^readme(?:\.[A-Za-z0-9]+)?$/i.test(e.rel));
  if (!readme) add('readme', BLOCKS, 'README.md', 'the plugin folder holds no README', 'README missing');
  else {
    const n = words(fences(asText(read(readme.rel))).prose);
    if (n < 40) add('readme', BLOCKS, readme.rel, `${n} words outside code blocks, fewer than 40`, 'README too short');
  }
  const licenceFile = top.some((e) => /^licen[cs]e(?:\.[A-Za-z0-9]+)?$/i.test(e.rel));
  if (!licenceFile && !(typeof manifest?.license === 'string' && manifest.license.trim())) add('licence', BLOCKS, 'LICENSE', 'no LICENSE file in the plugin folder, and no license in plugin.json');

  // skill, command and agent front matter
  const comps = componentFiles(manifest, entries);
  for (const [kind, list] of Object.entries(comps)) {
    for (const rel of list) {
      const fm = frontMatter(asText(read(rel)));
      if (!fm.found) add('front-matter', WARNING, rel, `the ${kind} file has no front matter`);
      else if (fm.error) add('front-matter', BLOCKS, rel, `the front matter does not parse: ${fm.error}`);
      else {
        const d = fm.keys.get('description');
        if (d === undefined || d === 'null') add('front-matter', WARNING, rel, `the ${kind} file's front matter has no description`);
        else if (d !== 'string') add('front-matter', BLOCKS, rel, `description is a ${d}, not a single text value`);
      }
    }
  }

  const order = Object.keys(RULES);
  findings.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { root, repository, findings };
}

// The skill, command and agent files the plugin declares, by its manifest or the default folders.
export function componentFiles(manifest, entries) {
  const files = entries.filter((e) => e.kind === 'file').map((e) => e.rel);
  const isDir = (rel) => rel === '' || entries.some((e) => e.rel === rel && e.kind === 'dir');
  const under = (dir, re) => files.filter((f) => (dir ? f.startsWith(`${dir}/`) : true) && re.test(dir ? f.slice(dir.length + 1) : f));
  const skill = [];
  for (const d of ['skills', ...pathList(manifest?.skills).map(relOf)]) {
    if (!isDir(d)) continue;
    skill.push(...under(d, /^SKILL\.md$/), ...under(d, /^[^/]+\/SKILL\.md$/));
  }
  if (!isDir('skills') && manifest?.skills === undefined && files.includes('SKILL.md')) skill.push('SKILL.md');
  const command = [];
  const c = manifest?.commands;
  const commandPaths = c === undefined ? ['commands'] : c && typeof c === 'object' && !Array.isArray(c)
    ? Object.values(c).map((x) => x?.source).filter((s) => typeof s === 'string') : pathList(c);
  for (const p of commandPaths.map(relOf)) {
    if (files.includes(p) && p.endsWith('.md')) command.push(p);
    else if (isDir(p) && p !== '') command.push(...under(p, /^[^/]+\.md$/));
  }
  const agent = [];
  for (const p of (manifest?.agents === undefined ? ['agents'] : pathList(manifest.agents)).map(relOf)) {
    if (files.includes(p) && p.endsWith('.md')) agent.push(p);
    else if (isDir(p) && p !== '' && manifest?.agents === undefined) agent.push(...under(p, /\.md$/));
  }
  const uniq = (a) => [...new Set(a)].filter((f) => !f.startsWith('../'));
  return { skill: uniq(skill), command: uniq(command), agent: uniq(agent) };
}

// The findings that fail the run: Blocks, Validation stops, and holds not in the list of reviewer confirmations.
export function failing(findings, confirmations = CONFIRMATIONS) {
  const confirmed = new Set(confirmations.map((c) => norm(c.title)));
  return findings.filter((f) => f.result === BLOCKS || f.result === STOPS || (f.result === HELD && !confirmed.has(norm(f.title))));
}

// one finding as one line: result | rule | file | title and what was found | the row's words
export const line = (f) => [f.result, f.id, f.file, `${f.title ? `${f.title}: ` : ''}${f.detail}`, RULES[f.id].row]
  .map((x) => String(x).replace(/\s*[\r\n]+\s*/g, ' ')).join(' | ');

function main(argv) {
  if (argv.length !== 1) {
    console.error('usage: node tools/plugin-checklist.mjs <plugin folder>');
    return 2;
  }
  const folder = argv[0];
  let st = null;
  try { st = fs.statSync(folder); } catch { /* missing */ }
  if (!st?.isDirectory()) {
    console.error(`plugin-checklist: ${folder} is not a folder`);
    return 2;
  }
  const { repository, findings } = check(folder);
  const where = !repository.git ? 'not in a git repository, so it is checked as the root of its own repository'
    : repository.rel ? `the folder ${repository.rel} of the repository at ${repository.top}` : `the root of the repository at ${repository.top}`;
  console.log(`plugin-checklist: ${folder}: ${where}; checklist read 2026-10-19 from https://claude.com/docs/plugins/pre-submission-checklist`);
  for (const f of findings) console.log(line(f));
  for (const c of CONFIRMATIONS) console.log(`Reviewer confirmation | ${HELD} | ${c.title}: ${c.reason} | ${c.row}`);
  const fail = failing(findings);
  const count = (r) => findings.filter((f) => f.result === r).length;
  const tally = [BLOCKS, STOPS, HELD, WARNING, NOTE].map((r) => `${count(r)} ${r}`).join(', ');
  console.log(`plugin-checklist: ${findings.length} finding${findings.length === 1 ? '' : 's'} (${tally}); ${fail.length ? `${fail.length} fail the check` : 'the folder meets the checklist rows files can show'}`);
  return fail.length ? 1 : 0;
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
