// Builds the action mirror tree: action.yml at the root, dist/index.mjs,
// README.md, LICENSE and NOTICE, from main and nothing else (REL-P2). A run
// naming an out dir writes the tree locally, prints each file's SHA-256 and
// the commands Ryan runs to push the tree and tag v0.1.0 (REL-P5). Two runs
// give the same bytes; a missing source file stops the build.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const USAGE_PINNED = [
  "- uses: Truedone/truedone-action@v0.1.0",
  "  # For production, pin the commit the tag names: Truedone/truedone-action@<40-hex commit sha>",
].join("\n");

const COPIES = [
  ["packages/action/action.yml", "action.yml"],
  ["packages/action/dist/index.mjs", "dist/index.mjs"],
  ["packages/action/README.md", "README.md", true],
  ["LICENSE", "LICENSE"],
  ["NOTICE", "NOTICE"],
];

// The mirrored README's usage block reads the release tag, with how to pin
// the commit the tag names for production. The repository README may carry
// an unpinned placeholder line, which is replaced; otherwise the block is
// appended, so the mirror needs nothing from main but the file itself.
export function usageBlock(text) {
  if (/uses: Truedone\/truedone-action@<release sha>/.test(text)) {
    return text.replace(/- uses: Truedone\/truedone-action@<release sha>( #[^\n]*)?/, USAGE_PINNED);
  }
  const block = `## Usage\n\n\`\`\`yaml\n${USAGE_PINNED}\n\`\`\`\n`;
  return text.endsWith("\n") ? text + "\n" + block : text + "\n\n" + block;
}

export function buildMirror(root, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const [from, to, readme] of COPIES) {
    const src = path.join(root, from);
    const out = path.join(dest, to);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    let text = fs.readFileSync(src, "utf8");
    if (readme) text = usageBlock(text);
    fs.writeFileSync(out, text);
  }
  return dest;
}

export function listMirror(dest) {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) walk(abs);
      else out.push(path.relative(dest, abs).split(path.sep).join("/"));
    }
  };
  walk(dest);
  return out.sort();
}

const MIRROR_REMOTE = "https://github.com/Truedone/truedone-action.git";

function git(args, cwd, token) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const cmd = token
    ? ["-c", `http.extraheader=AUTHORIZATION: bearer ${token}`, ...args]
    : args;
  execFileSync("git", cmd, { cwd, env, stdio: "pipe" });
}

// The send mode: commit the built tree, tag it and push the tag to the
// mirror remote. The token must be present before anything is sent.
export function pushMirror(dest, { tag, token, remote = MIRROR_REMOTE } = {}) {
  if (!token) throw new Error("MIRROR_TOKEN is required");
  if (!tag || tag.includes(" ") || tag.includes("..")) throw new Error("a release tag is required");
  if (remote !== MIRROR_REMOTE) throw new Error("the mirror remote is fixed");
  git(["init", "-q"], dest);
  git(["add", "-A"], dest);
  git(
    ["-c", "user.name=mgillr", "-c", "user.email=rgillespie83@icloud.com", "commit", "-q", "-m", `Release ${tag}`],
    dest,
  );
  git(["tag", tag], dest);
  git(["push", remote, `refs/tags/${tag}`], dest, token);
}

function main() {
  const writeOut = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
  const root = process.argv.includes("--source") ? process.argv[process.argv.indexOf("--source") + 1] : process.cwd();
  if (process.argv.includes("--tree")) {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "truedone-action-"));
    buildMirror(root, dest);
    process.stdout.write(`${dest}\n`);
    return;
  }
  if (!writeOut) {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "truedone-action-"));
    buildMirror(root, dest);
    pushMirror(dest, { tag: process.env.GITHUB_REF_NAME || "", token: process.env.MIRROR_TOKEN || "" });
    return;
  }
  buildMirror(root, writeOut);
  for (const f of listMirror(writeOut)) {
    const sha = crypto.createHash("sha256").update(fs.readFileSync(path.join(writeOut, f))).digest("hex");
    process.stdout.write(`${sha}  ${f}\n`);
  }
  process.stdout.write("\nCommands for the release (REL-P5):\n");
  for (const line of [
    `  cd ${writeOut}`,
    '  git init -b main && git add -A && git commit -m "truedone-action v0.1.0"',
    "  git remote add origin https://github.com/Truedone/truedone-action.git",
    "  git push -u origin main",
    "  git tag v0.1.0 && git push origin v0.1.0",
  ]) process.stdout.write(`${line}\n`);
}

// The entry guard compares real paths: node resolves the main module to its
// real path, so started through a symlinked directory the path it was
// started by differs from the module's (GUARD-01).
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main();
