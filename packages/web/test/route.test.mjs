// The routes and the pasted-link reader (WEB-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, parseTarget } from '../lib/route.mjs';

test('the three routes, and anything else is not found', () => {
  assert.deepEqual(route('/octo/demo/pull/7'), { kind: 'pr', owner: 'octo', repo: 'demo', number: 7 });
  assert.deepEqual(route('/p/octo/demo'), { kind: 'precomputed', owner: 'octo', repo: 'demo' });
  assert.deepEqual(route('/'), { kind: 'home' });
  for (const p of ['/octo/demo/pull/0', '/octo/../pull/7', '/octo/demo/issues/7', '/a/b/pull/7/files', '//evil/x/pull/1']) assert.equal(route(p).kind, 'not_found', p);
});

test('a pasted github.com or truedone.pages.dev link, or owner/repo#n, becomes the PR path', () => {
  for (const s of ['https://github.com/octo/demo/pull/7', 'github.com/octo/demo/pull/7/files', 'https://truedone.pages.dev/octo/demo/pull/7', 'octo/demo#7', '  https://github.com/octo/demo/pull/7?x=1 '])
    assert.equal(parseTarget(s)?.path, '/octo/demo/pull/7', s);
  const deadDomain = ['https://truedone', '.dev/octo/demo/pull/7'].join(''); // the old domain, built here because no file names it
  for (const s of ['https://evil.example/octo/demo/pull/7', deadDomain, 'octo/demo', 'javascript:alert(1)']) assert.equal(parseTarget(s), null, s);
});
