// npx truedone --run --docker (CLI-03; docs/spec.md, cli and plugin): the red-green step's commands run inside
// node:24-slim, or python:3.12-slim for pytest. One container per image is started with the checkout mounted at the
// same path, so the swap and restore on the host and every path a command or report names mean the same file inside.
// Each runner command then goes through docker exec, with the environment it is given (S4 when the PR is someone
// else's) minus the variables that describe the host rather than the run.
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const NODE_IMAGE = 'node:24-slim';
export const PYTHON_IMAGE = 'python:3.12-slim';
const HOST_ONLY = new Set(['PATH', 'HOME', 'PWD', 'OLDPWD', 'TMPDIR', 'SHELL', 'USER', 'LOGNAME', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TERM_SESSION_ID', '__CF_USER_TEXT_ENCODING', 'XPC_FLAGS', 'XPC_SERVICE_NAME', 'SSH_AUTH_SOCK']);

export const imageFor = (runner) => (runner === 'pytest' ? PYTHON_IMAGE : NODE_IMAGE);

// detect results grouped by the image their runner needs, node first; tests with no runner go with the node group, so
// the report still names them
export function groupsByImage(tests) {
  const by = new Map();
  for (const t of tests) {
    const image = imageFor(t.runner);
    if (!by.has(image)) by.set(image, []);
    by.get(image).push(t);
  }
  return [NODE_IMAGE, PYTHON_IMAGE].filter((i) => by.has(i)).map((image) => ({ image, tests: by.get(image) }));
}

export const containerEnv = (env) => Object.fromEntries(Object.entries(env ?? {}).filter(([k]) => !HOST_ONLY.has(k)));

// host is root with its symlinks resolved: Docker Desktop shares host paths by their real location (on macOS the
// temporary directory /var/folders is really /private/var/folders), while inside the container the checkout keeps
// the path the commands and reports name
export function dockerRunArgs({ image, root, host = root }) {
  return ['run', '--detach', '--rm', '--init', '--volume', `${host}:${root}`, '--workdir', root, image, 'sleep', 'infinity'];
}

export function dockerExecArgs({ id, cwd, env, command }) {
  const vars = Object.entries(containerEnv(env)).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
  return ['exec', '--workdir', cwd, ...vars, id, 'sh', '-c', command];
}

// spawn(cmd, args, opts) -> a promise of { code, stdout, stderr, timedOut }
export function spawnCollect(cmd, args, { cwd, env, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const p = nodeSpawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, timeoutMs) : null;
    p.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ code: null, stdout, stderr: stderr + String(e.message), timedOut }); });
    p.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

// -> { id, exec(command, { cwd, env, timeoutMs }), stop() }; exec is the hook core/run's redGreen runs commands through
export async function startContainer({ image, root, spawn = spawnCollect }) {
  const up = await spawn('docker', dockerRunArgs({ image, root, host: fs.realpathSync(root) }), {});
  const id = up.stdout.trim();
  if (up.code !== 0 || !id) throw new Error(`docker could not start ${image}: ${up.stderr.trim().replace(/\s+/g, ' ')}`);
  return {
    id,
    exec: (command, { cwd = root, env = {}, timeoutMs } = {}) => spawn('docker', dockerExecArgs({ id, cwd, env, command }), { timeoutMs }),
    stop: async () => { await spawn('docker', ['rm', '--force', id], {}); },
  };
}

// Docker on PATH, found without starting a process
export function dockerOnPath(env = process.env) {
  return String(env.PATH ?? '').split(path.delimiter).some((d) => {
    try { fs.accessSync(path.join(d, 'docker'), fs.constants.X_OK); return true; } catch { return false; }
  });
}

// One report from the reports of each image's run: the tests of all, could_not_run only when every run had one
export function mergeReports(reports) {
  if (reports.length === 1) return reports[0];
  const [first] = reports;
  return {
    ...first,
    tests: reports.flatMap((r) => r.tests ?? []),
    could_not_run: reports.every((r) => r.could_not_run) ? first.could_not_run : null,
    truncated: reports.some((r) => r.truncated),
  };
}
