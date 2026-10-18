// The Worker's entry (APP-01, DEP-01, APP-08): one fetch handler routes /health
// and /api/github/webhook; the queue handler routes each queued delivery to the
// stage its event belongs to, acknowledging handled messages and retrying
// failures; the scheduled handler runs APP-05's daily sweep over the removed
// installations' leftovers. Only Web APIs.
import { makeHealth } from "./health.mjs";
import { makeIntake } from "./webhook.mjs";
import { makeStatic } from "./static.mjs";
import { makeRedGreen } from "./redgreen.mjs";
import { sweepLeftovers } from "./posting.mjs";

const REMOVED_PREFIX = "removed:";

export function makeApp(env) {
  const health = makeHealth({ version: env.VERSION ?? "unversioned", postingEnabled: env.POSTING_ENABLED === "true" });
  const intake = makeIntake(env);
  return async function app(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return health(request);
    if (url.pathname === "/api/github/webhook") return intake(request);
    return new Response("not found", { status: 404 });
  };
}

// The stages call GitHub with an installation token minted per delivery from
// the app's private key (S5: the key exists only as a Worker secret).
function pemToPkcs8(pem) {
  const b64 = String(pem).replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function b64url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function mintInstallationToken(env, installationId) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${b64url(new TextEncoder().encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.APP_ID })))}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(env.PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  const r = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { authorization: `Bearer ${input}.${b64url(new Uint8Array(signature))}`, accept: "application/vnd.github+json", "user-agent": "truedone-app" },
  });
  if (!r.ok) throw new Error(`installation token ${r.status}`);
  return (await r.json()).token;
}

// The queue and cron handlers. deps override the stages, the mint and the
// sweep so queue.test.mjs can drive the routing with fakes.
export function makeConsumers(deps = {}) {
  const mint = deps.mint ?? mintInstallationToken;
  const sweep = deps.sweep ?? sweepLeftovers;
  return {
    async queue(batch, env) {
      for (const message of batch.messages) {
        try {
          const { event, delivery } = message.body;
          const installationId = message.body.payload?.installation?.id;
          const token = await mint(env, installationId);
          const stageEnv = { ...env, INSTALLATION_TOKEN: token };
          if (event === "pull_request") {
            await (deps.staticStage ?? makeStatic(stageEnv))(delivery);
          } else if (event === "workflow_run") {
            await (deps.redGreenStage ?? makeRedGreen(stageEnv))(delivery);
          }
          message.ack();
        } catch {
          message.retry();
        }
      }
    },
    async scheduled(controller, env) {
      const names = await env.KV.list({ prefix: REMOVED_PREFIX });
      for (const name of names) {
        const id = Number(String(name).slice(REMOVED_PREFIX.length));
        if (Number.isFinite(id) && id > 0) await sweep(env, id);
      }
    },
  };
}

export default {
  fetch(request, env) {
    return makeApp(env)(request);
  },
  async queue(batch, env) {
    return makeConsumers().queue(batch, env);
  },
  async scheduled(controller, env) {
    return makeConsumers().scheduled(controller, env);
  },
};
