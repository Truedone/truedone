// README-02: the Status section comes from the contract and main's first-parent history at one commit, says pre-release
// until a release record says "Decision: GO", and --check holds it to what the script writes for the commit it names.
// Every case runs the real git on a temporary repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run, BEGIN, END } from '../readme-status.mjs';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const TASKS = ['WEB-01', 'WEB-02', 'CLI-01', 'OPS-01', 'REL-W2', 'DEMO-01'];

// main: the contract, then WEB-01 through a pull request, a merge of a branch that names no task, and OPS-01 as a
// direct commit; CLI-01 has a commit on its own branch that never reaches main
function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-status-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', a, { cwd: dir, env: ENV, encoding: 'utf8' }).trim();
  const write = (p, s) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), s); };
  const commit = (m) => { git('add', '-A'); git('commit', '-q', '--allow-empty', '-m', m); };
  const merge = (branch, m) => { git('checkout', '-q', '-b', branch); write(`${branch}.txt`, branch); commit(m); git('checkout', '-q', 'main'); git('merge', '-q', '--no-ff', branch, '-m', `Merge pull request #${branch.length} from mgillr/${branch}`); };
  git('init', '-q', '-b', 'main');
  write('proofline.json', JSON.stringify({ tasks: TASKS.map((id) => ({ id })) }));
  write('README.md', `# x\n\n## Status\n\n${BEGIN}\n${END}\n\n## After\n`);
  commit('contract: the tasks');
  merge('web-01', 'I add the page.');
  merge('notes', 'WEB-02: notes that are not the task');
  write('ops.txt', 'o'); commit('OPS-01: the site');
  git('checkout', '-q', '-b', 'cli-01'); write('cli.txt', 'c'); commit('CLI-01: the command'); git('checkout', '-q', 'main');
  const readme = () => fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  return { dir, git, write, commit, merge, readme };
}
// run() with its console lines captured
function quiet(t) {
  const lines = [];
  for (const k of ['log', 'error']) t.mock.method(console, k, (...a) => lines.push(a.join(' ')));
  return lines;
}

test('the section counts the tasks a pull request merged or a direct commit landed on main, and nothing else', (t) => {
  quiet(t);
  const r = repo(t);
  assert.equal(run(['--at', 'main'], r.dir), 0);
  const s = r.readme();
  const sha = r.git('rev-parse', 'main').slice(0, 12);
  assert.match(s, new RegExp(`^At main ${sha} \\(\\d{4}-\\d\\d-\\d\\d\\), 2 of the 6 tasks in the signed contract`, 'm'));
  assert.match(s, /^- truedone\.pages\.dev: 1 of 2 \(WEB-01\)\.$/m);
  assert.match(s, /^- `npx truedone`: 0 of 1\.$/m);
  assert.match(s, /^- Releases: 0 of 1\.$/m);
  assert.match(s, /^- Repository, CI, deploys and docs: 1 of 2 \(OPS-01\)\.$/m);
  assert.match(s, /^truedone is pre-release: the npm package, the action, the plugin and the app have no published release, and the release decisions stay open until a record in docs\/releases says "Decision: GO"\.$/m);
  assert.ok(s.startsWith(`# x\n\n## Status\n\n${BEGIN}\n`) && s.endsWith(`${END}\n\n## After\n`), 'only the block between the markers changed');
  assert.doesNotMatch(s, /^Not built yet:/m);
});

test('--check passes on what the script wrote, and fails on a hand edit or a missing block', (t) => {
  quiet(t);
  const r = repo(t);
  run(['--at', 'main'], r.dir);
  assert.equal(run(['--check'], r.dir), 0);
  const good = r.readme();
  r.write('README.md', good.replace('1 of 2 (WEB-01)', '2 of 2 (WEB-01, WEB-02)'));
  assert.equal(run(['--check'], r.dir), 1);
  r.write('README.md', good.replace(BEGIN, ''));
  assert.equal(run(['--check'], r.dir), 1);
});

test('after main moves on, --check still passes for the commit the section names', (t) => {
  quiet(t);
  const r = repo(t);
  run(['--at', 'main'], r.dir);
  r.commit('docs: the status block');
  r.merge('web-02', 'I add sign-in.');
  assert.equal(run(['--check'], r.dir), 0);
  run(['--at', 'main'], r.dir);
  assert.match(r.readme(), /^- truedone\.pages\.dev: 2 of 2 \(WEB-01, WEB-02\)\.$/m);
});

test('--check fails when the named commit is not an ancestor of HEAD', (t) => {
  quiet(t);
  const r = repo(t);
  run(['--at', 'main'], r.dir);
  const block = r.readme();
  r.git('checkout', '-q', '-b', 'old', 'main~3');
  r.write('README.md', block);
  assert.equal(run(['--check'], r.dir), 1);
});

test('a release record that says "Decision: GO" ends the pre-release line, and "Decision: STOP" does not', (t) => {
  quiet(t);
  const r = repo(t);
  r.write('docs/releases/w2.md', 'Release w2\n\nDecision: STOP\n'); r.commit('REL-W2: stop');
  run(['--at', 'main'], r.dir);
  assert.match(r.readme(), /^truedone is pre-release:/m);
  r.write('docs/releases/w2.md', 'Release w2\n\nDecision: GO\n'); r.commit('docs: go');
  run(['--at', 'main'], r.dir);
  assert.match(r.readme(), /^Released: docs\/releases\/w2\.md says "Decision: GO"\.$/m);
  assert.doesNotMatch(r.readme(), /pre-release/);
});
