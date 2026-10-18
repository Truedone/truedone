// REL-P1-AC01: the release check on the command line's tarball. Tarballs are built here in npm pack's layout (ustar,
// gzipped, every path under package/): a clean one passes; an extra file, a missing file, a wrong version, a file over
// 1 MB and a credential-shaped string each fail with their own reason. The source's VERSION, the bundle's VERSION line
// and packages/cli/package.json say one version, and the CLI prints it as "truedone <version> (preview)".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { readTarball, checkTarball, writeSection, FILES, MAX_BYTES } from '../release-preview.mjs';
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
