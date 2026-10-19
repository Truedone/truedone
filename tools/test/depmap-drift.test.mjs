// MAP-02 (#135): docs/DEPENDENCY-MAP.md carries the map three times, as the Nodes table, the diagram and the json block, and
// tools/depmap-check.mjs read only the json block, so the other two could drift from it unseen. The check now derives each
// node's row (its paths, its required updates, its reviews and its status) and the diagram's update edges from the block,
// and fails naming the node when the committed table or diagram differs. Each case copies the checkout's tracked files into
// a scratch repository, commits them as the base, changes one form of the map and runs the real checker against the base.
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
const MAP = 'docs/DEPENDENCY-MAP.md';

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'depmap-drift-'));
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
  for (const f of files) {
    const from = path.join(root, f);
    if (!fs.existsSync(from)) continue;
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
const remove = (dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
// one change to the map's text, which must appear exactly once
function edit(dir, from, to) {
  const p = path.join(dir, MAP);
  const text = fs.readFileSync(p, 'utf8');
  assert.equal(text.split(from).length - 1, 1, `the map holds ${JSON.stringify(from)} once`);
  fs.writeFileSync(p, text.replace(from, to));
}
// the map change alone, so the one problem the check must report is the drift
function drifted(from, to) {
  const s = scratch();
  try {
    edit(s.dir, from, to);
    return check(s);
  } finally {
    remove(s.dir);
  }
}

test('the map as committed passes: its table and diagram agree with the json block', () => {
  const s = scratch();
  try {
    assert.deepEqual(check(s), { status: 0, problems: [] });
  } finally {
    remove(s.dir);
  }
});

const ROW = '| `readme` | the front page | `README.md` |   | `design` | live |';
for (const [what, to, node, said] of [
  ['names an update the json block does not', '| `readme` | the front page | `README.md` | `spec` | `design` | live |', 'readme', /must update "`spec`", where the json block has ""/],
  ['names a review the json block does not', '| `readme` | the front page | `README.md` |   | `design`, `spec` | live |', 'readme', /review "`design`, `spec`"/],
  ['names other paths', '| `readme` | the front page | `README.md`, `docs/**` |   | `design` | live |', 'readme', /paths "`README.md`, `docs\/\*\*`"/],
  ['says planned for a live node', '| `readme` | the front page | `README.md` |   | `design` | planned |', 'readme', /status "planned", where the json block has "live"/],
]) {
  test(`a table row that ${what} fails the check, naming the node`, () => {
    const { status, problems } = drifted(ROW, to);
    assert.equal(status, 1);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], new RegExp(`row for ${node} `));
    assert.match(problems[0], said);
  });
}

test('a table row for a node the json block does not have fails the check, naming it', () => {
  const { status, problems } = drifted(ROW, `${ROW}\n| \`ghost\` | not a node | \`ghost/**\` |   |   | live |`);
  assert.equal(status, 1);
  assert.deepEqual(problems, ['the Nodes table has a row for ghost, a node the json block does not have']);
});

test('a second row for one node fails the check, naming it', () => {
  const { status, problems } = drifted(ROW, `${ROW}\n${ROW}`);
  assert.equal(status, 1);
  assert.deepEqual(problems, ['the Nodes table has two rows for readme']);
});

test('the diagram drawing an update edge the json block does not have fails the check, naming the node', () => {
  const { status, problems } = drifted('  core ==>|update| bundles\n', '  core ==>|update| bundles\n  readme ==>|update| spec\n');
  assert.equal(status, 1);
  assert.deepEqual(problems, ['the diagram draws the update edge readme -> spec, which the json block does not have']);
});

test('an update the json block gains, with neither the table nor the diagram, fails the check twice, naming the node', () => {
  const { status, problems } = drifted('"readme": {"paths": ["README.md"], "update": []', '"readme": {"paths": ["README.md"], "update": ["spec"]');
  assert.equal(status, 1);
  assert.deepEqual(problems.sort(), [
    'the Nodes table row for readme has must update "", where the json block has "`spec`"',
    'the diagram does not draw the update edge readme -> spec',
  ]);
});
