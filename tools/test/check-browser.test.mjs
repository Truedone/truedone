import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the browser check answers the page and finishes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'td-fake-browser-'));
  const bin = path.join(dir, 'browser');
  writeFileSync(bin, `#!/bin/sh
url=""
for arg in "$@"; do
  case "$arg" in
    http://*) url=$arg ;;
  esac
done
curl -sf "$url" >/dev/null || exit 2
curl -sf "\${url%/}/core.mjs" >/dev/null || exit 3
printf '%s\\n' '<div id="v">no_evidence</div>'
`);
  chmodSync(bin, 0o755);
  const started = Date.now();
  const child = spawn(process.execPath, ['tools/check-browser.mjs'], {
    cwd: root,
    env: { ...process.env, CHROMIUM_BIN: bin },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  const elapsed = Date.now() - started;
  rmSync(dir, { recursive: true, force: true });
  assert.equal(code, 0, stderr);
  assert.equal(elapsed < 20000, true);
});
