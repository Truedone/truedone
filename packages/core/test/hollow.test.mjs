import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { analyse } from '../src/analyse.mjs';

const dir = 'packages/core/test/fixtures/hollow/';
const names = [
  'commented_out',
  'pytest_skip_call',
  'constant_assertion',
  'node_assert_ok',
  'after_return',
  'dead_branch',
  'swallowed_catch',
  'mocha_this_skip',
  'node_t_skip',
  'control_skip',
  'control_weakened',
  'control_skip_option',
  'control_describe_skip',
];

for (const name of names) {
  test(`${name} is tampered`, () => {
    const f = JSON.parse(fs.readFileSync(`${dir}${name}.json`, 'utf8'));
    const got = analyse({
      files: f.files,
      pr: { title: '', body: '', author: { login: 'a', type: 'User' } },
      releases: [],
    });
    assert.equal(got.verdict, 'tampered');
    assert.ok(f.files.some((file) => /^src\//.test(file.path)));
  });
}
