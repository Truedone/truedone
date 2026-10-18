#!/usr/bin/env node
// The truedone command (CLI-01). tools/bundle.mjs builds packages/cli/truedone.mjs, the one published file, from this
// entry, packages/cli/src and core.mjs.
import { analyse, classify } from '../../core/core.mjs';
import { main } from './cli.mjs';

process.exitCode = await main(process.argv.slice(2), {
  analyse, classify, fetch: globalThis.fetch, cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr,
});
