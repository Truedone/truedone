// APP-15-AC01 (#108): the development App labelled at p50 11,000 ms. Part of that was the static stage awaiting every
// call in turn. Here every fake GitHub call takes 100 ms, and the Worker's own default export handles a
// pull_request delivery with two changed test files in under half the time its calls take one after another,
// writing the same check run and label. It runs in three phases: the switch (the base config and both flags) first,
// then every read together, then the two writes together. Nothing but the config is read before the switch, so with
// posting off, or enabled: false at the base, only the config is read and nothing is written.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { analyse, classify } from "../../core/core.mjs";
import { loadPR } from "../../web/lib/github.mjs";
import { LABELS } from "../src/labels.mjs";
import { fakeGitHub, memoryKV, writeRoutes, delivery, pkcs1Pem } from "./lib/github.mjs";

const B = "cccccccccccccccccccccccccccccccccccccccc";
const H = "dddddddddddddddddddddddddddddddddddddddd";
const REPO = { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } };
const before = (n) => `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('${n}', () => {\n  assert.equal(f(), 1);\n});\n`;
const after = (n) => `${before(n)}test('${n} again', () => {\n  assert.equal(f(), 1);\n});\n`;

// A pull request changing the given test files (each gains a case); the repository defines every truedone label.
function github(names, raw = {}) {
  const pull = { number: 6, state: "open", title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: names.length,
    base: { ref: "main", sha: B, repo: REPO }, head: { ref: "branch", sha: H, repo: REPO } };
  const files = names.map((p) => ({ filename: p, status: "modified", patch: "@@ -5,0 +6,3 @@" }));
  const contents = Object.fromEntries(names.flatMap((p) => [[`o/r/${B}/${p}`, before(p)], [`o/r/${H}/${p}`, after(p)]]));
  const api = {
    "POST /app/installations/3/access_tokens": { token: "tok" },
    "GET /repos/o/r/pulls/6/files": files,
    ...writeRoutes("o", "r", 6, H),
    "GET /repos/o/r/labels": LABELS.map((l) => ({ name: l.name })),
  };
  return { pull, fake: fakeGitHub({ api, raw: { ...contents, ...raw } }), api, contents };
}
// every call waits ms before it is answered; each call's start, from the first call, is kept
function slow(fetch, ms = 100) {
  let t0 = null;
  const calls = [];
  const f = async (url, init = {}) => {
    t0 ??= Date.now();
    calls.push({ url: String(url), method: init.method || "GET", at: Date.now() - t0 });
    await new Promise((r) => setTimeout(r, ms));
    return fetch(url, init);
  };
  f.calls = calls;
  return f;
}
async function deliver(t, f, pull, kv = memoryKV()) {
  const key = await pkcs1Pem();
  const orig = globalThis.fetch;
  globalThis.fetch = f;
  t.after(() => { globalThis.fetch = orig; });
  const m = { body: delivery(pull), acked: 0, retried: 0, ack() { this.acked += 1; }, retry() { this.retried += 1; } };
  const from = Date.now();
  await worker.queue({ messages: [m] }, { APP_ID: "12345", PRIVATE_KEY: key, KV: kv, VERSION: "v" });
  const ms = Date.now() - from;
  globalThis.fetch = orig;
  assert.equal(m.acked, 1, `handled, retried ${m.retried}`);
  return ms;
}
const path = (c) => c.url.replace("https://api.github.com", "").replace("https://raw.githubusercontent.com/", "raw:").replace(/\?.*$/, "");
const repoWrites = (calls) => calls.filter((c) => c.method !== "GET" && c.url.startsWith("https://api.github.com/repos/"));
const startOf = (calls, re) => { const c = calls.find((x) => re.test(`${x.method} ${path(x)}`)); assert.ok(c, `a call ${re}`); return c.at; };

test("two changed test files: under half the time in sequence, the reads together, the writes together, the same writes", async (t) => {
  const names = ["test/a.test.js", "test/b.test.js"];
  const g = github(names);
  // the writes the stage must make: core's verdict for the files as the site reads them
  const site = await loadPR({ owner: "o", repo: "r", number: 6 }, { fetch: fakeGitHub({ api: { ...g.api, "GET /repos/o/r/pulls/6": g.pull }, raw: g.contents }), classify });
  const want = analyse({ ...site.input, releases: [] });
  const f = slow(g.fake);
  const ms = await deliver(t, f, g.pull);
  const n = f.calls.length;
  t.diagnostic(`two files: ${ms} ms for ${n} calls of 100 ms (${n * 100} ms in sequence, ${Math.round((100 * ms) / (n * 100))}%)`);
  assert.ok(ms < (n * 100) / 2, `${ms} ms is not under half of ${n * 100} ms`);
  // phase 2: every read starts together, after the config read has answered
  const config = startOf(f.calls, /^GET raw:o\/r\/c+\/\.github\/truedone\.yml$/);
  const reads = [/^GET \/repos\/o\/r\/pulls\/6\/files$/, /^GET \/repos\/truedone\/action\/tags$/, /^GET \/repos\/o\/r\/commits\/d+\/check-runs$/, /^GET \/repos\/o\/r\/issues\/6\/labels$/, /^GET \/repos\/o\/r\/labels$/].map((re) => startOf(f.calls, re));
  assert.ok(Math.max(...reads) - Math.min(...reads) < 50, `the reads start together: ${reads}`);
  assert.ok(Math.min(...reads) >= config + 100, "no read starts before the switch is read");
  // phase 3: the two writes start together
  const writes = repoWrites(f.calls);
  assert.deepEqual(writes.map((c) => `${c.method} ${path(c)}`).sort(), ["POST /repos/o/r/check-runs", "POST /repos/o/r/issues/6/labels"]);
  assert.ok(Math.abs(writes[0].at - writes[1].at) < 50, `the writes start together: ${writes.map((c) => c.at)}`);
  const inner = g.fake.calls.filter((c) => c.method === "POST" && c.url.startsWith("https://api.github.com/repos/"));
  assert.equal(JSON.parse(inner.find((c) => c.url.endsWith("/check-runs")).body).output.title, `truedone: ${want.verdict.replace(/_/g, " ")}`);
  assert.deepEqual(JSON.parse(inner.find((c) => c.url.endsWith("/issues/6/labels")).body).labels, [want.label]);
});

test("one changed test file: the ratio, printed", async (t) => {
  const g = github(["test/a.test.js"]);
  const f = slow(g.fake);
  const ms = await deliver(t, f, g.pull);
  t.diagnostic(`one file: ${ms} ms for ${f.calls.length} calls of 100 ms (${f.calls.length * 100} ms in sequence, ${Math.round((100 * ms) / (f.calls.length * 100))}%)`);
  assert.equal(repoWrites(f.calls).length, 2);
});

for (const [name, kv, raw] of [
  ["posting_enabled off", () => { const k = memoryKV(); k.put("posting_enabled", "off"); return k; }, {}],
  ["enabled: false at the base", () => memoryKV(), { [`o/r/${B}/.github/truedone.yml`]: "enabled: false\n" }],
]) {
  test(`${name}: only the config is read, and nothing is written`, async (t) => {
    const g = github(["test/a.test.js"], raw);
    const f = slow(g.fake, 1);
    await deliver(t, f, g.pull, kv());
    assert.deepEqual(f.calls.map((c) => `${c.method} ${path(c)}`), ["POST /app/installations/3/access_tokens", `GET raw:o/r/${B}/.github/truedone.yml`]);
  });
}
