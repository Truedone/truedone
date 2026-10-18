// APP-24 (Truedone/truedone#122, R6): markRemoved was the only writer of removed:<id>, the marker the daily cron sweeps,
// and nothing called it: the intake answered installation.deleted with 200 {dropped} and returned, so an uninstalled
// installation's stored data was never deleted. APP-05 tested the functions directly; nothing drove an uninstall
// through the Worker. Here the Worker's own default export takes signed deliveries and runs its scheduled handler, with
// a KV in Workers KV's shape (each call is I/O, a list is sorted by key and pages at two keys with a cursor) and the D1
// fake:
// - installation.deleted writes removed:<id> before its answer, then deletes the installation's <id>: keys, its kept
//   token and its switch row at once, after the answer in ctx.waitUntil, or inline with no ctx; another installation's
//   data stays;
// - a write racing the uninstall is deleted by the scheduled handler, with the marker;
// - sent twice with one id, it answers the same and leaves one marker and no dedupe record;
// - an installation id that is not a positive integer writes nothing;
// - a failed at-once delete logs one line, still answers 200 and leaves the rest to the sweep;
// - one installation's failing sweep keeps its marker, the next is still swept, and the handler throws.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { flagsDB } from "./lib/github.mjs";

const SECRET = "uninstall-secret";
const PAGE = 2;
const io = () => new Promise((resolve) => setTimeout(resolve, 0));

// Workers KV as the Worker calls it: get, put, delete and a list of { keys: [{ name }], list_complete, cursor }, sorted
// by key. Every call is recorded, and a delete of a key in failDelete throws.
function workersKV(seed = {}, { failDelete = new Set() } = {}) {
  const store = new Map(Object.entries(seed));
  const calls = [];
  return {
    store,
    calls,
    failDelete,
    keys: () => [...store.keys()].sort(),
    async get(k) { calls.push(["get", k]); await io(); return store.has(k) ? store.get(k) : null; },
    async put(k, v) { calls.push(["put", k]); await io(); store.set(k, String(v)); },
    async delete(k) {
      calls.push(["delete", k]);
      await io();
      if (failDelete.has(k)) throw new Error(`KV delete failed for ${k}`);
      store.delete(k);
    },
    async list({ prefix = "", cursor } = {}) {
      calls.push(["list", { prefix, cursor }]);
      await io();
      const names = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = cursor === undefined ? 0 : Number(cursor);
      const page = names.slice(from, from + PAGE);
      const done = from + PAGE >= names.length;
      return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(from + PAGE) };
    },
  };
}
function environment(kv, db) {
  const sent = [];
  return { sent, env: { WEBHOOK_SECRET: SECRET, KV: kv, FLAGS: db, QUEUE: { async send(b) { sent.push(b); } }, VERSION: "v" } };
}
const waitingCtx = () => { const waited = []; return { waited, waitUntil(p) { waited.push(p); } }; };
const uninstall = (id) => JSON.stringify({ action: "deleted", installation: { id, account: { login: "o" } } });
const SCHEDULED = { cron: "13 4 * * *", scheduledTime: Date.parse("2026-10-19T04:13:00Z") };

async function signed(text, delivery) {
  const body = new TextEncoder().encode(text);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, body))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://truedone.dev/api/github/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-github-delivery": delivery, "x-github-event": "installation", "x-hub-signature-256": `sha256=${mac}` },
    body,
  });
}
// the KV keys as they stand the moment the answer comes back, before anything left in ctx.waitUntil runs on
async function deliver(env, text, delivery, ctx) {
  const r = await worker.fetch(await signed(text, delivery), env, ctx);
  const atAnswer = env.KV.keys();
  return { status: r.status, text: await r.text(), atAnswer };
}
function noFetch(t) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response("no", { status: 599 }); };
  t.after(() => { globalThis.fetch = orig; });
  return calls;
}
function errorLines(t) {
  const lines = [];
  const orig = console.error;
  console.error = (...args) => { lines.push(args.map(String).join(" ")); };
  t.after(() => { console.error = orig; });
  return lines;
}
const dedupeCalls = (kv) => kv.calls.filter(([, k]) => typeof k === "string" && k.startsWith("delivery:"));

test("installation.deleted marks the installation removed before its answer, then deletes its data at once", async (t) => {
  const fetches = noFetch(t);
  const kv = workersKV({ "3:verdict:1": "x", "3:verdict:2": "x", "3:config:r": "x", "token:3": "{}", "5:verdict:9": "x", "token:5": "{}" });
  const db = flagsDB({ posting_enabled: "on", "posting_enabled:3": "off", "posting_enabled:5": "off" });
  const { env, sent } = environment(kv, db);
  const ctx = waitingCtx();
  const r = await deliver(env, uninstall(3), "d-del-1", ctx);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.text), { dropped: "installation_deleted" });
  assert.ok(r.atAnswer.includes("removed:3"), "the marker is written before the answer");
  assert.ok(r.atAnswer.includes("3:verdict:1"), "the delete runs after the answer");
  assert.equal(ctx.waited.length, 1, "the delete is handed to ctx.waitUntil");
  await Promise.all(ctx.waited);
  assert.deepEqual(kv.keys(), ["5:verdict:9", "removed:3", "token:5"], "3's keys across both pages and its token are gone; 5's stay");
  assert.deepEqual([...db.store.keys()].sort(), ["posting_enabled", "posting_enabled:5"], "3's switch row is gone");
  assert.deepEqual(kv.calls.filter(([op, o]) => op === "list").map(([, o]) => o), [{ prefix: "3:", cursor: undefined }, { prefix: "3:", cursor: "2" }]);
  assert.deepEqual(dedupeCalls(kv), [], "no dedupe read or write");
  assert.deepEqual(sent, []);
  assert.deepEqual(fetches, []);
});

test("with no ctx, installation.deleted deletes the data before its answer", async (t) => {
  noFetch(t);
  const kv = workersKV({ "3:verdict:1": "x", "token:3": "{}", "5:verdict:9": "x" });
  const db = flagsDB({ posting_enabled: "on", "posting_enabled:3": "off" });
  const { env } = environment(kv, db);
  const r = await deliver(env, uninstall(3), "d-del-6");
  assert.deepEqual([r.status, JSON.parse(r.text)], [200, { dropped: "installation_deleted" }]);
  assert.deepEqual(r.atAnswer, ["5:verdict:9", "removed:3"]);
  assert.deepEqual([...db.store.keys()], ["posting_enabled"]);
});

test("a write racing the uninstall is deleted by the scheduled handler, with the marker", async (t) => {
  noFetch(t);
  const kv = workersKV({
    "3:verdict:1": "x", "5:verdict:9": "x", "token:5": "{}",
    "removed:8": "1", "8:verdict:1": "x", "removed:9": "1", "9:verdict:1": "x",
  });
  const db = flagsDB({ posting_enabled: "on", "posting_enabled:3": "off", "posting_enabled:5": "off", "posting_enabled:8": "off" });
  const { env } = environment(kv, db);
  const ctx = waitingCtx();
  await deliver(env, uninstall(3), "d-del-2", ctx);
  await Promise.all(ctx.waited);
  // a delivery in flight at the uninstall writes after the at-once delete: a key under 3: and the kept token
  await kv.put("3:verdict:late", "x");
  await kv.put("token:3", "{}");
  kv.calls.length = 0;
  await worker.scheduled(SCHEDULED, env);
  assert.deepEqual(kv.keys(), ["5:verdict:9", "token:5"], "3's raced keys, 8's and 9's data and every marker are gone");
  assert.deepEqual([...db.store.keys()].sort(), ["posting_enabled", "posting_enabled:5"]);
  const markerLists = kv.calls.filter(([op, o]) => op === "list" && o.prefix === "removed:").map(([, o]) => o.cursor);
  assert.deepEqual(markerLists, [undefined, "2"], "the marker list crossed a page");
});

test("installation.deleted sent twice with one id answers the same, and leaves one marker and no dedupe record", async (t) => {
  noFetch(t);
  const kv = workersKV({ "3:verdict:1": "x" });
  const { env, sent } = environment(kv, flagsDB({ posting_enabled: "on" }));
  const ctx = waitingCtx();
  for (const copy of [1, 2]) {
    const r = await deliver(env, uninstall(3), "d-del-3", ctx);
    assert.deepEqual([r.status, JSON.parse(r.text)], [200, { dropped: "installation_deleted" }], `copy ${copy}`);
  }
  await Promise.all(ctx.waited);
  assert.deepEqual(kv.keys(), ["removed:3"]);
  assert.deepEqual(kv.calls.filter(([op]) => op === "put").map(([, k]) => k), ["removed:3", "removed:3"], "marked each time");
  assert.deepEqual(dedupeCalls(kv), [], "no dedupe read or write");
  assert.deepEqual(sent, []);
});

for (const [label, installation] of [
  ["no installation", undefined], ["the id \"3\"", { id: "3" }], ["the id \"abc\"", { id: "abc" }],
  ["the id 0", { id: 0 }], ["the id -1", { id: -1 }], ["the id 3.5", { id: 3.5 }],
]) {
  test(`installation.deleted with ${label} writes nothing`, async (t) => {
    const fetches = noFetch(t);
    const kv = workersKV({ "3:verdict:1": "x", "token:3": "{}" });
    const db = flagsDB({ posting_enabled: "on", "posting_enabled:3": "off" });
    const { env, sent } = environment(kv, db);
    const ctx = waitingCtx();
    const r = await deliver(env, JSON.stringify({ action: "deleted", installation }), "d-del-4", ctx);
    assert.deepEqual([r.status, JSON.parse(r.text)], [200, { dropped: "installation_deleted" }]);
    assert.deepEqual(kv.calls, [], "no KV call");
    assert.deepEqual(db.statements, [], "no D1 statement");
    assert.deepEqual(ctx.waited, []);
    assert.deepEqual(sent, []);
    assert.deepEqual(fetches, []);
  });
}

test("a failed at-once delete logs one line and still answers 200, and the sweep deletes the rest", async (t) => {
  noFetch(t);
  const lines = errorLines(t);
  const kv = workersKV({ "3:verdict:1": "x", "3:verdict:2": "x", "token:3": "{}" }, { failDelete: new Set(["3:verdict:1"]) });
  const db = flagsDB({ posting_enabled: "on", "posting_enabled:3": "off" });
  const { env } = environment(kv, db);
  const ctx = waitingCtx();
  const r = await deliver(env, uninstall(3), "d-del-5", ctx);
  assert.deepEqual([r.status, JSON.parse(r.text)], [200, { dropped: "installation_deleted" }]);
  await Promise.all(ctx.waited);   // the promise handed to waitUntil does not reject
  assert.ok(kv.store.has("removed:3"), "the marker stays for the sweep");
  assert.equal(lines.length, 1, `one line: ${JSON.stringify(lines)}`);
  const line = JSON.parse(lines[0]);
  assert.deepEqual({ stage: line.stage, installation: line.installation, delivery: line.delivery }, { stage: "uninstall", installation: 3, delivery: "d-del-5" });
  assert.match(line.error, /KV delete failed for 3:verdict:1/);
  kv.failDelete.clear();
  await worker.scheduled(SCHEDULED, env);
  assert.deepEqual(kv.keys(), [], "the sweep deleted the data and the marker");
  assert.deepEqual([...db.store.keys()], ["posting_enabled"]);
});

test("one installation's failing sweep keeps its marker, the next is still swept, and the handler throws", async (t) => {
  noFetch(t);
  const lines = errorLines(t);
  const kv = workersKV(
    { "removed:3": "1", "3:verdict:1": "x", "removed:4": "1", "4:verdict:1": "x", "token:4": "{}" },
    { failDelete: new Set(["3:verdict:1"]) },
  );
  const db = flagsDB({ posting_enabled: "on", "posting_enabled:4": "off" });
  const { env } = environment(kv, db);
  await assert.rejects(worker.scheduled(SCHEDULED, env), /the sweep failed for 1 of 2 removed installations/);
  assert.deepEqual(kv.keys(), ["3:verdict:1", "removed:3"], "3 keeps its data and its marker; 4 is swept");
  assert.deepEqual([...db.store.keys()], ["posting_enabled"]);
  assert.equal(lines.length, 1, `one line: ${JSON.stringify(lines)}`);
  const line = JSON.parse(lines[0]);
  assert.deepEqual({ stage: line.stage, installation: line.installation }, { stage: "sweep", installation: 3 });
  assert.match(line.error, /KV delete failed for 3:verdict:1/);
});
