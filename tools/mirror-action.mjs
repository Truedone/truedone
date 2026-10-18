// Builds the action mirror: action.yml, dist/index.mjs, README.md and LICENSE.
// A direct run sends that tree to Truedone/truedone-action with MIRROR_TOKEN.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIRROR_REMOTE = 'https://github.com/Truedone/truedone-action.git';

const COPIES = [
  ['packages/action/action.yml', 'action.yml'],
  ['packages/action/dist/index.mjs', 'dist/index.mjs'],
  ['packages/action/README.md', 'README.md'],
  ['LICENSE', 'LICENSE'],
];

export function buildMirror(root, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const [from, to] of COPIES) {
    const src = path.join(root, from);
    const out = path.join(dest, to);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(src, out);
  }
  return dest;
}

export function listMirror(dest) {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) walk(abs);
      else out.push(path.relative(dest, abs).split(path.sep).join('/'));
    }
  };
  walk(dest);
  return out.sort();
}

function git(args, cwd, token) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const cmd = token
    ? ['-c', `http.extraheader=AUTHORIZATION: bearer ${token}`, ...args]
    : args;
  execFileSync('git', cmd, { cwd, env, stdio: 'pipe' });
}

export function pushMirror(dest, { tag, token, remote = MIRROR_REMOTE } = {}) {
  if (!token) throw new Error('MIRROR_TOKEN is required');
  if (!tag || tag.includes(' ') || tag.includes('..')) throw new Error('a release tag is required');
  if (remote !== MIRROR_REMOTE) throw new Error('the mirror remote is fixed');
  git(['init', '-q'], dest);
  git(['add', '-A'], dest);
  git(
    ['-c', 'user.name=mgillr', '-c', 'user.email=rgillespie83@icloud.com', 'commit', '-q', '-m', `Release ${tag}`],
    dest,
  );
  git(['tag', tag], dest);
  git(['push', remote, `refs/tags/${tag}`], dest, token);
}

function main() {
  const root = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-action-'));
  buildMirror(root, dest);
  if (process.argv.includes('--tree')) {
    process.stdout.write(`${dest}\n`);
    return;
  }
  const tag = process.env.GITHUB_REF_NAME || '';
  pushMirror(dest, { tag, token: process.env.MIRROR_TOKEN || '' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
