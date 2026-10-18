// The truedone GitHub App webhook intake: verify, dedupe, drop, acknowledge, queue.
// Runs on Workers: Web Crypto only, no node: imports (APP-01-AC03).

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

// One worker environment: { WEBHOOK_SECRET, KV: {get,put}, QUEUE: {send} }.
// Both fakes and the real bindings answer the same three calls.
export function makeIntake(env) {
  return async function intake(request) {
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

    // Each delivery id is handled once (S6): the KV record expires after 24 hours.
    const seenKey = `delivery:${delivery}`;
    const seen = await env.KV.get(seenKey);
    if (seen) return new Response("duplicate", { status: 200 });
    await env.KV.put(seenKey, "1", { expirationTtl: DEDUPE_TTL_S });

    const payload = JSON.parse(new TextDecoder().decode(body));

    // Events for removed installations are dropped (S6), not queued.
    if (event === "installation" && payload.action === "deleted") {
      return Response.json({ dropped: "installation_deleted" }, { status: 200 });
    }
    if (event === "installation_repositories" && payload.action === "removed") {
      return Response.json({ dropped: "installation_repositories_removed" }, { status: 200 });
    }
    if (Object.hasOwn(ACTIONS, event) && !ACTIONS[event].has(payload.action)) {
      return Response.json({ dropped: `${event}.${payload.action}` }, { status: 200 });
    }

    await env.QUEUE.send({ event, delivery, payload });
    return Response.json({ queued: event }, { status: 200 });
  };
}
