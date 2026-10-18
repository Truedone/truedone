// README-03-AC01: README.md's "Ways to use it" Status column, and the line above the table, are written by
// tools/readme-status.mjs from packages/web/lib/release.mjs, the release state the site reads: the site Live, each
// released surface Released, every other Not released yet. Flipping one surface in a scratch copy of release.mjs
// changes only its row and the line above; the committed README is what the generator writes; --check fails on a hand
// edit, or on a release.mjs the README was not regenerated for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ways, readReleased, run, BEGIN, END, WAYS_BEGIN, WAYS_END } from '../readme-status.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const RELEASE = fs.readFileSync(path.join(ROOT, 'packages/web/lib/release.mjs'), 'utf8');
const block = (readme) => readme.slice(readme.indexOf(WAYS_BEGIN) + WAYS_BEGIN.length, readme.indexOf(WAYS_END));
// the rows' surface and status cells, and the line above the table
const rows = (b) => b.split('\n').filter((l) => l.startsWith('| ')).slice(1).map((l) => { const c = l.slice(2, -2).split(' | '); return [c[0].split(' ')[0], c[2]]; });
const lead = (b) => b.split('\n').find((l) => l.trim() && !l.startsWith('|'));
const SURFACES = ['[truedone.pages.dev](https://truedone.pages.dev)', '`npx', 'Claude', 'GitHub', 'GitHub'];

test('the Status column comes from release.mjs: the site Live, the four surfaces Not released yet', () => {
  assert.deepEqual(readReleased(RELEASE), { cli: false, action: false, app: false, plugin: false });
  const b = ways(block(README), readReleased(RELEASE));
  assert.deepEqual(rows(b).map(([, s]) => s), ['Live', 'Not released yet', 'Not released yet', 'Not released yet', 'Not released yet']);
  assert.deepEqual(rows(b).map(([s]) => s), SURFACES);
  assert.equal(lead(b), "The site is live: truedone.pages.dev checks any public pull request now. The command line, the plugin, the App and the action come with the first release, planned in [docs/spec.md](docs/spec.md), each after its release's gates pass.");
});

test('the committed README is what the generator writes from release.mjs', () => {
  assert.equal(block(README), ways(block(README), readReleased(RELEASE)));
});

for (const [key, row] of [['cli', 1], ['plugin', 2], ['app', 3], ['action', 4]]) {
  test(`flipping ${key} in a scratch copy of release.mjs changes only its row and the line above`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-ways-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const copy = path.join(dir, 'release.mjs');
    fs.writeFileSync(copy, RELEASE.replace(`${key}: false`, `${key}: true`));
    const before = ways(block(README), readReleased(RELEASE));
    const after = ways(block(README), readReleased(fs.readFileSync(copy, 'utf8')));
    const changed = rows(after).map(([, s], i) => (s === rows(before)[i][1] ? null : [i, s])).filter(Boolean);
    assert.deepEqual(changed, [[row, 'Released']]);
    assert.notEqual(lead(after), lead(before));
    assert.match(lead(after), /is released\./);
  });
}

test('a row that is not a surface, a surface with no row, or a release.mjs that is not a plain literal is an error', () => {
  const b = block(README);
  assert.throws(() => ways(b.replace('| GitHub Action |', '| Some Action |'), readReleased(RELEASE)), /is not one of the surfaces/);
  assert.throws(() => ways(b.split('\n').filter((l) => !l.startsWith('| Claude Code plugin')).join('\n'), readReleased(RELEASE)), /no row for plugin/);
  assert.throws(() => readReleased(RELEASE.replace(/export const RELEASED = .*;/, 'export const RELEASED = make();')), /no plain RELEASED literal/);
  assert.throws(() => readReleased(RELEASE.replace('cli: false', 'cli: !0')), /not <surface>: true or false/);
});

// a scratch repository with a status block and the committed ways block, for run()
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
test('--check passes on what the script wrote, and fails on a hand-edited cell or a release.mjs flipped without a rewrite', (t) => {
  for (const k of ['log', 'error']) t.mock.method(console, k, () => {});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-ways-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', a, { cwd: dir, env: ENV, encoding: 'utf8' }).trim();
  const write = (p, s) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), s); };
  git('init', '-q', '-b', 'main');
  write('proofline.json', JSON.stringify({ tasks: [{ id: 'WEB-01' }] }));
  write('packages/web/lib/release.mjs', RELEASE);
  write('README.md', `# x\n\n${WAYS_BEGIN}${block(README).replace(/Live \|/, 'Coming soon |')}${WAYS_END}\n\n## Status\n\n${BEGIN}\n${END}\n`);
  git('add', '-A'); git('commit', '-q', '-m', 'contract: the tasks');
  const readme = () => fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  assert.equal(run(['--at', 'main'], dir), 0);
  assert.equal(block(readme()), ways(block(README), readReleased(RELEASE)), 'the plain run writes the ways block');
  assert.equal(run(['--check'], dir), 0);
  const good = readme();
  fs.writeFileSync(path.join(dir, 'README.md'), good.replace('| Not released yet |', '| Released |'));
  assert.equal(run(['--check'], dir), 1, 'a hand-edited Status cell');
  fs.writeFileSync(path.join(dir, 'README.md'), good);
  write('packages/web/lib/release.mjs', RELEASE.replace('app: false', 'app: true'));
  assert.equal(run(['--check'], dir), 1, 'release.mjs flipped and the README not rewritten');
  assert.equal(run(['--at', 'main'], dir), 0);
  assert.equal(run(['--check'], dir), 0, 'rewritten, it passes again');
  assert.match(readme(), /\| GitHub App \| [^|]+ \| Released \|/);
});
