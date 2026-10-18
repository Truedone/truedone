// The plugin hook's entry (PLG-01). tools/bundle.mjs inlines this file, core, core/run and the CLI's local diff reader
// into packages/cli/plugin/hooks/stop.mjs, with the line const REDGREEN_ENABLED = false; (PLG-03 turns it on), so the
// installed plugin is one file run as node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs".
import os from 'node:os';
import path from 'node:path';
import { analyse, classify } from '../../../core/core.mjs';
import { detect } from '../../../core/run/detect.mjs';
import { runSide } from '../../../core/run/run.mjs';
import { localInput } from '../local.mjs';
import { main } from './stop.mjs';

// set at build time from docs/gates/redgreen.json (D17); PLG-03 makes the hook use it
const REDGREEN_ENABLED = false;

main({
  analyse, classify, detect, runSide, localInput,
  dataDir: process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'truedone-plugin'),
});
