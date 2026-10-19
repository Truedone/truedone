// REL-P1-AC01: the release check on the command line's tarball. Tarballs are built here in npm pack's layout (ustar,
// gzipped, every path under package/): a clean one passes; an extra file, a missing file, a wrong version, a file over
// 1 MB and a credential-shaped string each fail with their own reason. The source's VERSION, the bundle's VERSION line
// and packages/cli/package.json say one version, and the CLI prints it as "truedone <version> (preview)".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { readTarball, checkTarball, writeSection, installedPlugin, installedLine, stopCommand, FILES, MAX_BYTES } from '../release-preview.mjs';
import { VERSION } from '../../packages/cli/src/version.mjs';

const ROOT = new URL('../../', import.meta.url);
const PKG = JSON.parse(fs.readFileSync(new URL('packages/cli/package.json', ROOT), 'utf8'));

// One ustar record per file, then the two zero blocks, gzipped.
function tarball(files) {
  const blocks = [];
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8');
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write('0', 156);
    h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
const clean = (over = {}) => {
  const files = new Map([
    ['package/package.json', JSON.stringify({ name: 'truedone', version: '0.1.0' })],
    ['package/truedone.mjs', "#!/usr/bin/env node\nconsole.log('truedone');\n"],
    ['package/README.md', '# truedone\n'],
    ['package/LICENSE', 'Apache License\n'],
  ]);
  for (const [k, v] of Object.entries(over)) v === null ? files.delete(k) : files.set(k, v);
  return readTarball(tarball([...files]));
};
const check = (entries) => checkTarball(entries, { version: '0.1.0' });

test('a clean tarball, the four files at version 0.1.0, passes', () => {
  const entries = clean();
  assert.deepEqual(entries.map((e) => e.name).sort(), FILES);
  assert.deepEqual(check(entries), []);
});

test('an extra file fails, and so does a missing one', () => {
  assert.deepEqual(check(clean({ 'package/.npmrc': 'x' })), ['files that are not published: package/.npmrc']);
  assert.deepEqual(check(clean({ 'package/LICENSE': null })), ['files missing: package/LICENSE']);
});

test('a wrong version fails', () => {
  assert.deepEqual(check(clean({ 'package/package.json': JSON.stringify({ name: 'truedone', version: '0.0.0' }) })), ['package.json says version 0.0.0, not 0.1.0']);
});

test('a file over 1 MB fails', () => {
  const big = Buffer.alloc(MAX_BYTES + 1, 0x61);
  assert.deepEqual(check(clean({ 'package/truedone.mjs': big })), [`package/truedone.mjs is ${MAX_BYTES + 1} bytes, over ${MAX_BYTES}`]);
});

test('a credential-shaped string fails, each kind named', () => {
  // built here so the repository itself holds no credential-shaped string
  const npmToken = `npm${'_'}${'A1'.repeat(18)}`;
  const ghToken = `ghp${'_'}${'b2'.repeat(18)}`;
  const key = `-----BEGIN RSA ${'PRIVATE'} KEY-----`;
  assert.deepEqual(check(clean({ 'package/truedone.mjs': `const t = '${npmToken}';\n` })), ['package/truedone.mjs holds an npm token']);
  assert.deepEqual(check(clean({ 'package/README.md': `token ${ghToken}\n` })), ['package/README.md holds a GitHub token']);
  assert.deepEqual(check(clean({ 'package/LICENSE': `${key}\nMIIE\n` })), ['package/LICENSE holds a private key']);
});

test('the source, the bundle and package.json say one version, and the CLI prints it as the preview', () => {
  assert.equal(VERSION, PKG.version);
  const bundle = fs.readFileSync(new URL('packages/cli/truedone.mjs', ROOT), 'utf8');
  assert.deepEqual(bundle.match(/^const VERSION = '[^']*';$/gm), [`const VERSION = '${PKG.version}';`]);
  const out = execFileSync(process.execPath, [new URL('packages/cli/truedone.mjs', ROOT).pathname, '--version'], { encoding: 'utf8' });
  assert.equal(out, `truedone ${PKG.version} (preview)\n`);
});

test('the notes keep every other section when the command line section is rewritten', () => {
  const before = '# The 0.1.0 preview\n\n## The action\n\nkept\n\n## The command line\n\nold\n\n## The plugin\n\nalso kept\n';
  const after = writeSection(before, '## The command line', 'new');
  assert.equal(after, '# The 0.1.0 preview\n\n## The action\n\nkept\n\n## The command line\n\nnew\n\n## The plugin\n\nalso kept\n');
  assert.equal(writeSection('# The 0.1.0 preview\n', '## The command line', 'first'), '# The 0.1.0 preview\n\n## The command line\n\nfirst\n');
});

// REL-P3: the installed copy and its Stop hook, read as the claude CLI writes them (installed_plugins.json version 2,
// the plugin's hooks/hooks.json), measured with Claude Code 2.1.302 in a scratch HOME.
test('the installed plugin and its Stop hook command are read from what the claude CLI writes', () => {
  const installed = { version: 2, plugins: { 'truedone@truedone': [{ scope: 'user', installPath: '/h/.claude/plugins/cache/truedone/truedone/0.1.0', version: '0.1.0', gitCommitSha: 'e8cc21c959792a585609aad2fe0b9851d04660b6' }] } };
  assert.equal(installedPlugin(installed).installPath, '/h/.claude/plugins/cache/truedone/truedone/0.1.0');
  assert.equal(installedPlugin({ version: 2, plugins: {} }), null);
  const hooks = JSON.parse(fs.readFileSync(new URL('packages/cli/plugin/hooks/hooks.json', ROOT), 'utf8'));
  assert.equal(stopCommand(hooks), 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"');
  assert.equal(stopCommand({ hooks: { PreToolUse: [] } }), null);
});

test("the plugin's manifest names the site as its homepage and the release as its version", () => {
  const m = JSON.parse(fs.readFileSync(new URL('packages/cli/plugin/.claude-plugin/plugin.json', ROOT), 'utf8'));
  assert.equal(m.homepage, 'https://truedone.pages.dev');
  assert.equal(m.version, PKG.version);
});

// REL-P3 (the lead's 4582): only a passing run writes its section. A failed run once rewrote
// docs/releases/preview-0.1.0.md with its FAIL lines, which dirtied the tree being verified. Each command runs here from
// a scratch copy of the script and the files it reads, with only node on PATH, so npm (cli) or the claude CLI (plugin)
// is missing and the run fails at its first step: exit 1, and the notes are byte for byte what they were. The script is
// run through a symlink to the scratch copy: through one, it once did nothing and exited 0.
for (const command of [['cli'], ['plugin', '--local', '.']]) {
  test(`a failing ${command[0]} run exits 1 and leaves the release notes unchanged`, () => {
    const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-preview-fail-')));
    try {
      for (const f of ['tools/release-preview.mjs', 'docs/releases/preview-0.1.0.md', 'packages/cli/package.json']) {
        fs.mkdirSync(path.dirname(path.join(scratch, f)), { recursive: true });
        fs.copyFileSync(new URL(f, ROOT), path.join(scratch, f));
      }
      const notes = path.join(scratch, 'docs/releases/preview-0.1.0.md');
      const before = fs.readFileSync(notes);
      const link = path.join(scratch, 'link');
      fs.symlinkSync(scratch, link);
      const r = spawnSync(process.execPath, [path.join(link, 'tools/release-preview.mjs'), ...command], {
        cwd: scratch, encoding: 'utf8', env: { PATH: path.dirname(process.execPath), HOME: scratch, TMPDIR: scratch },
      });
      assert.equal(r.status, 1, `exit ${r.status}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /result: FAIL/);
      assert.ok(fs.readFileSync(notes).equals(before), 'the release notes are unchanged');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
}

// The plugin's notes line names where the copy came from, never the commit of main it was installed at: main moves with
// every landing, and a line holding the commit would make each passing run rewrite the notes it checks.
test("the installed line names the source and not the commit, so two passing runs write the same notes", () => {
  const home = '/h';
  const at = (gitCommitSha) => ({ version: '0.1.0', installPath: '/h/.claude/plugins/cache/truedone/truedone/0.1.0', gitCommitSha });
  const one = installedLine(at('d51594524929039cbde86e6ed1308cd877fa25df'), { local: null, source: 'Truedone/truedone', home });
  const two = installedLine(at('1869b96d97fb5ab9e8b118e5cc6839823a11d064'), { local: null, source: 'Truedone/truedone', home });
  assert.equal(one, 'installed: version 0.1.0, from Truedone/truedone on GitHub, at <scratch HOME>/.claude/plugins/cache/truedone/truedone/0.1.0');
  assert.equal(two, one);
  assert.doesNotMatch(one, /[0-9a-f]{40}/);
  assert.equal(installedLine(at(undefined), { local: '/clone', source: '/clone', home }), 'installed: version 0.1.0, from this clone, at <scratch HOME>/.claude/plugins/cache/truedone/truedone/0.1.0');
});
