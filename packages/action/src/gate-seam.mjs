// The seam the bundle wires the executor through (ACT-01, ACT-03). runGate maps
// the action's runtime environment onto the executor: the workspace, the event
// file and the checked-out sha come from the runner's environment, the config
// file is read here, and the executor's code is the action's exit code. A
// misconfigured event throws before the swap, and the executor's Could not run
// paths return 1 without touching the repository's CI verdict beyond that.
import fs from "node:fs";
import { runGate as runGateEngine } from "./main.mjs";

export async function runGate(context) {
  const root = context.root ?? process.env.GITHUB_WORKSPACE;
  const eventPath = context.eventPath ?? process.env.GITHUB_EVENT_PATH;
  if (!root || !eventPath) {
    console.log(`truedone: no workspace or event file; nothing ran for ${context.repository ?? "the repository"} ${context.headSha ?? ""}.`);
    return 0;
  }
  let configText;
  if (context.config) {
    try { configText = fs.readFileSync(context.config, "utf8"); } catch { configText = undefined; }
  }
  return runGateEngine({ root, eventPath, githubSha: context.headSha, configText, env: process.env, exec: context.exec });
}
