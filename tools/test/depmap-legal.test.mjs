// MAP-01 (#127): tools/build-legal.mjs generates packages/web/privacy.html and terms.html from docs/privacy.md and
// docs/terms.md, so the map names the pages as a required update of the notes. Before this, a privacy edit (APP-25) passed
// the map check with the site page stale, and only the web suite caught it. Each case copies the checkout's tracked files,
// as they stand in its working tree, into a scratch repository, commits that as the base, edits files in the working tree
// and runs the real checker against the base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
// MAP-02: git 2.54's commit starts "git maintenance run --auto --quiet --detach", which packs the scratch repository's
// objects in the background, still writing into .git while the case's finally deletes it (ENOTEMPTY). So no scratch call
// starts maintenance or an automatic gc.
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...a], { encoding: 'utf8' }).trim();

// MAP-02: the scratch repository is the checkout's tracked files as they stand in its working tree, so an uncommitted map
// or checker change is tested as it is. Untracked files stay out: a bare node --test at the root leaves BENCH-01's
// .run-count there, and a copy of it would be an unmapped file in every case.
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'depmap-legal-'));
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
  for (const f of files) {
    const from = path.join(root, f);
    if (!fs.existsSync(from)) continue;   // deleted in the working tree
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(from, path.join(dir, f));
  }
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
// MAP-02: the removal retries too, as a second guard (Node retries ENOTEMPTY and EBUSY with maxRetries).
const remove = (dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

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
    remove(s.dir);
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
    remove(s.dir);
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
    remove(s.dir);
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
    remove(s.dir);
  }
});
