// The Worker's entry (APP-01, DEP-01): wrangler.toml names this file as main. One fetch handler
// routes /health to the health endpoint and /api/github/webhook to the intake; every other path is
// 404. VERSION and POSTING_ENABLED arrive as Worker vars at deploy time (deploy.yml); with neither
// set the health answer says "unversioned" and posting is off. Only Web APIs.
import { makeHealth } from "./health.mjs";
import { makeIntake } from "./webhook.mjs";

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

export default {
  fetch(request, env) {
    return makeApp(env)(request);
  },
};
