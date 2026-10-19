// PLG-10: tools/plugin-checklist.mjs holds a plugin folder to Anthropic's pre-submission checklist
// (https://claude.com/docs/plugins/pre-submission-checklist, read 2026-10-19). Each case below copies one fixture folder
// from fixtures/plugin-checklist into a scratch git repository, at <repository>/plugin unless it says otherwise, so the
// plugin sits below the repository root as packages/cli/plugin does, runs the tool on it, and holds its findings to
// exactly the one the case breaks, with the result the checklist gives it, and its exit code to that result: 1 for
// Blocks, Validation stops and an unconfirmed hold, 0 for a Warning or a Note. The committed fixtures are plain text.
// What the repository must never hold is written by the test at run time into the scratch copy: images, fonts and other
// binary files, a 5 MiB file, 513 files, symbolic links, submodules, LFS pointers, system files, names Windows refuses,
// .gitattributes, package-manager files and credential-shaped text. Every rule has at least one case that fails it,
// and the real plugin folder passes with no finding.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  RULES, CONFIRMATIONS, BLOCKS, STOPS, HELD, WARNING, NOTE, MAX_FILE, MAX_TEXT, MAX_FILES,
  failing, nameProblems, frontMatter, launchers, shellWords, classify, attributeProblems,
} from '../plugin-checklist.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TOOL = path.join(ROOT, 'tools/plugin-checklist.mjs');
const FIXTURES = path.join(ROOT, 'tools/test/fixtures/plugin-checklist');
const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-checklist-')));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));
// git finds no repository above the scratch directory, and reads no user or system configuration
const ENV = { PATH: process.env.PATH, HOME: BASE, GIT_CEILING_DIRECTORIES: BASE, GIT_CONFIG_NOSYSTEM: '1', LANG: 'C' };
const RESULT = /^(Blocks|Validation stops|Held for a reviewer|Warning|Note) \| /;

const write = (dir, rel, data) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), data);
};
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
const readJson = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
const manifest = (dir, change) => write(dir, '.claude-plugin/plugin.json', json(change(readJson(dir, '.claude-plugin/plugin.json'))));
const hook = (command) => json({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } });
const mcp = (command, args) => json({ mcpServers: { docs: { command, args } } });
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf8' }).trim();

// --- binary files, written at run time ---------------------------------------------------------------------------
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const u32 = (n, le = false) => { const b = Buffer.alloc(4); if (le) b.writeUInt32LE(n); else b.writeUInt32BE(n); return b; };
const chunk = (type, data) => Buffer.concat([u32(data.length), Buffer.from(type, 'latin1'), data, u32(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])))]);
// a 1 by 1 PNG; with size, a private chunk pads it to exactly that many bytes
function png(size) {
  const ihdr = Buffer.concat([u32(1), u32(1), Buffer.from([8, 2, 0, 0, 0])]);
  const head = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255])))];
  const end = chunk('IEND', Buffer.alloc(0));
  const plain = Buffer.concat([...head, end]);
  return size ? Buffer.concat([...head, chunk('prVt', Buffer.alloc(size - plain.length - 12, 0x2e)), end]) : plain;
}
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9])]);
const gif = () => Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([1, 0, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0, 0x3b])]);
function webp() {
  const payload = Buffer.from([0x2f, 0, 0, 0, 0, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0x00]);
  const body = Buffer.concat([Buffer.from('WEBPVP8L', 'latin1'), u32(payload.length, true), payload]);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), u32(body.length, true), body]);
}
const woff2 = () => Buffer.concat([Buffer.from('wOF2', 'latin1'), Buffer.alloc(44)]);
const ico = () => Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]), Buffer.alloc(64)]);
const pdf = () => Buffer.concat([Buffer.from('%PDF-1.4\n', 'latin1'), Buffer.from([0, 0xe2, 0xe3, 0xcf, 0xd3, 0]), Buffer.from('\n%%EOF\n', 'latin1')]);
const LFS = 'version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 12345\n';
const countFiles = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length;
// credential-shaped text, built here so no file in the repository holds one
const join = (...parts) => parts.join('');
const SECRETS = [
  join('gh', 'p_', 'a1B2c3D4'.repeat(4), 'e5F6'),
  join('github', '_pat_', '11ABCDEFG0', 'x'.repeat(40)),
  join('sk', '-ant-', 'api03-', 'k'.repeat(40)),
  join('AK', 'IA', 'QWERTYUIOPASDFGH'),
  join('xo', 'xb-', '1234567890-', 'abcdefghij'),
  join('xo', 'xp-', '1234567890-', 'abcdefghij'),
  join('-----BEGIN', ' RSA PRIVATE', ' KEY-----'),
];

let caseNo = 0;
// a scratch copy of a fixture: in a git repository at <repository>/<at> (at '' is the repository root), or with git
// false in a folder outside any repository; edit(dir, repository) then changes it
function build(fixture, { at = 'plugin', git: inGit = true, edit } = {}) {
  const repository = path.join(BASE, `case-${++caseNo}`);
  const dir = at ? path.join(repository, at) : repository;
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(FIXTURES, fixture), dir, { recursive: true });
  if (inGit) git(repository, 'init', '-q');
  if (edit) edit(dir, repository);
  return dir;
}
function run(dir, env = ENV) {
  const r = spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8', env, cwd: BASE, timeout: 60000 });
  const findings = r.stdout.split('\n').filter((l) => RESULT.test(l)).map((l) => {
    const [result, id, file, detail] = l.split(' | ');
    return { result, id, file, detail };
  });
  return { ...r, findings };
}

// [name, fixture, options, expected findings as [rule, result]]; the exit code follows from the results
const CASES = [
  // the manifest
  ['no .claude-plugin/plugin.json', 'no-manifest', {}, [['manifest', BLOCKS]]],
  ['a plugin.json that is not JSON', 'valid', { edit: (d) => { write(d, '.claude-plugin/plugin.json', '{ "name": '); write(d, 'LICENSE', 'Apache-2.0\n'); } }, [['manifest', BLOCKS]]],
  ['no plugin.json anywhere, and skills/<name>/SKILL.md: a note', 'skills-only', {}, [['manifest', NOTE]]],
  // inside the folder
  ['a component path in plugin.json outside the folder', 'path-outside', {}, [['inside', BLOCKS]]],
  ['a hooks file in plugin.json outside the folder', 'valid', { edit: (d) => manifest(d, (m) => ({ ...m, hooks: '../shared-hooks.json' })) }, [['inside', BLOCKS]]],
  ['a hook command that runs a file above ${CLAUDE_PLUGIN_ROOT}', 'valid', { edit: (d) => write(d, 'hooks/hooks.json', hook('node "${CLAUDE_PLUGIN_ROOT}/../shared/stop.mjs"')) }, [['inside', BLOCKS]]],
  // regular files
  ['a symbolic link the hook runs', 'valid', { edit: (d) => { write(d, 'lib/stop.mjs', fs.readFileSync(path.join(d, 'hooks/stop.mjs'))); fs.rmSync(path.join(d, 'hooks/stop.mjs')); fs.symlinkSync('../lib/stop.mjs', path.join(d, 'hooks/stop.mjs')); } }, [['regular-files', BLOCKS]]],
  ['a symbolic link the plugin does not load: a warning', 'valid', { edit: (d) => { fs.mkdirSync(path.join(d, 'docs')); fs.symlinkSync('../README.md', path.join(d, 'docs/readme.md')); } }, [['regular-files', WARNING]]],
  ['a submodule under skills/', 'valid', { edit: (d) => write(d, 'skills/vendor/.git', 'gitdir: ../../../.git/modules/vendor\n') }, [['regular-files', BLOCKS]]],
  ['a submodule in the index only, where the plugin does not load it: a warning', 'valid', {
    edit: (d, repo) => {
      fs.mkdirSync(path.join(d, 'vendor'));
      const sha = execFileSync('git', ['-C', repo, 'hash-object', '-w', '--stdin'], { env: ENV, input: 'vendor\n', encoding: 'utf8' }).trim();
      git(repo, 'update-index', '--add', '--cacheinfo', `160000,${sha},plugin/vendor`);
    },
  }, [['regular-files', WARNING]]],
  ['an LFS pointer where the hook script should be', 'valid', { edit: (d) => write(d, 'hooks/stop.mjs', LFS) }, [['regular-files', BLOCKS]]],
  // system files
  ...['.DS_Store', 'assets/Thumbs.db', 'desktop.ini', '__MACOSX/logo.svg'].map((f) => [`${f} in the folder`, 'valid', { edit: (d) => write(d, f, 'x\n') }, [['system-files', BLOCKS]]]),
  // names
  ...['notes:old.md', 'notes.', 'notes ', 'con.md', 'docs/prn'].map((f) => [`the name ${JSON.stringify(f)}`, 'valid', { edit: (d) => write(d, f, 'x\n') }, [['names', STOPS]]]),
  // the path to the plugin
  ['a space in a folder on the path to the plugin', 'valid', { at: 'my plugin' }, [['plugin-path', STOPS]]],
  ['a plus sign in a folder on the path to the plugin', 'valid', { at: 'plugins/fixture+plugin' }, [['plugin-path', STOPS]]],
  // .gitattributes
  ['export-ignore at the repository root', 'valid', { edit: (d, repo) => write(repo, '.gitattributes', '*.md export-ignore\n') }, [['gitattributes', STOPS]]],
  ['filter=lfs inside the plugin folder', 'valid', { edit: (d) => write(d, '.gitattributes', '*.svg filter=lfs diff=lfs merge=lfs -text\n') }, [['gitattributes', STOPS]]],
  ['export-subst in a folder beside the plugin', 'valid', { edit: (d, repo) => write(repo, 'other/.gitattributes', '* export-subst\n') }, [['gitattributes', STOPS]]],
  ['export-ignore in a plugin outside git', 'valid', { git: false, edit: (d) => write(d, '.gitattributes', 'docs/ export-ignore\n') }, [['gitattributes', STOPS]]],
  // sizes, count and types
  ['an image of 5 MiB', 'valid', { edit: (d) => write(d, 'assets/large.png', png(MAX_FILE)) }, [['file-size', STOPS]]],
  ['a text file of 256 KiB', 'valid', { edit: (d) => write(d, 'docs/large.txt', 'a\n'.repeat(MAX_TEXT / 2)) }, [['text-size', HELD]]],
  [`${MAX_FILES + 1} files`, 'valid', { edit: (d) => { const n = MAX_FILES + 1 - countFiles(d); for (let i = 0; i < n; i++) write(d, `notes/n${i}.txt`, `${i}\n`); } }, [['file-count', HELD]]],
  ['an .ico file', 'valid', { edit: (d) => write(d, 'assets/favicon.ico', ico()) }, [['file-types', HELD]]],
  ['a PNG cut short', 'valid', { edit: (d) => write(d, 'assets/cut.png', png().subarray(0, 40)) }, [['file-types', HELD]]],
  ['a PDF', 'valid', { edit: (d) => write(d, 'docs/manual.pdf', pdf()) }, [['file-types', HELD]]],
  // bundled images
  ['an image path in backticks in the README', 'image-ref', {}, [['image-refs', HELD]]],
  ['an image path in a code block in the README', 'valid', { edit: (d) => fs.appendFileSync(path.join(d, 'README.md'), '\n```\nassets/logo.svg\n```\n') }, [['image-refs', HELD]]],
  ['an image the hook script names', 'valid', { edit: (d) => fs.appendFileSync(path.join(d, 'hooks/stop.mjs'), "// draws logo.svg\n") }, [['image-refs', HELD]]],
  ['an image a command names', 'valid', { edit: (d) => fs.appendFileSync(path.join(d, 'commands/greet.md'), '\nShow logo.svg as well.\n') }, [['image-refs', HELD]]],
  ['a font a script names', 'valid', { edit: (d) => { write(d, 'assets/mono.woff2', woff2()); write(d, 'scripts/draw.sh', 'cat assets/mono.woff2\n'); } }, [['image-refs', HELD]]],
  // the name
  ['a name with a character outside ASCII', 'name-non-ascii', {}, [['name-pattern', BLOCKS]]],
  ['a name with capitals: a warning', 'valid', { edit: (d) => manifest(d, (m) => ({ ...m, name: 'Fixture-Plugin' })) }, [['name-pattern', WARNING]]],
  ['the name plugin', 'name-reserved', {}, [['name-reserved', BLOCKS]]],
  ['the name claude', 'valid', { edit: (d) => manifest(d, (m) => ({ ...m, name: 'claude' })) }, [['name-reserved', BLOCKS]]],
  ['a name made only of generic words: held', 'valid', { edit: (d) => manifest(d, (m) => ({ ...m, name: 'test-plugin' })) }, [['name-reserved', HELD]]],
  ['an invisible character in displayName', 'display-name', {}, [['display-names', BLOCKS]]],
  ['author.name outside ASCII', 'valid', { edit: (d) => manifest(d, (m) => ({ ...m, author: { name: 'José' } })) }, [['display-names', BLOCKS]]],
  // component keys and metadata
  ['mcp_servers for mcpServers', 'component-key', {}, [['component-keys', BLOCKS]]],
  ['outputstyle for outputStyles', 'valid', { edit: (d) => manifest(d, (m) => ({ ...m, outputstyle: './styles/' })) }, [['component-keys', BLOCKS]]],
  ['hooks under experimental', 'valid', { edit: (d) => manifest(d, (m) => ({ ...m, experimental: { hooks: './more-hooks.json' } })) }, [['component-keys', BLOCKS]]],
  ['no version: a warning', 'metadata', {}, [['metadata', WARNING]]],
  ['no description: a warning', 'valid', { edit: (d) => manifest(d, ({ description, ...m }) => m) }, [['metadata', WARNING]]],
  ['no author: a warning', 'valid', { edit: (d) => manifest(d, ({ author, ...m }) => m) }, [['metadata', WARNING]]],
  // README and licence
  ['a README under 40 words outside its code block', 'readme-short', {}, [['readme', BLOCKS]]],
  ['no README', 'valid', { edit: (d) => fs.rmSync(path.join(d, 'README.md')) }, [['readme', BLOCKS]]],
  ['no licence', 'no-licence', {}, [['licence', BLOCKS]]],
  // launchers
  ['npx with no version', 'launcher-unpinned', {}, [['launcher-pin', BLOCKS]]],
  ...[
    ['npx', ['-y', 'docs-server@latest']], ['npx', ['-y', 'docs-server@^1.2.0']], ['npx', ['--package', 'docs-server@1', 'docs']],
    ['bunx', ['docs-server']], ['pnpm', ['dlx', 'docs-server']], ['yarn', ['dlx', 'docs-server@~1.2.3']], ['uvx', ['docs-server']],
    ['uvx', ['docs-server>=1.2']], ['pipx', ['run', 'docs-server']], ['uv', ['run', '${CLAUDE_PLUGIN_ROOT}/server.py']],
  ].map(([cmd, args]) => [`${[cmd, ...args].join(' ')}`, 'valid', { edit: (d) => write(d, '.mcp.json', mcp(cmd, args)) }, [['launcher-pin', BLOCKS]]]),
  ['npx with no version in a hook command', 'valid', { edit: (d) => write(d, 'hooks/hooks.json', hook('npx -y fmt-tool')) }, [['launcher-pin', BLOCKS]]],
  // package sources
  ['an .npmrc registry beside a launcher', 'valid', { edit: (d) => { write(d, '.mcp.json', mcp('npx', ['-y', 'docs-server@1.2.3'])); write(d, '.npmrc', 'registry=https://registry.example.com/\n'); } }, [['package-source', BLOCKS]]],
  ['a bunfig.toml registry beside a launcher', 'valid', { edit: (d) => { write(d, '.mcp.json', mcp('bunx', ['docs-server@1.2.3'])); write(d, 'bunfig.toml', '[install]\nregistry = "https://registry.example.com/"\n'); } }, [['package-source', BLOCKS]]],
  ['a uv.toml index beside a launcher', 'valid', { edit: (d) => { write(d, '.mcp.json', mcp('uvx', ['docs-server==1.2.3'])); write(d, 'uv.toml', 'index-url = "https://pypi.example.com/simple"\n'); } }, [['package-source', BLOCKS]]],
  ['an .npmrc registry beside a lockfile install: held', 'valid', { edit: (d) => { write(d, 'package.json', '{ "private": true }\n'); write(d, 'package-lock.json', '{ "lockfileVersion": 3 }\n'); write(d, '.npmrc', '@acme:registry=https://registry.example.com/\n'); } }, [['package-source', HELD]]],
  // credentials
  ...SECRETS.map((s, i) => [`credential shape ${i + 1} in a document`, 'valid', { edit: (d) => write(d, 'docs/setup.md', `# Setup\n\nThe value is ${s} here.\n`) }, [['credentials', BLOCKS]]]),
  // ${CLAUDE_PLUGIN_ROOT}
  ['a relative path in the hook command', 'hook-path', {}, [['hook-paths', BLOCKS]]],
  ...[
    ['another variable', 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs" "$CLAUDE_PROJECT_DIR"'],
    ['${CLAUDE_PLUGIN_DATA}', 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs" "${CLAUDE_PLUGIN_DATA}"'],
    ['a command substitution', 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs" $(date)'],
    ['backticks', 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs" `date`'],
    ['a wildcard', 'node "${CLAUDE_PLUGIN_ROOT}"/hooks/*.mjs'],
    ['an inline node program', 'node -e "process.exit(0)"'],
    ['an inline shell program', 'bash -c "exit 0"'],
    ['an inline python program', 'python3 -c "print(1)"'],
    ['an absolute path', 'node /opt/hooks/stop.mjs'],
  ].map(([what, command]) => [`${what} in the hook command`, 'valid', { edit: (d) => write(d, 'hooks/hooks.json', hook(command)) }, [['hook-paths', BLOCKS]]]),
  ['a relative path in an MCP server command', 'valid', { edit: (d) => write(d, '.mcp.json', mcp('node', ['server.js'])) }, [['hook-paths', BLOCKS]]],
  // hooks/hooks.json
  ['hooks.json that is not JSON', 'hooks-invalid', {}, [['hooks-json', BLOCKS]]],
  ['hooks.json with no top-level hooks', 'valid', { edit: (d) => write(d, 'hooks/hooks.json', json(JSON.parse(hook('node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"')).hooks)) }, [['hooks-json', BLOCKS]]],
  ['an unknown hook event', 'valid', { edit: (d) => write(d, 'hooks/hooks.json', hook('node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"').replace('"Stop"', '"OnStop"')) }, [['hooks-json', BLOCKS]]],
  ['an unknown hook type', 'valid', { edit: (d) => write(d, 'hooks/hooks.json', hook('node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"').replace('"command",', '"shell",')) }, [['hooks-json', BLOCKS]]],
  ['an HTTP hook on http://', 'valid', { edit: (d) => write(d, 'hooks/hooks.json', json({ hooks: { Stop: [{ hooks: [{ type: 'http', url: 'http://example.com/hook' }] }] } })) }, [['hooks-json', BLOCKS]]],
  ['an inline hook in plugin.json with an unknown event', 'valid', { edit: (d) => manifest(d, (m) => ({ ...m, hooks: { BeforeStop: [] } })) }, [['hooks-json', BLOCKS]]],
  ['hooks/hooks.json named again in plugin.json: a warning', 'hooks-listed', {}, [['hooks-listed', WARNING]]],
  // front matter
  ['a skill whose description is a list', 'front-matter', {}, [['front-matter', BLOCKS]]],
  ...[
    ['a colon and space in a plain description', '---\nname: hello\ndescription: Use it when: the user says hello\n---\n'],
    ['front matter that never closes', '---\nname: hello\ndescription: Say hello.\n'],
    ['a description in brackets', '---\nname: hello\ndescription: [hello, goodbye]\n---\n'],
    ['a number for a description', '---\nname: hello\ndescription: 42\n---\n'],
    ['a description given twice', '---\ndescription: Say hello.\ndescription: Say goodbye.\n---\n'],
  ].map(([what, text]) => [what, 'valid', { edit: (d) => write(d, 'skills/hello/SKILL.md', `${text}\nBody.\n`) }, [['front-matter', BLOCKS]]]),
  ['a command with no front matter: a warning', 'valid', { edit: (d) => write(d, 'commands/greet.md', 'Greet $ARGUMENTS.\n') }, [['front-matter', WARNING]]],
  ['an agent with no description: a warning', 'valid', { edit: (d) => write(d, 'agents/reviewer.md', '---\nname: reviewer\n---\n\nReview.\n') }, [['front-matter', WARNING]]],
];

// variants of the valid folder that the checklist accepts: none may raise a finding, so a rule that fires too widely fails
const PASSES = [
  ['the valid folder in a git repository', 'valid', {}],
  ['the valid folder at the repository root', 'valid', { at: '' }],
  ['the valid folder outside git', 'valid', { git: false }],
  ['a relative hook path at the repository root, where the row does not block', 'hook-path', { at: '' }],
  ['a relative hook path outside git', 'hook-path', { git: false }],
  ['a folder name of letters, digits, dots, hyphens and underscores', 'valid', { at: 'plugins/fixture.plugin_2-x' }],
  ['filter=lfs in a folder beside the plugin', 'valid', { edit: (d, repo) => write(repo, 'other/.gitattributes', '*.bin filter=lfs\n') }],
  ['unset attributes and line ends in .gitattributes', 'valid', { edit: (d, repo) => write(repo, '.gitattributes', '* text=auto eol=lf\n*.md -export-ignore\n') }],
  ['an image just under 5 MiB', 'valid', { edit: (d) => write(d, 'assets/large.png', png(MAX_FILE - 1)) }],
  ['a text file just under 256 KiB', 'valid', { edit: (d) => write(d, 'docs/large.txt', 'a'.repeat(MAX_TEXT - 1)) }],
  ['an image over 256 KiB', 'valid', { edit: (d) => write(d, 'assets/photo.png', png(300 * 1024)) }],
  [`${MAX_FILES} files`, 'valid', { edit: (d) => { const n = MAX_FILES - countFiles(d); for (let i = 0; i < n; i++) write(d, `notes/n${i}.txt`, `${i}\n`); } }],
  ['complete PNG, JPEG, GIF and WebP images and a font', 'valid', { edit: (d) => { write(d, 'assets/a.png', png()); write(d, 'assets/b.jpg', jpeg()); write(d, 'assets/c.gif', gif()); write(d, 'assets/d.webp', webp()); write(d, 'assets/e.woff2', woff2()); } }],
  ['a README.txt', 'valid', { edit: (d) => fs.renameSync(path.join(d, 'README.md'), path.join(d, 'README.txt')) }],
  ['a LICENSE file and no license field', 'no-licence', { edit: (d) => write(d, 'LICENSE', 'Apache-2.0\n') }],
  ['top-level themes, and themes and monitors under experimental', 'valid', { edit: (d) => manifest(d, (m) => ({ ...m, themes: './themes/', experimental: { themes: './themes/', monitors: './monitors.json' } })) }],
  ['component paths inside the folder', 'valid', { edit: (d) => manifest(d, (m) => ({ ...m, skills: ['./skills/'], agents: ['./agents/reviewer.md'], commands: { greet: { source: './commands/greet.md' } } })) }],
  ['a hooks.json with a modules array only', 'valid', { edit: (d) => write(d, 'hooks/hooks.json', json({ modules: [] })) }],
  ['exec form with args from ${CLAUDE_PLUGIN_ROOT}', 'valid', { edit: (d) => write(d, 'hooks/hooks.json', json({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs', '--quiet'] }] }] } })) }],
  ...[
    ['npx', ['-y', 'docs-server@1.2.3']], ['npx', ['-y', '@acme/docs-server@1.2.3']], ['uvx', ['docs-server==1.2.3']],
    ['uvx', ['--from', 'docs-server==1.2.3', 'docs']], ['uv', ['run', '--locked', '${CLAUDE_PLUGIN_ROOT}/server.py']],
    ['pipx', ['run', '--spec', 'docs-server==1.2.3', 'docs']], ['pnpm', ['dlx', '--package=docs-server@1.2.3', 'docs']],
  ].map(([cmd, args]) => [`${[cmd, ...args].join(' ')}`, 'valid', { edit: (d) => write(d, '.mcp.json', mcp(cmd, args)) }]),
  ['an .npmrc registry with no launcher or install', 'valid', { edit: (d) => write(d, '.npmrc', 'registry=https://registry.example.com/\n') }],
  ['an .npmrc that sets no source beside a launcher', 'valid', { edit: (d) => { write(d, '.mcp.json', mcp('npx', ['-y', 'docs-server@1.2.3'])); write(d, '.npmrc', 'save-exact=true\n'); } }],
  ['example values that are not credential-shaped', 'valid', { edit: (d) => write(d, 'docs/setup.md', `Set GITHUB_TOKEN to ${join('gh', 'p_', 'example')} and the key to ${join('AK', 'IA', 'EXAMPLE')}.\n`) }],
  ['quoted, block and multi-line plain descriptions', 'valid', {
    edit: (d) => {
      write(d, 'skills/hello/SKILL.md', '---\nname: hello\ndescription: "Use it when: the user says hello"\n---\n');
      write(d, 'skills/bye/SKILL.md', '---\nname: bye\ndescription: >-\n  Say goodbye\n  when the user leaves.\nallowed-tools: [Read, Grep]\n---\n');
      write(d, 'skills/wave/SKILL.md', '---\n# a comment\nname: wave\ndescription: Wave at the user\n  when they arrive. # and a note\nmetadata:\n  owner: mgillr\n---\n');
    },
  }],
  ['an image shown with Markdown image syntax only', 'valid', { edit: (d) => fs.appendFileSync(path.join(d, 'README.md'), '\nThe same logo: ![logo](./assets/logo.svg)\n') }],
];

for (const [name, fixture, options, expected] of CASES) {
  const status = expected.some(([, r]) => r === BLOCKS || r === STOPS || r === HELD) ? 1 : 0;
  test(`${expected[0][0]}: ${name} gives ${expected.map(([, r]) => r).join(', ')} and exit ${status}`, () => {
    const r = run(build(fixture, options));
    assert.deepEqual(r.findings.map((f) => [f.id, f.result]), expected, `${r.stdout}${r.stderr}`);
    assert.equal(r.status, status, `${r.stdout}${r.stderr}`);
  });
}

for (const [name, fixture, options] of PASSES) {
  test(`no finding: ${name}`, () => {
    const r = run(build(fixture, options));
    assert.deepEqual(r.findings, [], `${r.stdout}${r.stderr}`);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });
}

test('every rule has a case that breaks it, and each committed fixture folder is one of the cases', () => {
  const broken = new Set(CASES.flatMap(([, , , expected]) => expected.map(([id]) => id)));
  assert.deepEqual([...broken].sort(), Object.keys(RULES).sort());
  const used = new Set([...CASES, ...PASSES].map(([, fixture]) => fixture));
  assert.deepEqual(fs.readdirSync(FIXTURES).filter((f) => !used.has(f)), []);
});

test('the real plugin folder, packages/cli/plugin, has no finding, exits 0 and names the reviewer confirmation', () => {
  const r = run(path.join(ROOT, 'packages/cli/plugin'), { PATH: process.env.PATH, HOME: BASE, GIT_CONFIG_NOSYSTEM: '1', LANG: 'C' });
  assert.deepEqual(r.findings, [], r.stdout);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^Reviewer confirmation \| Held for a reviewer \| Uses a credential from the user’s machine: the test runner \(packages\/core\/run\) runs the project's own changed tests with the session's environment/m);
  assert.match(r.stdout, /^plugin-checklist: 0 findings .*the folder meets the checklist rows files can show$/m);
});

test('a failing run names the reviewer confirmation too, and a line carries the rule, its result and the file', () => {
  const r = run(build('no-licence'));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^Reviewer confirmation \| Held for a reviewer \| Uses a credential from the user’s machine: /m);
  assert.match(r.stdout, new RegExp(`^Blocks \\| licence \\| LICENSE \\| License missing: .* \\| ${RULES.licence.row}$`, 'm'));
  assert.match(r.stdout, /^plugin-checklist: 1 finding \(1 Blocks, 0 Validation stops, 0 Held for a reviewer, 0 Warning, 0 Note\); 1 fail the check$/m);
});

test('the run fails on Blocks, Validation stops and any hold that is not a reviewer confirmation', () => {
  assert.equal(CONFIRMATIONS.length, 1);
  assert.equal(CONFIRMATIONS[0].title, 'Uses a credential from the user’s machine');
  const held = (title) => ({ result: HELD, title });
  assert.deepEqual(failing([held('Uses a credential from the user’s machine')]), []);
  assert.deepEqual(failing([held('Uses a credential from the user\'s machine')]), []);
  assert.equal(failing([held('Files or downloads the validator couldn’t inspect')]).length, 1);
  assert.equal(failing([held(undefined)]).length, 1);
  assert.equal(failing([held('Uses a credential from the user’s machine')], []).length, 1, 'with no confirmations the same hold fails');
  assert.equal(failing([{ result: BLOCKS }, { result: STOPS }, { result: WARNING }, { result: NOTE }]).length, 2);
});

test('names that differ only by capitalization are named, though a case-insensitive disk cannot hold them', () => {
  assert.deepEqual(nameProblems(['README.md', 'docs', 'docs/a.md']), []);
  const p = nameProblems(['README.md', 'readme.md', 'Docs', 'docs']);
  assert.deepEqual(p.map((x) => x.problem), ['README.md and readme.md differ only by capitalization', 'Docs and docs differ only by capitalization']);
  assert.equal(nameProblems(['a<b', 'a|b', 'a?b', 'tab\tname', 'LPT1.txt', 'aux']).length, 6);
});

test('the front matter reader: what parses, and the kind of each value', () => {
  const kinds = (t) => Object.fromEntries(frontMatter(t).keys);
  assert.deepEqual(frontMatter('# no front matter\n'), { found: false });
  assert.deepEqual(kinds('---\na: text\nb: "q: x"\nc: \'it\'\'s\'\nd: |\n  block\ne:\n  - x\nf: [x]\ng: {x: 1}\nh:\ni: 3.5\nj: true\nk:\n  nested: 1\n---\n'), {
    a: 'string', b: 'string', c: 'string', d: 'string', e: 'list', f: 'list', g: 'map', h: 'null', i: 'number', j: 'boolean', k: 'map',
  });
  for (const bad of ['---\na: b: c\n---\n', '---\n  a: b\n---\n', '---\na: "open\n---\n', '---\na: [x\n---\n', '---\na: @x\n---\n', '---\njust text\n---\n', '---\na: x\n\tb: y\n---\n']) {
    assert.ok(frontMatter(bad).error, `${JSON.stringify(bad)} does not parse`);
  }
  assert.deepEqual(kinds('---\na: b\n---'), { a: 'string' });
});

test('the launcher reader finds each launcher and its package', () => {
  const problems = (cmd) => launchers(shellWords(cmd)).map((l) => [l.launcher, Boolean(l.problem)]);
  assert.deepEqual(problems('npx -y a@1.2.3 && uvx b && pnpm dlx c@2.0.0 | yarn dlx d && pipx run e==1.0 && uv run --frozen x'), [
    ['npx', false], ['uvx', true], ['pnpm dlx', false], ['yarn dlx', true], ['pipx run', false], ['uv run', false],
  ]);
  assert.deepEqual(problems('node "${CLAUDE_PLUGIN_ROOT}/x.mjs"'), []);
  assert.deepEqual(shellWords('node "${CLAUDE_PLUGIN_ROOT}"/a b\\ c \'d e\'&&f'), ['node', '${CLAUDE_PLUGIN_ROOT}/a', 'b c', 'd e', '&&', 'f']);
});

test('file kinds: complete images and fonts, text, SVG, and the rest', () => {
  assert.equal(classify(png()), 'image');
  assert.equal(classify(png().subarray(0, 40)), 'incomplete');
  assert.equal(classify(jpeg()), 'image');
  assert.equal(classify(gif()), 'image');
  assert.equal(classify(webp()), 'image');
  assert.equal(classify(woff2()), 'font');
  assert.equal(classify(ico()), 'binary');
  assert.equal(classify(pdf()), 'binary');
  assert.equal(classify(Buffer.from('<svg/>\n'), 'a.svg'), 'image');
  assert.equal(classify(Buffer.from('plain text\n'), 'a.txt'), 'text');
  assert.equal(classify(Buffer.from([0xff, 0xfe, 0x41, 0x00])), 'binary');
  assert.deepEqual(attributeProblems('# x\n*.md export-ignore\n"a b" filter=lfs\n* -export-subst !filter\n', { filter: false }).map((x) => x.attr), ['export-ignore']);
});

test('a bad argument exits 2', () => {
  const none = spawnSync(process.execPath, [TOOL], { encoding: 'utf8', env: ENV });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /^usage: node tools\/plugin-checklist\.mjs <plugin folder>/);
  const missing = spawnSync(process.execPath, [TOOL, path.join(BASE, 'no-such-folder')], { encoding: 'utf8', env: ENV });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /is not a folder/);
});
