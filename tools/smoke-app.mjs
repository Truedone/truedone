#!/usr/bin/env node
// The APP-06 smoke (AC01, AC08): opens a seeded PR in the sandbox and waits
// for its truedone:* label from the deployed Worker, and with
// --switch-off-test turns posting_enabled off and asserts nothing is posted
// within one minute. Runs where gh holds mgillr credentials (the lead runner).
// The seeded PR needs the sandbox's workflow (OPS-07's action pin) and the
// truedone-dev installation on the repository; it reports what is missing.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = process.argv.includes("--repo")
  ? process.argv[process.argv.indexOf("--repo") + 1]
  : "Truedone/truedone-sandbox";
const switchOff = process.argv.includes("--switch-off-test");

const gh = (...a) => execFileSync("gh", a, { encoding: "utf8" }).trim();

function waitForLabel(number, minutes) {
  const seconds = process.env.TRUEDONE_SMOKE_WAIT_SECONDS ? Number(process.env.TRUEDONE_SMOKE_WAIT_SECONDS) : minutes * 60;
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const labels = JSON.parse(gh("pr", "view", String(number), "-R", repo, "--json", "labels")).labels.map((l) => l.name);
    const mine = labels.find((n) => n.startsWith("truedone:"));
    if (mine) {
      // The label must come from the App (lane-b's review item 5): the labeled
      // event's actor is the app's bot login, never a hand-set label.
      const events = JSON.parse(gh("api", `repos/${repo}/issues/${number}/events?per_page=100`));
      const labeled = [...events].reverse().find((e) => e.event === "labeled" && e.label?.name === mine);
      const actor = String(labeled?.actor?.login ?? "");
      if (!actor.endsWith("[bot]") || !actor.toLowerCase().includes("truedone")) {
        throw new Error(`PR ${number} carries ${mine} but the labeled event's actor is ${actor || "nobody"}, not the App`);
      }
      return mine;
    }
    execFileSync(process.execPath, ["-e", "0"], { timeout: 5000 });
    const wait = execFileSync("sleep", ["1"], { encoding: "utf8" });
    void wait;
  }
  return null;
}

function seededPullRequest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-app-"));
  const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
  execFileSync("gh", ["repo", "clone", repo, dir, "--", "--depth=1"], { stdio: "inherit" });
  const cfg = ["-C", dir, "-c", "user.name=truedone-lane-d", "-c", "user.email=rgillespie83@icloud.com"];
  const branch = `app-smoke-${Date.now()}`;
  git(...cfg, "checkout", "-q", "-b", branch);
  fs.mkdirSync(path.join(dir, "src", "smoke"), { recursive: true });
  fs.mkdirSync(path.join(dir, "test"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "smoke", "mul.mjs"), "export const mul = (a, b) => a * b;\n");
  fs.writeFileSync(
    path.join(dir, "test", "smoke.test.mjs"),
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as smoke from "../src/smoke/mul.mjs";\ntest("mul multiplies", () => {\n  assert.equal(smoke.mul(2, 3), 6);\n});\n`,
  );
  git(...cfg, "add", ".");
  git(...cfg, "commit", "-q", "-m", "smoke: a seeded pull request for the app");
  execFileSync("git", [...cfg, "push", "-q", "origin", branch], { stdio: "inherit" });
  const url = gh("pr", "create", "-R", repo, "--head", branch, "--title", "smoke: the app's label", "--body", "Seeded by tools/smoke-app.mjs.");
  return { dir, number: Number(url.match(/\/pull\/(\d+)/)?.[1] ?? url.match(/\/(\d+)$/)?.[1] ?? 0), branch };
}

const opened = [];

async function main() {
  try {
    const first = seededPullRequest();
    opened.push(first);
    if (!first.number) {
      console.error("truedone: could not read the pull request number");
      return 1;
    }
    const label = waitForLabel(first.number, 5);
    if (!label) {
      console.error(`truedone: no truedone label on PR ${first.number} within five minutes`);
      return 1;
    }
    console.log(`truedone: PR ${first.number} carries ${label}`);
    if (switchOff) {
      // AC08: the smoke flips the global posting switch itself (APP-09's KV
      // key, through wrangler — authenticated on the lead runner; a lane
      // without wrangler auth reports BLOCKED), confirms /health reads false,
      // seeds, waits one minute for nothing to post, and restores the switch
      // in a finally. No truedone label is ever written by hand.
      const dev = "https://truedone-dev.ledgerguard-global.workers.dev/health";
      const health = () => JSON.parse(execFileSync("curl", ["-sS", "--max-time", "15", dev], { encoding: "utf8" }));
      const switchTo = (state) => execFileSync("truedone-dev-switch", [state], { stdio: "pipe", timeout: 120_000 });
      let switched = false;
      try {
        try {
          switchTo("off");
        } catch {
          throw new Error("BLOCKED: truedone-dev-switch is not on PATH (the flip runs on the lead runner's bin)");
        }
        switched = true;
        const flipped = health();
        if (flipped.posting_enabled !== false) throw new Error(`/health still reads posting_enabled ${flipped.posting_enabled} after the flip`);
        // The KV write reaches the edge cache the consumer reads for up to a
        // minute (#107): wait it out before seeding, so the second PR's
        // delivery is only judged after the switch can be honoured.
        const propagationSeconds = process.env.TRUEDONE_SMOKE_WAIT_SECONDS ? Number(process.env.TRUEDONE_SMOKE_WAIT_SECONDS) : 60;
        console.error(`truedone: waiting ${propagationSeconds} s for the switch to reach the edge cache`);
        execFileSync("sleep", [String(propagationSeconds)]);
        const second = seededPullRequest();
        opened.push(second);
        const label2 = waitForLabel(second.number, 1);
        if (label2) {
          console.error(`truedone: PR ${second.number} got ${label2} with the posting switch off`);
          return 1;
        }
        console.log(`truedone: PR ${second.number} got no label within one minute with the switch off`);
      } finally {
        if (switched) {
          try {
            switchTo("on");
          } catch (restoreError) {
            console.error(`truedone: WARNING the restore failed (${restoreError?.message ?? restoreError}); flip posting_enabled on manually`);
          }
          const restored = health();
          console.log(`truedone: the switch is restored (/health posting_enabled ${restored.posting_enabled})`);
        }
      }
    }
    return 0;
  } finally {
    // The smoke closes what it opened and deletes the branch, pass or fail
    // (the lead's FOLD): the close failure is logged, never masked.
    for (const { number, branch } of opened) {
      execFileSync("gh", ["pr", "close", String(number), "-R", repo, "--delete-branch"], { stdio: "inherit" });
    }
  }
}

const code = await main().catch((error) => {
  console.error(error?.message ?? String(error));
  return 1;
});
process.exit(code ?? 0);
