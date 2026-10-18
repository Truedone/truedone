// The truedone GitHub App webhook intake: verify, drop (an uninstall marks and deletes), dedupe, acknowledge, then analyse or queue.
// Runs on Workers: Web Crypto only, no node: imports (APP-01-AC03).
import { markRemoved, deleteInstallationData } from "./posting.mjs";

const WEBHOOK_SECRET_HEADER = "x-hub-signature-256";
const DELIVERY_HEADER = "x-github-delivery";
const EVENT_HEADER = "x-github-event";
const DEDUPE_TTL_S = 24 * 60 * 60; // a delivery id is handled once for 24 hours (S6)

// The actions a stage acts on (APP-16, #111). A pull request is analysed when it opens,
// gets new commits or reopens; closed, labeled (the App's own label write sends one),
// edited, assigned, review_requested and the rest are dropped here, so they cost no
// queue message, no token and no GitHub call. The red-green stage judges a completed
// workflow run only (redgreen.mjs), so requested and in_progress are dropped too.
export const ACTIONS = {
  pull_request: new Set(["opened", "synchronize", "reopened"]),
  workflow_run: new Set(["completed"]),
};

// APP-17 (#108): a pull_request delivery is analysed in the intake, after its answer, in ctx.waitUntil. Cloudflare
// cancels a waitUntil promise 30 s after the response without a throw, so a run still going after DIRECT_BUDGET_MS
// is handed to the queue delayed by QUEUE_DELAY_S, to start after that cancel point and never beside the direct run.
export const DIRECT_BUDGET_MS = 20_000;
export const QUEUE_DELAY_S = 15;
// After a 401 the kept token is deleted, but KV can serve it from a colo's cache for up to 60 s, so the retry waits that
// long before it reads the token again (APP-17, the lead's 4529).
export const REFUSED_RETRY_DELAY_S = 60;

const LATE = Symbol("late");
const logLine = (delivery, error, fields = { stage: "intake" }) => console.error(JSON.stringify({ ...fields, delivery, error: `${error?.name ?? "Error"}: ${error?.message ?? error}` }));

export async function verifySignature(secret, body, header) {
  if (typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const given = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const signature = new Uint8Array(given.length / 2);
  for (let i = 0; i < signature.length; i++) signature[i] = parseInt(given.slice(i * 2, i * 2 + 2), 16);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signature, body);
}

// One worker environment: { WEBHOOK_SECRET, KV: {get,put,delete}, QUEUE: {send} }.
// Both fakes and the real bindings answer the same calls. run(body) is the static stage for one delivery (APP-17);
// without it, or without a ctx to wait on, every delivery is queued.
export function makeIntake(env, { run, budgetMs = DIRECT_BUDGET_MS } = {}) {
  // The direct run, then the queue when it throws or outlasts the budget (delayed, so it never runs beside it). If
  // that send fails too, the delivery's dedupe record is deleted, so a redeliver from the App's delivery log is
  // analysed rather than dropped as a duplicate.
  async function handOver(body, seenKey, opts) {
    try {
      await (opts ? env.QUEUE.send(body, opts) : env.QUEUE.send(body));
    } catch (error) {
      logLine(body.delivery, error);
      await env.KV.delete(seenKey);
    }
  }
  async function direct(body, seenKey) {
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve(LATE), budgetMs); });
    const running = run(body);
    let outcome;
    try {
      outcome = await Promise.race([running, late]);
    } catch (error) {
      logLine(body.delivery, error);
      return handOver(body, seenKey, error?.status === 401 ? { delaySeconds: REFUSED_RETRY_DELAY_S } : undefined);
    } finally {
      clearTimeout(timer);
    }
    if (outcome !== LATE) return;
    running.catch(() => {});   // the queue has it now; a late failure changes nothing
    return handOver(body, seenKey, { delaySeconds: QUEUE_DELAY_S });
  }

  return async function intake(request, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/github/webhook") {
      return new Response("not found", { status: 404 });
    }
    const body = await request.arrayBuffer();
    const signature = request.headers.get(WEBHOOK_SECRET_HEADER);
    if (!(await verifySignature(env.WEBHOOK_SECRET, body, signature))) {
      return new Response("signature", { status: 401 });
    }
    const delivery = request.headers.get(DELIVERY_HEADER);
    const event = request.headers.get(EVENT_HEADER) || "";
    if (!delivery) return new Response("delivery", { status: 400 });

    // The drops come before the dedupe (APP-23): a dropped delivery makes no KV call, and another copy of it is
    // dropped again with the same answer. Most deliveries are drops: the App's own label write sends a labeled one for
    // every pull request, and each CI run sends requested and in_progress. The payload is parsed first, so a body that
    // does not parse leaves no record and a redeliver of it is handled.
    const payload = JSON.parse(new TextDecoder().decode(body));

    // Events for removed installations are dropped (S6), not queued. An uninstall marks the installation removed before
    // it answers, then deletes its data at once (APP-24, R6): after the answer in ctx.waitUntil, or inline with no ctx. A
    // delete that fails or is cut off leaves the marker, and the daily sweep deletes the rest within 24 hours, with
    // anything a raced delivery writes later. Marking is idempotent, so it needs no dedupe.
    if (event === "installation" && payload.action === "deleted") {
      const id = payload.installation?.id;
      if (Number.isInteger(id) && id > 0) {
        await markRemoved(env, id);
        const deleting = deleteInstallationData(env, id).catch((error) => logLine(delivery, error, { stage: "uninstall", installation: id }));
        if (typeof ctx?.waitUntil === "function") ctx.waitUntil(deleting);
        else await deleting;
      }
      return Response.json({ dropped: "installation_deleted" }, { status: 200 });
    }
    if (event === "installation_repositories" && payload.action === "removed") {
      return Response.json({ dropped: "installation_repositories_removed" }, { status: 200 });
    }
    if (Object.hasOwn(ACTIONS, event) && !ACTIONS[event].has(payload.action)) {
      return Response.json({ dropped: `${event}.${payload.action}` }, { status: 200 });
    }

    // Each kept delivery id is handled once (S6): the KV record expires after 24 hours.
    const seenKey = `delivery:${delivery}`;
    const seen = await env.KV.get(seenKey);
    if (seen) return new Response("duplicate", { status: 200 });
    await env.KV.put(seenKey, "1", { expirationTtl: DEDUPE_TTL_S });

    if (event === "pull_request" && run && typeof ctx?.waitUntil === "function") {
      ctx.waitUntil(direct({ event, delivery, payload }, seenKey));
      return Response.json({ analysing: event }, { status: 200 });
    }
    await env.QUEUE.send({ event, delivery, payload });
    return Response.json({ queued: event }, { status: 200 });
  };
}
