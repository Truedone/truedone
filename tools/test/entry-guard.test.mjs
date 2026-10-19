// GUARD-01 (#115): six tools decided whether they were the entry point by comparing the path they were started by with
// their own module path. Through a symlinked directory (macOS's /tmp and /var are ones) the two differ, so the tool did
// nothing and exited 0, which passes any criterion that expects exit 0 (ci-gate, run as node /tmp/<dir>/ci-gate.mjs,
// printed nothing; through /private/tmp it reported the unknown task). Each tool now compares real paths. Here each
// starts from a scratch copy of itself and the files it reads, through a symlink to the scratch directory, with only
// node on PATH. Each invocation stops at a check of the tool's own before any git, network or write outside the scratch,
// and the tool must show it ran: its exit code and its own line. Imported through the same symlink, each still runs
// nothing. Started from a real directory whose name has a space, each runs too: ci-gate stripped "file://" from its
// URL by string replace, so the space stayed percent-encoded and it did nothing there as well.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('../../', import.meta.url);

// one scratch directory holding copies of the given repository files, plus files written for the case
function scratch(copies, written = {}, prefix = 'entry-guard-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  for (const f of copies) {
    const out = path.join(dir, f);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.cpSync(new URL(f, ROOT), out, { recursive: true });
  }
  for (const [f, text] of Object.entries(written)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  const link = path.join(dir, 'link');
  fs.symlinkSync(dir, link);
  return { dir, link };
}
const env = (dir, extra = {}) => ({ PATH: path.dirname(process.execPath), HOME: dir, TMPDIR: dir, ...extra });

// each tool: the files its run reads, the case's own files, its arguments and environment, and what shows it ran
const TOOLS = {
  'ci-gate': { copies: ['tools/ci-gate.mjs'], env: { PR_TITLE: '' }, status: 1, stderr: /^ci-gate: no task id from the PR title ""/ },
  gate6: { copies: ['tools/gate6.mjs'], status: 2, stderr: /^usage: node tools\/gate6\.mjs <release>/ },
  'readme-status': { copies: ['tools/readme-status.mjs'], written: { 'README.md': '# no status block here\n' }, status: 1, stderr: /^README\.md has no status block/ },
  'build-legal': { copies: ['tools/build-legal.mjs', 'packages/web/lib', 'docs/terms.md'], written: { 'docs/privacy.md': '### x\n' }, status: 1, stderr: /^build-legal: docs\/privacy\.md:1: unknown markdown/ },
  'mirror-action': { copies: ['tools/mirror-action.mjs', 'packages/action/action.yml', 'packages/action/dist/index.mjs', 'packages/action/README.md', 'LICENSE', 'NOTICE'], args: ['--tree'], cwdLink: true, status: 0, stdout: /\S/ },
  'check-browser': { copies: ['tools/check-browser.mjs'], status: 1, stderr: /^packages\/web\/core\.mjs is missing/ },
};

for (const [tool, c] of Object.entries(TOOLS)) {
  test(`${tool}, started from a directory with a space in its name, runs`, () => {
    const { dir } = scratch(c.copies, c.written, 'entry guard ');
    try {
      assert.match(dir, / /);
      const childEnv = env(dir, c.env);
      if (tool === 'mirror-action') {
        assert.deepEqual(c.args, ['--tree']);
        assert.equal(childEnv.MIRROR_TOKEN, undefined, 'no MIRROR_TOKEN in the child');
      }
      const r = spawnSync(process.execPath, [path.join(dir, `tools/${tool}.mjs`), ...(c.args ?? [])], {
        cwd: dir, encoding: 'utf8', env: childEnv, timeout: 60000,
      });
      assert.equal(r.status, c.status, `exit ${r.status}; stdout ${JSON.stringify(r.stdout)}; stderr ${JSON.stringify(r.stderr)}`);
      if (c.stderr) assert.match(r.stderr, c.stderr);
      if (c.stdout) assert.match(r.stdout, c.stdout);
      if (tool === 'mirror-action') fs.rmSync(r.stdout.trim(), { recursive: true, force: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`${tool}, started through a symlinked directory, runs`, () => {
    const { dir, link } = scratch(c.copies, c.written);
    try {
      const childEnv = env(dir, c.env);
      if (tool === 'mirror-action') {
        // --tree builds the mirror and stops before pushMirror; with no MIRROR_TOKEN a mistake cannot push either
        assert.deepEqual(c.args, ['--tree']);
        assert.equal(childEnv.MIRROR_TOKEN, undefined, 'no MIRROR_TOKEN in the child');
      }
      const r = spawnSync(process.execPath, [path.join(link, `tools/${tool}.mjs`), ...(c.args ?? [])], {
        cwd: c.cwdLink ? link : dir, encoding: 'utf8', env: childEnv, timeout: 60000,
      });
      assert.equal(r.status, c.status, `exit ${r.status}; stdout ${JSON.stringify(r.stdout)}; stderr ${JSON.stringify(r.stderr)}`);
      if (c.stderr) assert.match(r.stderr, c.stderr);
      if (c.stdout) assert.match(r.stdout, c.stdout);
      if (tool === 'mirror-action') {
        // the printed directory is the mirror's tree: the four files, then it is removed
        const tree = r.stdout.trim();
        try {
          for (const f of ['action.yml', 'dist/index.mjs', 'README.md', 'LICENSE']) assert.ok(fs.existsSync(path.join(tree, f)), `${f} in the mirror`);
        } finally {
          fs.rmSync(tree, { recursive: true, force: true });
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`${tool}, imported through a symlinked directory, runs nothing`, () => {
    const { dir, link } = scratch(c.copies, c.written);
    try {
      const url = new URL(`file://${path.join(link, `tools/${tool}.mjs`)}`).href;
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)});`], {
        cwd: c.cwdLink ? link : dir, encoding: 'utf8', env: env(dir, c.env), timeout: 60000,
      });
      assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''], 'importing it runs nothing');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
