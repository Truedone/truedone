// CLI-03-AC02 (PV-L06, S4): when --run runs someone else's PR, the PR's code sees none of the filtered variables:
// every name ending in _TOKEN, _SECRET, _KEY or _PASSWORD, and AWS_*, AZURE_*, GOOGLE_APPLICATION_CREDENTIALS and
// NPM_CONFIG_* (npm_config_* too, which npm also reads). Everything else is passed as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, remote, tmp, GITENV, pipe } from './lib/run-fakes.mjs';
import { filterEnv } from '../src/run.mjs';
import { dockerExecArgs } from '../src/docker.mjs';

const SECRETS = {
  GITHUB_TOKEN: 'ghp_1', NPM_TOKEN: 'npm_2', MY_API_KEY: 'k3', STRIPE_SECRET: 's4', DB_PASSWORD: 'p5',
  AWS_ACCESS_KEY_ID: 'a6', AWS_REGION: 'eu-west-1', AZURE_CLIENT_ID: 'z7', GOOGLE_APPLICATION_CREDENTIALS: '/k.json',
  NPM_CONFIG_REGISTRY: 'https://r.example', npm_config__authToken: 't8',
};
const KEPT = { LANG: 'en_GB.UTF-8', CI: '1', NODE_ENV: 'test', KEYBOARD: 'uk', TOKEN_HELPER: 'x', SECRETARY: 'y' };

test('the filter drops every variable S4 names and keeps the rest unchanged', () => {
  const out = filterEnv({ ...GITENV, ...SECRETS, ...KEPT });
  for (const k of Object.keys(SECRETS)) assert.equal(k in out, false, k);
  for (const [k, v] of Object.entries({ ...KEPT, PATH: GITENV.PATH })) assert.equal(out[k], v, k);
});

test('someone else\'s PR runs red-green with the filtered environment', async (t) => {
  const { url } = remote(t);
  const env = { ...GITENV, ...SECRETS, ...KEPT };
  const r = await run(['octo/demo#7', '--run', '--yes'], { env, cloneUrl: () => url, tmpdir: tmp(t), stdin: pipe() });
  assert.equal(r.code, 0, r.err);
  const seen = r.calls.find((c) => c[0] === 'redGreen')[1].env;
  for (const k of Object.keys(SECRETS)) assert.equal(k in seen, false, `the PR's code saw ${k}`);
  for (const [k, v] of Object.entries(KEPT)) assert.equal(seen[k], v, k);
});

test('in a container the PR\'s commands get the filtered environment too', () => {
  const args = dockerExecArgs({ id: 'c1', cwd: '/w', env: filterEnv({ ...SECRETS, ...KEPT }), command: 'node --test' });
  const vars = args.filter((a, i) => args[i - 1] === '--env').map((a) => a.split('=')[0]);
  for (const k of Object.keys(SECRETS)) assert.equal(vars.includes(k), false, k);
  assert.ok(vars.includes('CI') && vars.includes('NODE_ENV'));
});
