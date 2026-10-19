// The action's entry (ACT-01): built by tools/bundle.mjs into dist/index.mjs with
// the executor seam bundled in. Skips non-pull_request events with a message before
// reading anything, then reads the event and hands the context to the seam.
import { readFileSync } from "node:fs";
import { runGate } from "./gate-seam.mjs";

if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
  console.log(`truedone: the action runs on pull_request events only (got ${process.env.GITHUB_EVENT_NAME}); skipping.`);
  process.exit(0);
}

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const context = {
  repository: process.env.GITHUB_REPOSITORY,
  headSha: event.pull_request?.head?.sha ?? event.after ?? event.sha,
  baseSha: event.pull_request?.base?.sha,
  eventName: process.env.GITHUB_EVENT_NAME,
  config: process.env.INPUT_CONFIG || ".github/truedone.yml",
  timeoutS: Number(process.env.INPUT_TIMEOUT || 1200),
};

// runGate resolves to { code, report? }; destructure so process.exit never
// receives the object (the lead's 5083, fault 2).
const { code = 0 } = await runGate(context);
process.exit(code);
