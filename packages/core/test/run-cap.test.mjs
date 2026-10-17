import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { redGreen } from '../run/run.mjs';

const PASS = '<testsuite><testcase name="ok" classname="a.test.js" time="0.001"/></testsuite>';

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'td-run-'));
  const made = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
  assert.equal(made.status, 0);
  return dir;
}

function entry(name) {
  return {
    test: name,
    runner: 'node-test',
    cwd: '.',
    file: name,
    command: 'node --test --test-reporter=junit --test-reporter-destination={report} {files}',
    reporter: 'junit',
  };
}

function execWriting(command, cwd, seen) {
  seen.push(command);
  const report = command.match(/\.truedone-report-\S+/)[0];
  writeFileSync(path.join(cwd, report), PASS);
  return { code: 0, stdout: '', stderr: '', timedOut: false };
}

test('more than 50 changed tests are capped', async () => {
  const dir = repo();
  const seen = [];
  try {
    const names = Array.from({ length: 51 }, (_, i) => `t${String(i).padStart(2, '0')}.test.js`);
    const report = await redGreen({
      root: dir,
      tests: names.map(entry),
      files: [],
      base: 'base',
      head: 'head',
      exec: (command, { cwd }) => execWriting(command, cwd, seen),
    });
    assert.equal(report.truncated, true);
    assert.equal(report.schema, 'truedone.report/1');
    assert.equal(seen.length, 5);
    assert.equal(seen.some((command) => command.includes('t50.test.js')), false);
    assert.equal(seen[0].includes('t00.test.js'), true);
    assert.equal(seen[0].includes('t49.test.js'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('50 changed tests are not capped', async () => {
  const dir = repo();
  const seen = [];
  try {
    const names = Array.from({ length: 50 }, (_, i) => `t${String(i).padStart(2, '0')}.test.js`);
    const report = await redGreen({
      root: dir,
      tests: names.map(entry),
      files: [],
      base: 'base',
      head: 'head',
      exec: (command, { cwd }) => execWriting(command, cwd, seen),
    });
    assert.equal(report.truncated, false);
    assert.equal(seen.length, 5);
    assert.equal(seen[0].includes('t49.test.js'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('base runs see swapped source and head runs see the head bytes', async () => {
  const dir = repo();
  const seen = [];
  try {
    writeFileSync(path.join(dir, 'a.js'), 'head\n');
    const report = await redGreen({
      root: dir,
      tests: [entry('a.test.js')],
      files: [{ path: 'a.js', status: 'modified', base: 'base\n' }],
      base: 'b1',
      head: 'h1',
      exec: (command, { cwd }) => {
        seen.push(readFileSync(path.join(dir, 'a.js'), 'utf8'));
        return execWriting(command, cwd, []);
      },
    });
    assert.deepEqual(seen, ['base\n', 'base\n', 'head\n', 'head\n', 'head\n']);
    assert.equal(readFileSync(path.join(dir, 'a.js'), 'utf8'), 'head\n');
    assert.equal(report.base_sha, 'b1');
    assert.equal(report.head_sha, 'h1');
    assert.equal(report.tests.length, 1);
    assert.equal(report.tests[0].base.length, 2);
    assert.deepEqual(report.tests[0].head, ['pass', 'pass', 'pass']);
    assert.equal(report.could_not_run, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
