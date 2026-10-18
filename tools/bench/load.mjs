#!/usr/bin/env node
// The APP-06 load bench (AC04): replays 1,000 installations' webhook volume
// against the Worker's own code in-process — the real intake with a throwaway
// HMAC secret, the real KV dedupe, the real queue handler and the real stages,
// with the GitHub API stubbed so nothing leaves the machine. Prints one JSON
// object on the last line: {"processed_ratio", "cost_usd_month"}.
//
// The cost model follows Cloudflare's published Workers Paid figures (10M
// requests included, then $0.30 per million; CPU time at $0.02 per million
// CPU-ms): requests per delivery and CPU-ms per delivery are measured here and
// extrapolated to a month at the replayed per-delivery rate.
import { createHmac } from "node:crypto";
import { makeIntake } from "../../packages/app/src/webhook.mjs";
import { makeConsumers } from "../../packages/app/src/index.mjs";
import { makeStatic } from "../../packages/app/src/static.mjs";
import { makeRedGreen } from "../../packages/app/src/redgreen.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const INSTALLS = arg("installs", 1000);
const SECRET = "throwaway-load-secret-not-a-real-credential";

function memoryKV() {
  const store = new Map();
  return {
    store,
    async get(k) { const e = store.get(k); return e === undefined ? null : e.v; },
    async put(k, v, opts = {}) { store.set(k, { v, ttl: opts.expirationTtl ?? null }); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return [...store.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

function sign(body) {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}

// The stub GitHub API: check runs, labels, PR files and the raw host answer
// from fixed shapes; every call is counted for the cost model. The raw host
// returns text, the API routes return JSON, as the app tests' fakes do.
function stubFetch(counts) {
  return async (url, init = {}) => {
    counts.api += 1;
    const u = String(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) });
    const text = (body) => ({ ok: true, status: 200, json: async () => ({}), text: async () => body });
    if (u.includes("/app/installations/") && u.includes("/access_tokens")) return json({ token: "stub-token" });
    if (u.includes("/pulls/") && u.includes("/files")) return json([
      { path: "src/a.mjs", status: "modified", patch: "@@ -1 +1 @@" },
      { path: "test/a.test.mjs", status: "added", patch: "@@ +1" },
    ]);
    if (u.includes("/check-runs")) return json({ check_runs: [], id: 1 });
    if (u.endsWith("/labels")) return json([]);
    if (u.includes("raw.githubusercontent.com")) return u.includes("truedone.yml") ? text("comments: on\n") : text("export const V = 2;\n");
    return json({});
  };
}

const VERDICT = { schema: "truedone.verdict/1", verdict: "proven", label: null, partial: false, reasons: [{ check: "x", file: "test/a.test.mjs", message: "it fails on base" }], next: null };

async function main() {
  const kv = memoryKV();
  const counts = { api: 0, kvGet: 0, kvPut: 0, queueSend: 0 };
  const kvGet = kv.get.bind(kv);
  const kvPut = kv.put.bind(kv);
  kv.get = async (k) => { counts.kvGet += 1; return kvGet(k); };
  kv.put = async (k, v, o) => { counts.kvPut += 1; return kvPut(k, v, o); };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(counts);
  const queued = [];
  const queue = { async send(body) { counts.queueSend += 1; queued.push(body); } };
  // APP-19: the posting switch reads the D1 table flags. The stub answers the
  // one query with the global row on and no installation row, which reads on.
  const FLAGS = {
    prepare() {
      return {
        bind(...keys) {
          return {
            async all() {
              return { results: keys.filter((k) => k === "posting_enabled").map((k) => ({ key: k, value: "on" })) };
            },
          };
        },
      };
    },
  };
  const intakeEnv = { ...process.env, WEBHOOK_SECRET: SECRET, KV: kv, QUEUE: queue, FLAGS };
  const intake = makeIntake(intakeEnv);

  // The replay: one pull_request opened delivery per installation.
  const started = Date.now();
  const cpuStart = process.cpuUsage().user;
  let sent = 0;
  for (let i = 1; i <= INSTALLS; i++) {
    const payload = {
      action: "opened",
      installation: { id: i },
      repository: { id: 1000 + i, owner: { login: "o" }, name: `r${i}` },
      pull_request: { number: 1, head: { sha: `h${i}`, ref: "main" }, base: { ref: "main", sha: `b${i}` }, title: "load", body: "load", user: { login: "u" } },
    };
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const request = new Request("https://worker.example/api/github/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(body), "x-github-delivery": `d-${i}`, "x-github-event": "pull_request" },
      body,
    });
    const response = await intake(request);
    if (response.status === 200) sent += 1;
  }

  // The drain: the real queue handler with the real stages against the stub API.
  let acked = 0;
  let retried = 0;
  const staticStage = makeStatic({ INSTALLATION_TOKEN: "stub-token", KV: kv, FLAGS, core: { analyse: async () => VERDICT }, LOG: undefined, RELEASE_SHA_CACHE: [] });
  const redGreenStage = makeRedGreen({ INSTALLATION_TOKEN: "stub-token", core: { judge: async () => VERDICT }, staticResult: () => ({}), staticVerdict: () => null, defaultStepSha: async () => "step1", publishedShas: async () => [], postCheck: async () => {}, postLabel: async () => {}, UNZIP: async (buf) => ({ entries: [{ data: new Uint8Array() }] }) });
  const handler = makeConsumers({
    mint: async () => "stub-token",
    staticStage,
    redGreenStage,
    sweep: async () => 0,
  });
  const messages = queued.map((body) => fakeMessage(body));
  for (let i = 0; i < messages.length; i += 10) {
    await handler.queue({ messages: messages.slice(i, i + 10) }, { ...intakeEnv });
  }
  for (const m of messages) { if (m.acked) acked += 1; if (m.retried) retried += 1; }
  const cpuUsed = (process.cpuUsage().user - cpuStart) / 1000;

  const processed_ratio = sent ? acked / sent : 0;
  const perMonth = INSTALLS * 30 * 24 * 60; // one delivery per install per minute, worst case
  const requestCost = Math.max(0, (perMonth - 10_000_000) / 1_000_000) * 0.30;
  const cpuCost = ((cpuUsed / Math.max(messages.length, 1)) * perMonth / 1_000_000) * 0.02;
  // KV and Queues priced at Cloudflare's published figures (lane-b's review
  // item 3): reads USD 0.50 per million, writes USD 5.00 per million, queue
  // operations USD 0.40 per million, a send and a delivery per message.
  const scale = perMonth / Math.max(INSTALLS, 1);
  const kvReadCost = ((counts.kvGet * scale) / 1_000_000) * 0.50;
  const kvWriteCost = ((counts.kvPut * scale) / 1_000_000) * 5.0;
  const queueCost = ((counts.queueSend * 2 * scale) / 1_000_000) * 0.4;
  const cost_usd_month = Math.round((5 + requestCost + cpuCost + kvReadCost + kvWriteCost + queueCost) * 100) / 100;
  globalThis.fetch = oldFetch;

  console.log(JSON.stringify({ installs: INSTALLS, sent, acked, retried, processed_ratio: Math.round(processed_ratio * 10000) / 10000, cpu_ms_per_delivery: Math.round((cpuUsed / Math.max(messages.length, 1)) * 100) / 100, github_stub_calls: counts.api, kv_gets: counts.kvGet, kv_puts: counts.kvPut, queue_sends: counts.queueSend, kv_read_usd_month: Math.round(kvReadCost * 100) / 100, kv_write_usd_month: Math.round(kvWriteCost * 100) / 100, queue_usd_month: Math.round(queueCost * 100) / 100, cost_usd_month, wall_ms: Date.now() - started }));
  process.exit(processed_ratio >= 0.99 ? 0 : 1);
}

function fakeMessage(body) {
  return { body, acked: 0, retried: 0, ack() { this.acked++; }, retry() { this.retried++; } };
}

main();
