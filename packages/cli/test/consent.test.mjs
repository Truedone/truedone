// CLI-03-AC01 (PV-L03): on someone else's PR, --run executes nothing without a typed yes on a terminal or --yes. With
// no terminal and no --yes it exits 2 and clones nothing. It says once, before anything runs, that it will execute
// that PR's code, and offers --docker when Docker is on PATH. On the user's own branch it runs at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run, remote, repo, terminal, pipe, tmp } from './lib/run-fakes.mjs';
import { makeGit } from '../src/local.mjs';

// a makeGit that records every git command, so a test can tell that nothing was cloned or run
function spyGit(log) { return (cwd, env) => { const g = makeGit(cwd, env); return (args, o) => { log.push(args.join(' ')); return g(args, o); }; }; }

test('no terminal and no --yes: exit 2, nothing cloned, fetched or run', async (t) => {
  const { url } = remote(t);
  const gits = [];
  const r = await run(['octo/demo#7', '--run'], { stdin: pipe(), makeGit: spyGit(gits), cloneUrl: () => url, tmpdir: tmp(t) });
  assert.equal(r.code, 2);
  assert.deepEqual(gits, [], 'no git command ran');
  assert.ok(!r.names.includes('redGreen') && !r.names.includes('fetch'), r.names.join(','));
  assert.match(r.err, /will execute the code of octo\/demo#7 on this machine/);
  assert.match(r.err, /Nothing was executed/);
  assert.match(r.err, /--yes/);
});

test('a terminal answer other than yes: exit 2 and nothing runs', async (t) => {
  const { url } = remote(t);
  for (const answer of ['no', 'y', 'YES please', '']) {
    const gits = [];
    const stdin = terminal(answer);
    const r = await run(['octo/demo#7', '--run'], { stdin, makeGit: spyGit(gits), cloneUrl: () => url, tmpdir: tmp(t) });
    assert.equal(r.code, 2, answer);
    assert.ok(stdin.read, 'the answer was read');
    assert.deepEqual(gits, [], answer);
    assert.ok(!r.names.includes('redGreen'), answer);
  }
});

test('a typed yes on a terminal clones the PR into a temporary directory and runs red-green there', async (t) => {
  const { url, head } = remote(t);
  const gits = [];
  const parent = tmp(t);
  const r = await run(['octo/demo#7', '--run'], { stdin: terminal('yes'), makeGit: spyGit(gits), cloneUrl: () => url, tmpdir: parent });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err.match(/will execute the code/g).length, 1, 'said once');
  const rg = r.calls.find((c) => c[0] === 'redGreen')[1];
  assert.ok(rg.root.startsWith(path.join(parent, 'truedone-pr-')), rg.root);
  assert.equal(rg.head, head, 'the PR head was checked out');
  assert.deepEqual(rg.tests.map((x) => x.test), ['test/add.test.mjs']);
  assert.equal(gits.filter((g) => g.startsWith('clone ')).length, 1);
  assert.equal(fs.existsSync(rg.root), false, 'the temporary clone is removed afterwards');
});

test('--yes goes ahead with no terminal, and the notice still comes first', async (t) => {
  const { url } = remote(t);
  const r = await run(['octo/demo#7', '--run', '--yes'], { stdin: pipe(), cloneUrl: () => url, tmpdir: tmp(t) });
  assert.equal(r.code, 0, r.err);
  assert.ok(r.names.includes('redGreen'));
  assert.match(r.err, /will execute the code of octo\/demo#7/);
});

test('--docker is offered when Docker is on PATH, and not when it is not', async () => {
  const on = await run(['octo/demo#7', '--run'], { stdin: pipe(), dockerOnPath: () => true });
  assert.match(on.err, /Add --docker/);
  const off = await run(['octo/demo#7', '--run'], { stdin: pipe(), dockerOnPath: () => false });
  assert.doesNotMatch(off.err, /--docker/);
});

test('on the user\'s own branch --run runs at once: no question, no read of stdin', async (t) => {
  const d = repo(t);
  const stdin = pipe();
  const r = await run(['--run'], { cwd: d, stdin });
  assert.equal(r.code, 0, r.err);
  assert.equal(stdin.read, false);
  assert.doesNotMatch(r.err, /will execute/);
  assert.deepEqual(r.names.filter((n) => ['restorePending', 'analyse', 'redGreen', 'judge'].includes(n)), ['restorePending', 'analyse', 'redGreen', 'judge']);
});

test('--yes and --docker without --run are usage errors', async () => {
  for (const argv of [['--yes'], ['--docker'], ['octo/demo#7', '--yes']]) {
    const r = await run(argv);
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.err, /needs --run/);
  }
});
