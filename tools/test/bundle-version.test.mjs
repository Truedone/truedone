// REL-P1-AC09 (#105): each bundle's red-green report carries packages/cli/package.json's version. core/run's report
// said truedone_version '0.0.0' whatever release wrote it; tools/bundle.mjs now writes the release's version into every
// bundle that carries the report writer. Every built bundle is read here; then a scratch copy of the repository with
// another version in packages/cli/package.json is bundled, and the check fails it against the real version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/cli/package.json'), 'utf8')).version;
// the entry bundles tools/bundle.mjs writes
const BUNDLES = ['packages/cli/truedone.mjs', 'packages/cli/plugin/hooks/stop.mjs', 'packages/action/dist/index.mjs'];

// The problems with one bundle's report version: [] when it reports version.
function reportVersion(text, version) {
  if (!text.includes('truedone_version: TRUEDONE_VERSION')) return text.includes('truedone_version') ? ['the report writes truedone_version from something other than TRUEDONE_VERSION'] : [];
  const lines = text.match(/^const TRUEDONE_VERSION = '[^']*';$/gm) || [];
  if (lines.length !== 1) return [`${lines.length} TRUEDONE_VERSION lines, not one`];
  return lines[0] === `const TRUEDONE_VERSION = '${version}';` ? [] : [`${lines[0]} where the release is ${version}`];
}

test('every bundle that writes red-green reports carries the release version, and the source says it too', () => {
  const built = BUNDLES.filter((b) => fs.existsSync(path.join(ROOT, b)));
  const writers = built.filter((b) => fs.readFileSync(path.join(ROOT, b), 'utf8').includes('truedone_version'));
  assert.ok(writers.includes('packages/cli/truedone.mjs'), `the CLI writes reports; writers: ${writers}`);
  for (const b of built) assert.deepEqual(reportVersion(fs.readFileSync(path.join(ROOT, b), 'utf8'), VERSION), [], b);
  const src = fs.readFileSync(path.join(ROOT, 'packages/core/run/run.mjs'), 'utf8');
  assert.deepEqual(reportVersion(src, VERSION), [], 'packages/core/run/run.mjs');
  assert.doesNotMatch(src, /truedone_version: '/, 'no literal version in the report');
});

test('a bundle built with another version fails the check', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-version-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const p of ['tools/bundle.mjs', 'packages/core', 'packages/cli/src', 'packages/cli/package.json', 'packages/web/core.mjs', 'docs/gates']) {
    if (fs.existsSync(path.join(ROOT, p))) fs.cpSync(path.join(ROOT, p), path.join(dir, p), { recursive: true });
  }
  const pkg = path.join(dir, 'packages/cli/package.json');
  fs.writeFileSync(pkg, JSON.stringify({ ...JSON.parse(fs.readFileSync(pkg, 'utf8')), version: '9.9.9' }));
  execFileSync(process.execPath, [path.join(dir, 'tools/bundle.mjs')], { cwd: dir, stdio: 'pipe' });
  const other = fs.readFileSync(path.join(dir, 'packages/cli/truedone.mjs'), 'utf8');
  assert.deepEqual(reportVersion(other, '9.9.9'), [], 'the scratch bundle reports its own version');
  assert.deepEqual(reportVersion(other, VERSION), [`const TRUEDONE_VERSION = '9.9.9'; where the release is ${VERSION}`]);
  assert.match(other, /^const VERSION = '9\.9\.9';$/m, 'and the CLI says it');
});
