#!/usr/bin/env node
// The truedone command (CLI-01, CLI-03). tools/bundle.mjs builds packages/cli/truedone.mjs, the one published file, from
// this entry, packages/cli/src, core.mjs and core/run.
import { analyse, classify, judge } from '../../core/core.mjs';
import { detect } from '../../core/run/detect.mjs';
import { redGreen } from '../../core/run/run.mjs';
import { restorePending } from '../../core/run/swap.mjs';
import { main } from './cli.mjs';

process.exitCode = await main(process.argv.slice(2), {
  analyse, classify, judge, detect, redGreen, restorePending,
  fetch: globalThis.fetch, cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr,
});
