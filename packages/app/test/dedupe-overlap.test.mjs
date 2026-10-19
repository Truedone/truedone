// APP-26: the intake awaited the KV read of delivery:<id> and then the KV write before it handed a pull_request
// delivery to the stage, so each kept delivery waited 296 ms at p50 (n=30) before its first GitHub read, inside the
// opened-to-label time GitHub measures (PV-A03). Now the stage starts at once and the dedupe runs beside its switch and
// read phases; only the check run and label writes, and any hand-over to the queue, wait for the dedupe verdict. Here
// the Worker's own default export takes signed deliveries. KV can hold its read or write of delivery:<id>, and every KV
// call, fetch and queue send goes into one ordered log:
// - with the dedupe read held, the stage's config read is already sent, nothing is written and no answer has gone back;
//   released as new, the record is written once, then the check run and the label;
// - with the record's write held, the check run and the label wait for it;
// - a duplicate answers "duplicate" and writes no check run, no label and no record, and sends nothing;
// - a failed read or write throws to GitHub (500), with no write and no send;
// - a run that fails before the verdict is handed to the queue only when the verdict is new; a failed hand-over still
//   deletes the record after it was written, and a redeliver is analysed;
// - a queued delivery is deduped before its send.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { LABELS } from "../src/labels.mjs";
import { fakeGitHub, writeRoutes, pkcs1Pem, flagsDB, compareRoute } from "./lib/github.mjs";

const SECRET = "overlap-secret";
const KEY = await pkcs1Pem();
const B = "cccccccccccccccccccccccccccccccccccccccc";
const H = "dddddddddddddddddddddddddddddddddddddddd";
const REPO = { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } };
const PULL = { number: 6, state: "open", title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: 1,
  base: { ref: "main", sha: B, repo: REPO }, head: { ref: "branch", sha: H, repo: REPO } };
const FILE = "test/a.test.js";
const BEFORE = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n`;
const AFTER = `${BEFORE}test('a again', () => {\n  assert.equal(f(), 1);\n});\n`;
const turn = () => new Promise((resolve) => setImmediate(resolve));

// one ordered log of every KV call, fetch (sent, then answered) and queue send. when(pred) resolves true once an entry
// matching pred is logged, at once if one already is: the tests wait for the event itself, not for a number of turns,
// which ran out under load before the token mint's RSA signature did (APP-27, 2 of 5 full suites in the gate container).
// It resolves false after a wall-clock minute, so the test's assertion names what never happened; that never makes a test
// pass.
function world({ seed = {}, filesStatus = 200, sendFails = false } = {}) {
  const log = [];
  const waiters = new Set();
  const note = (e) => { log.push(e); for (const w of waiters) if (w.pred(e)) { waiters.delete(w); w.done(); } };
  const when = (pred) => log.some(pred) ? Promise.resolve(true) : new Promise((resolve) => {
    const w = { pred, done: () => { clearTimeout(timer); resolve(true); } };
    const timer = setTimeout(() => { waiters.delete(w); resolve(false); }, 60_000);
    waiters.add(w);
  });
  let pending = 0;
  const store = new Map(Object.entries(seed));
  const holds = {};
  // a hold on the read or write of a delivery: record; release() lets it go on, release(true) makes it fail
  const hold = (op) => { let release; const p = new Promise((r) => { release = r; }); holds[op] = p; return (fail = false) => { delete holds[op]; release(fail); }; };
  const held = async (op, k) => {
    if (!k.startsWith("delivery:") || !holds[op]) return;
    if (await holds[op]) { note([`kv.${op}.failed`, k]); throw new Error(`KV ${op} failed for ${k}`); }
  };
  const kv = {
    async get(k) { note(["kv.get", k]); await held("get", k); await turn(); const v = store.has(k) ? store.get(k) : null; note(["kv.got", k]); return v; },
    async put(k, v, opts) { note(["kv.put", k, opts?.expirationTtl ?? null]); await held("put", k); await turn(); store.set(k, v); note(["kv.put.done", k]); },
    async delete(k) { note(["kv.delete", k]); await turn(); store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: undefined }; },
  };
  const gh = fakeGitHub({
    api: {
      "POST /app/installations/3/access_tokens": { token: "tok" },
      "GET /repos/o/r/pulls/6": PULL,
      "GET /repos/o/r/pulls/6/files": () => filesStatus === 200
        ? Response.json([{ filename: FILE, status: "modified", patch: "@@ -5,0 +6,3 @@" }])
        : Response.json({ message: "boom" }, { status: filesStatus }),
      ...compareRoute("o", "r", B, H),
      ...writeRoutes("o", "r", 6, H),
      "GET /repos/o/r/labels": LABELS.map((l) => ({ name: l.name })),
    },
    raw: { [`o/r/${B}/${FILE}`]: BEFORE, [`o/r/${H}/${FILE}`]: AFTER },
  });
  const fetch = async (url, init = {}) => {
    note(["fetch", init.method || "GET", String(url)]);
    pending += 1;
    try { return await gh(url, init); } finally { pending -= 1; note(["fetch.answered", init.method || "GET", String(url)]); }
  };
  fetch.calls = gh.calls;
  const sent = [];
  const env = {
    WEBHOOK_SECRET: SECRET, APP_ID: "12345", PRIVATE_KEY: KEY, KV: kv, FLAGS: flagsDB({ posting_enabled: "on" }), VERSION: "v",
    QUEUE: { async send(body, opts) { note(["queue.send", body.delivery]); if (sendFails) throw new Error("queue send failed"); sent.push([body, opts]); } },
  };
  return { log, store, hold, env, sent, fetch, when, pending: () => pending };
}
function useFetch(t, fetch) {
  const orig = globalThis.fetch;
  globalThis.fetch = fetch;
  t.after(() => { globalThis.fetch = orig; });
}
function quiet(t) { t.mock.method(console, "error", () => {}); t.mock.method(console, "log", () => {}); }
async function signed(payload, event, delivery) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, body))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://truedone.dev/api/github/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-github-delivery": delivery, "x-github-event": event, "x-hub-signature-256": `sha256=${mac}` },
    body,
  });
}
const prPayload = () => ({ action: "opened", number: 6, pull_request: PULL, repository: { id: 7, name: "r", owner: { login: "o" } }, installation: { id: 3 } });
const runPayload = () => ({ action: "completed", workflow_run: { id: 9, head_sha: H, head_repository: { full_name: "o/r" } }, repository: { id: 7, name: "r", owner: { login: "o" } }, installation: { id: 3 } });
const ctx = () => { const waited = []; return { waited, waitUntil(p) { waited.push(p); } }; };
// a request whose answer is watched: settled says whether it has come back
function start(env, request, c) {
  const r = { settled: false };
  r.promise = worker.fetch(request, env, c).then((res) => { r.settled = true; return res; }, (e) => { r.settled = true; throw e; });
  r.promise.catch(() => {});
  return r;
}
const at = (log, pred) => log.findIndex(pred);
const isFetch = (method, re) => (e) => e[0] === "fetch" && e[1] === method && re.test(e[2]);
const CONFIG = isFetch("GET", /raw\.githubusercontent\.com\/o\/r\/c+\/\.github\/truedone\.yml$/);
const CHECK_WRITE = (e) => e[0] === "fetch" && /\/repos\/o\/r\/check-runs(\/\d+)?$/.test(e[2]) && e[1] !== "GET";
const LABEL_WRITE = (e) => e[0] === "fetch" && e[1] !== "GET" && (/\/issues\/6\/labels/.test(e[2]) || /\/issues\/6$/.test(e[2]) || /\/graphql$/.test(e[2]));
const WRITE = (e) => CHECK_WRITE(e) || LABEL_WRITE(e);
// Idle: every fetch sent has answered, and then ten turns log nothing. The only work on the stage's path that leaves the
// thread is the signature check and the token mint, both before its first API read, so once the reads have answered what
// is left runs in turns whatever the load: a write or send the code was going to make before the verdict has been made.
async function idle(w) {
  for (let quiet = 0; quiet < 10;) {
    if (w.pending()) { assert.ok(await w.when((e) => e[0] === "fetch.answered" && w.pending() === 0), "never happened: every fetch answered"); quiet = 0; }
    const seen = w.log.length;
    await turn();
    quiet = w.log.length === seen && !w.pending() ? quiet + 1 : 0;
  }
}

test("with the dedupe read held, the config read is sent and nothing is written; released as new, the record is written once, then the check run and the label", async (t) => {
  const w = world();
  useFetch(t, w.fetch);
  const release = w.hold("get");
  const c = ctx();
  const r = start(w.env, await signed(prPayload(), "pull_request", "d-1"), c);
  // the stage runs its switch and read phases while the read is held
  assert.ok(await w.when(isFetch("GET", /\/issues\/6\/labels$/)), "never happened: the labels read");
  assert.ok(at(w.log, CONFIG) >= 0, "the config read is sent before the dedupe read answers");
  assert.equal(at(w.log, (e) => e[0] === "kv.got" && e[1] === "delivery:d-1"), -1, "the dedupe read has not answered");
  assert.equal(at(w.log, WRITE), -1, "nothing is written before the verdict");
  assert.equal(r.settled, false, "the answer waits for the verdict");
  release();
  const res = await r.promise;
  assert.deepEqual(await res.json(), { analysing: "pull_request" });
  await Promise.all(c.waited);
  const puts = w.log.filter((e) => e[0] === "kv.put" && e[1] === "delivery:d-1");
  assert.deepEqual(puts, [["kv.put", "delivery:d-1", 86400]], "the record is written once, for 24 hours");
  const done = at(w.log, (e) => e[0] === "kv.put.done" && e[1] === "delivery:d-1");
  const check = at(w.log, CHECK_WRITE), label = at(w.log, LABEL_WRITE);
  assert.ok(check > done && label > done, `the check run (${check}) and the label (${label}) come after the record (${done})`);
  assert.equal(w.log.filter(CHECK_WRITE).length, 1);
  assert.deepEqual(w.sent, []);
});

test("with the record's write held, the check run and the label wait for it", async (t) => {
  const w = world();
  useFetch(t, w.fetch);
  const release = w.hold("put");
  const c = ctx();
  const r = start(w.env, await signed(prPayload(), "pull_request", "d-2"), c);
  assert.deepEqual(await Promise.all([w.when((e) => e[0] === "kv.put" && e[1] === "delivery:d-2"), w.when(isFetch("GET", /\/issues\/6\/labels$/))]), [true, true], "never happened: the record's write and the read phase");
  await idle(w);
  assert.equal(at(w.log, WRITE), -1, "no write while the record's write is held");
  assert.equal(r.settled, false);
  release();
  await r.promise;
  await Promise.all(c.waited);
  const done = at(w.log, (e) => e[0] === "kv.put.done" && e[1] === "delivery:d-2");
  assert.ok(at(w.log, CHECK_WRITE) > done && at(w.log, LABEL_WRITE) > done, "both writes follow the record");
});

test("a duplicate answers duplicate, and writes no check run, no label and no record, and sends nothing", async (t) => {
  const w = world({ seed: { "delivery:d-3": "1" } });
  useFetch(t, w.fetch);
  const lines = [];
  t.mock.method(console, "log", (...a) => { lines.push(a.map(String).join(" ")); });
  const c = ctx();
  const res = await worker.fetch(await signed(prPayload(), "pull_request", "d-3"), w.env, c);
  assert.deepEqual([res.status, await res.text()], [200, "duplicate"]);
  await Promise.all(c.waited);
  assert.ok(at(w.log, CONFIG) >= 0, "its switch phase ran");
  assert.deepEqual(w.log.filter(WRITE), [], "no check run or label write");
  assert.deepEqual(w.log.filter((e) => e[0] === "kv.put" && e[1].startsWith("delivery:")), [], "no record written");
  assert.deepEqual(w.log.filter((e) => e[0] === "queue.send"), []);
  assert.deepEqual(lines.filter((l) => l.includes('"stage":"static"')), [], "no phase line for a duplicate");
});

for (const op of ["get", "put"]) {
  test(`a failed dedupe ${op === "get" ? "read" : "write"} throws to GitHub, with no write and no send`, async (t) => {
    quiet(t);
    const w = world();
    useFetch(t, w.fetch);
    const release = w.hold(op);
    const c = ctx();
    const r = start(w.env, await signed(prPayload(), "pull_request", `d-${op}`), c);
    assert.ok(await w.when(isFetch("GET", /\/issues\/6\/labels$/)), "never happened: the read phase");
    release(true);
    await assert.rejects(r.promise, new RegExp(`KV ${op} failed`));
    await Promise.all(c.waited);
    assert.deepEqual(w.log.filter(WRITE), []);
    assert.deepEqual(w.log.filter((e) => e[0] === "queue.send"), []);
  });
}

for (const [verdict, sends] of [["new", 1], ["duplicate", 0]]) {
  test(`a run that fails before the verdict is handed to the queue ${sends ? "when it is new, in the slim shape, with the record kept" : "not at all when it is a duplicate"}`, async (t) => {
    quiet(t);
    const w = world({ filesStatus: 500 });
    useFetch(t, w.fetch);
    const release = w.hold("get");
    const c = ctx();
    const r = start(w.env, await signed(prPayload(), "pull_request", "d-5"), c);
    assert.ok(await w.when(isFetch("GET", /\/pulls\/6\/files/)), "never happened: the failing files read");
    await idle(w);
    assert.deepEqual(w.log.filter((e) => e[0] === "queue.send"), [], "nothing is sent before the verdict");
    if (verdict === "duplicate") w.store.set("delivery:d-5", "1");
    release();
    await r.promise;
    await Promise.all(c.waited);
    assert.equal(w.sent.length, sends);
    if (sends) {
      assert.deepEqual(w.sent[0][0].payload.pull_request, { number: 6, base: { sha: B }, head: { sha: H } });
      assert.equal(w.store.get("delivery:d-5"), "1", "the queue has it, so the record stays");
    }
    assert.deepEqual(w.log.filter(WRITE), []);
  });
}

test("a failed hand-over deletes the record after it was written, and a redeliver of the id is analysed once", async (t) => {
  quiet(t);
  const w = world({ filesStatus: 500, sendFails: true });
  useFetch(t, w.fetch);
  const c = ctx();
  await worker.fetch(await signed(prPayload(), "pull_request", "d-6"), w.env, c);
  await Promise.all(c.waited);
  const done = at(w.log, (e) => e[0] === "kv.put.done" && e[1] === "delivery:d-6");
  const del = at(w.log, (e) => e[0] === "kv.delete" && e[1] === "delivery:d-6");
  assert.ok(done >= 0 && del > done, `the record (${done}) is deleted (${del}) after it was written`);
  assert.equal(w.store.has("delivery:d-6"), false);
  // the redeliver, with GitHub answering again
  const again = world();
  for (const [k, v] of w.store) again.store.set(k, v);
  useFetch(t, again.fetch);
  const c2 = ctx();
  const res = await worker.fetch(await signed(prPayload(), "pull_request", "d-6"), again.env, c2);
  assert.deepEqual(await res.json(), { analysing: "pull_request" });
  await Promise.all(c2.waited);
  assert.equal(again.log.filter(CHECK_WRITE).length, 1, "analysed once");
});

for (const [name, event, payload, withCtx] of [
  ["a pull_request with no ctx", "pull_request", prPayload, false],
  ["a workflow_run", "workflow_run", runPayload, true],
]) {
  test(`${name} is deduped before its send: read, record, then send`, async (t) => {
    const w = world();
    useFetch(t, w.fetch);
    const res = await worker.fetch(await signed(payload(), event, "d-7"), w.env, withCtx ? ctx() : undefined);
    assert.deepEqual(await res.json(), { queued: event });
    const order = w.log.filter((e) => (e[0].startsWith("kv.") && e[1] === "delivery:d-7") || e[0] === "queue.send").map((e) => e[0]);
    assert.deepEqual(order, ["kv.get", "kv.got", "kv.put", "kv.put.done", "queue.send"]);
    const second = await worker.fetch(await signed(payload(), event, "d-7"), w.env, withCtx ? ctx() : undefined);
    assert.equal(await second.text(), "duplicate");
    assert.equal(w.sent.length, 1);
  });
}
