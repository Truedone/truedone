// TEST-01: git 2.54's commit starts "git maintenance run --auto --quiet --detach", which still writes into a temporary
// repository's .git while the test removes the directory, so the cleanup fails with ENOTEMPTY or EINVAL under load (MAP-02).
// Every test file and helper under packages/*/test and tools/test that runs git commit in a temporary directory turns
// maintenance off, with -c maintenance.auto=false -c gc.auto=0 on its git calls or the same keys in the GIT_CONFIG_*
// environment. The check is per file: a file that spawns git, commits and makes a temporary directory must name both
// settings. It reads the tracked files and any new ones, so a new test cannot slip in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const SELF = 'tools/test/git-maintenance.test.mjs';
const SPAWNS_GIT = /\b(?:execFileSync|execFile|spawnSync|spawn)\(\s*['"]git['"]|\b(?:execSync|exec)\(\s*[`'"]git\s/;
const COMMITS = /['"`]commit['"`]|\bgit\s+(?:-\S+\s+)*commit\b/;
const TEMP_DIR = /mkdtemp|tmpdir\(\)/;
const OFF = [
  /maintenance\.auto=false|GIT_CONFIG_KEY_\d+['"]?\s*:\s*['"]maintenance\.auto['"]/,
  /gc\.auto=0|GIT_CONFIG_KEY_\d+['"]?\s*:\s*['"]gc\.auto['"]/,
];
const leavesMaintenanceOn = (text) => SPAWNS_GIT.test(text) && COMMITS.test(text) && TEMP_DIR.test(text) && !OFF.every((re) => re.test(text));

function scanned() {
  const list = (...a) => execFileSync('git', ['-C', root, 'ls-files', ...a], { encoding: 'utf8' }).split('\n').filter(Boolean);
  return [...new Set([...list(), ...list('--others', '--exclude-standard')])]
    .filter((f) => /^(packages\/[^/]+\/test|tools\/test)\/.*\.[cm]?js$/.test(f) && f !== SELF && fs.existsSync(path.join(root, f)))
    .sort();
}

test('every file that commits in a temporary repository turns git maintenance off', () => {
  const left = scanned().filter((f) => leavesMaintenanceOn(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(left, [], `these commit in a temporary repository with git maintenance on:\n${left.join('\n')}`);
});

test('the scan reads the files the suites run, the helpers among them', () => {
  const files = scanned();
  assert.ok(files.length > 100, `${files.length} files scanned`);
  for (const f of ['packages/cli/test/cli.test.mjs', 'packages/cli/test/lib/run-fakes.mjs', 'tools/test/depmap-legal.test.mjs']) assert.ok(files.includes(f), f);
});

const tmp = "const d = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));\n";
for (const [name, text, on] of [
  ['a helper commit with no settings', `${tmp}const git = (...a) => execFileSync('git', a, { cwd: d });\ngit('commit', '-qm', 'base');`, true],
  ['a shell commit with no settings', `${tmp}execSync('git commit -qm base', { cwd: d });`, true],
  ['only maintenance.auto', `${tmp}execFileSync('git', ['-c', 'maintenance.auto=false', 'commit', '-qm', 'b']);`, true],
  ['only gc.auto', `${tmp}execFileSync('git', ['-c', 'gc.auto=0', 'commit', '-qm', 'b']);`, true],
  ['both -c settings', `${tmp}execFileSync('git', ['-c', 'maintenance.auto=false', '-c', 'gc.auto=0', 'commit', '-qm', 'b']);`, false],
  ['both keys in the GIT_CONFIG_* environment', `${tmp}const env = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'maintenance.auto', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'gc.auto', GIT_CONFIG_VALUE_1: '0' };\nexecFileSync('git', ['commit', '-qm', 'b'], { env });`, false],
  ['a commit outside any temporary directory', "execFileSync('git', ['commit', '-qm', 'b']);", false],
  ['a temporary repository that never commits', `${tmp}execFileSync('git', ['init', '-q'], { cwd: d });`, false],
]) {
  test(`the rule: ${name} ${on ? 'leaves maintenance on' : 'passes'}`, () => {
    assert.equal(leavesMaintenanceOn(text), on);
  });
}
