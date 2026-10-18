// MAP-01 (#127): tools/build-legal.mjs generates packages/web/privacy.html and terms.html from docs/privacy.md and
// docs/terms.md, so the map names the pages as a required update of the notes. Before this, a privacy edit (APP-25) passed
// the map check with the site page stale, and only the web suite caught it. Each case copies the committed tree into a
// scratch repository, with this checkout's map and checker over it, commits that as the base, edits files in the working
// tree and runs the real checker against the base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'depmap-legal-'));
  const tree = execFileSync('git', ['-C', root, 'archive', '--format=tar', 'HEAD'], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', dir], { input: tree });
  for (const f of ['docs/DEPENDENCY-MAP.md', 'tools/depmap-check.mjs']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return { dir, base: git(dir, 'rev-parse', 'HEAD') };
}

function check({ dir, base }) {
  const r = spawnSync(process.execPath, [path.join(dir, 'tools/depmap-check.mjs'), '--base', base], { cwd: dir, encoding: 'utf8' });
  return { status: r.status, problems: JSON.parse(r.stdout.trim().split('\n').pop()).problems };
}

const touch = (dir, f, line) => fs.appendFileSync(path.join(dir, f), line);

test('a change to docs/privacy.md alone fails the map check, naming packages/web/privacy.html', () => {
  const s = scratch();
  try {
    touch(s.dir, 'docs/privacy.md', '\nA new sentence.\n');
    const { status, problems } = check(s);
    assert.equal(status, 1);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /must change in the same change/);
    assert.match(problems[0], /packages\/web\/privacy\.html/);
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('the same change with the generated page passes the map check', () => {
  const s = scratch();
  try {
    touch(s.dir, 'docs/privacy.md', '\nA new sentence.\n');
    touch(s.dir, 'packages/web/privacy.html', '\n<!-- regenerated -->\n');
    const { status, problems } = check(s);
    assert.deepEqual(problems, []);
    assert.equal(status, 0);
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('a change to docs/terms.md alone fails too, naming packages/web/terms.html', () => {
  const s = scratch();
  try {
    touch(s.dir, 'docs/terms.md', '\nA new sentence.\n');
    const { status, problems } = check(s);
    assert.equal(status, 1);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /packages\/web\/terms\.html/);
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('a change to SECURITY.md alone still needs no generated page', () => {
  const s = scratch();
  try {
    touch(s.dir, 'SECURITY.md', '\nA new sentence.\n');
    const { status, problems } = check(s);
    assert.deepEqual(problems, []);
    assert.equal(status, 0);
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});
