import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { conditionsFor, coverageEnv } from '../run/coverage.mjs';
import { spawn } from 'node:child_process';

test('Python coverage of a changed line sets condition lines', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'td-cov-py-'));
  try {
    writeFileSync(path.join(root, 'add.py'), 'def add(a, b):\n    return (a + b)\n');
    writeFileSync(path.join(root, 'test_add.py'), 'from add import add\n\ndef test_add():\n    assert add(1, 2) == 3\n');
    writeFileSync(path.join(root, 'pytest.ini'), '[pytest]\n');
    const cov = coverageEnv([{ path: 'add.py' }]);
    try {
      const code = await new Promise((resolve) => {
        const child = spawn('python3', ['-m', 'pytest', 'test_add.py'], {
          cwd: root,
          env: { ...process.env, ...cov.env },
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('close', (status) => resolve({ status, stderr }));
      });
      assert.equal(code.status, 0, code.stderr);
      const info = conditionsFor({
        root,
        cov,
        files: [{
          path: 'add.py',
          patch: '@@ -1,2 +1,2 @@\n def add(a, b):\n-    return a + b\n+    return (a + b)\n',
        }],
        tests: [{ test: 'test_add.py', file: 'test_add.py' }],
      });
      assert.equal(info.byPath.get('test_add.py'), 'lines');
    } finally {
      cov.cleanup();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
