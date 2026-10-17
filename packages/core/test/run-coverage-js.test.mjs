import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { redGreen } from '../run/run.mjs';

test('JavaScript coverage of a changed line sets condition lines', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'td-cov-js-'));
  try {
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src/add.js'), 'export function add(a, b) {\n  return (a + b);\n}\n');
    writeFileSync(path.join(root, 'add.test.js'), `import test from 'node:test';
import assert from 'node:assert/strict';
import { add } from './src/add.js';
test('adds', () => { assert.equal(add(1, 2), 3); });
`);
    const made = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
    assert.equal(made.status, 0);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const report = await redGreen({
      root,
      tests: [{
        test: 'add.test.js',
        runner: 'node-test',
        cwd: '.',
        file: 'add.test.js',
        command: 'node --test --test-reporter=junit --test-reporter-destination={report} {files}',
        reporter: 'junit',
      }],
      files: [{
        path: 'src/add.js',
        status: 'modified',
        patch: '@@ -1,3 +1,3 @@\n export function add(a, b) {\n-  return a + b;\n+  return (a + b);\n }\n',
      }],
      base: 'base',
      head: 'head',
      env,
    });
    const adds = report.tests.filter((item) => item.name === 'adds');
    assert.equal(adds.length, 1, JSON.stringify(report.tests.map((item) => [item.file, item.name, item.condition])));
    assert.equal(adds[0].condition, 'lines', JSON.stringify(report.tests.map((item) => [item.file, item.name, item.condition])));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
