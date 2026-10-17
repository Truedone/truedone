// CLI-03-AC04: --docker runs red-green in the specified image: node:24-slim for vitest, jest, mocha and node --test,
// python:3.12-slim for pytest. The commands are checked as data, then run for real: this test needs Docker, and when
// Docker cannot be reached it fails and says so; it never passes without having run a container.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { imageFor, groupsByImage, dockerRunArgs, dockerExecArgs, startContainer, spawnCollect, NODE_IMAGE, PYTHON_IMAGE } from '../src/docker.mjs';
import { run, repo, sh, write, report } from './lib/run-fakes.mjs';

// stored as .txt: node --test's default patterns take every .mjs under a test/ directory, so as .mjs a bare node --test
// would run it on the host, where it fails; the test below writes it into the container's checkout as a .mjs
const IN_CONTAINER = fileURLToPath(new URL('./fixtures/docker/in-container.test.mjs.txt', import.meta.url));
const t1 = (runner, file = 'test/a.test.mjs') => ({ test: file, runner, cwd: '.', file, command: '', reporter: '' });

test('the image follows the runner: node:24-slim for the JavaScript runners, python:3.12-slim for pytest', () => {
  for (const r of ['vitest', 'jest', 'mocha', 'node-test']) assert.equal(imageFor(r), NODE_IMAGE, r);
  assert.equal(imageFor('pytest'), PYTHON_IMAGE);
  assert.deepEqual([NODE_IMAGE, PYTHON_IMAGE], ['node:24-slim', 'python:3.12-slim']);
  const g = groupsByImage([t1('pytest', 'tests/test_a.py'), t1('jest'), t1('vitest', 'b.test.ts')]);
  assert.deepEqual(g.map((x) => [x.image, x.tests.map((y) => y.test)]), [[NODE_IMAGE, ['test/a.test.mjs', 'b.test.ts']], [PYTHON_IMAGE, ['tests/test_a.py']]]);
});

test('the container mounts the checkout at its own path and is removed when stopped; commands run there by docker exec', () => {
  assert.deepEqual(dockerRunArgs({ image: NODE_IMAGE, root: '/w/repo' }), ['run', '--detach', '--rm', '--init', '--volume', '/w/repo:/w/repo', '--workdir', '/w/repo', NODE_IMAGE, 'sleep', 'infinity']);
  const e = dockerExecArgs({ id: 'c1', cwd: '/w/repo/pkg', env: { CI: '1', PATH: '/usr/local/bin', HOME: '/Users/me' }, command: 'node --test a.test.mjs' });
  assert.deepEqual(e, ['exec', '--workdir', '/w/repo/pkg', '--env', 'CI=1', 'c1', 'sh', '-c', 'node --test a.test.mjs'], 'the host PATH and HOME stay out');
});

test('--run --docker starts one container per image, runs red-green through it, and removes it', async (t) => {
  const d = repo(t);
  const docker = [];
  const spawn = async (cmd, args) => { docker.push([cmd, ...args]); return { code: 0, stdout: args[0] === 'run' ? 'cid123\n' : 'ok', stderr: '' }; };
  const r = await run(['--run', '--docker'], { cwd: d, spawn, redGreen: async (o) => { await o.exec('node --test test/add.test.mjs', { cwd: o.root, env: o.env }); return report(); } });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(docker.map((x) => x[1]), ['run', 'exec', 'rm']);
  assert.ok(docker[0].includes(NODE_IMAGE));
  assert.deepEqual(docker[1].slice(-4), ['cid123', 'sh', '-c', 'node --test test/add.test.mjs']);
  assert.deepEqual(docker[2], ['docker', 'rm', '--force', 'cid123']);
});

test('in Docker, a node --test run happens inside node:24-slim on Linux, and python:3.12-slim has Python 3.12', async (t) => {
  const info = await spawnCollect('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 60000 });
  assert.equal(info.code, 0, `Docker is not available, so --docker cannot be checked here: ${info.stderr.trim() || 'docker info failed'}`);
  // Docker Desktop mounts only the host paths it shares, and the system temporary directory may not be one of them:
  // the checkout for this run sits beside this test file, under the repository
  const d = repo(t, fileURLToPath(new URL('./', import.meta.url)));
  write(d, 'test/in-container.test.mjs', fs.readFileSync(IN_CONTAINER, 'utf8'));
  sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'a test for the container');
  let ran;
  const r = await run(['--run', '--docker'], { cwd: d, redGreen: async (o) => { ran = await o.exec('node --test test/in-container.test.mjs', { cwd: o.root, timeoutMs: 600000 }); return report(); } });
  assert.equal(r.code, 0, r.err);
  assert.equal(ran.code, 0, `node --test in the container: ${ran.stdout}${ran.stderr}`);
  assert.match(ran.stdout, /^\S+ pass 1$/m, 'one test passed in the container (Node 24 prints the spec reporter, "ℹ pass 1")');
  assert.match(ran.stdout, /^\S+ fail 0$/m);

  const c = await startContainer({ image: PYTHON_IMAGE, root: d });
  try {
    const py = await c.exec('python3 -c "import platform, sys; print(platform.system(), *sys.version_info[:2])"', { timeoutMs: 600000 });
    assert.equal(py.code, 0, py.stderr);
    assert.equal(py.stdout.trim(), 'Linux 3 12');
  } finally { await c.stop(); }
  const left = await spawnCollect('docker', ['ps', '--all', '--quiet', '--filter', `id=${c.id}`], {});
  assert.equal(left.stdout.trim(), '', 'the container is gone after stop');
});
