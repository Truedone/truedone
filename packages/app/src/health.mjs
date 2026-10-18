// The production Worker's health endpoint (DEP-01): GET /health answers the deployed
// version and the posting switch, so a deploy can be verified without any write.
// The switch is the one global KV key posting_enabled (APP-09), read uncached on
// every request: on unless it reads off.

export function makeHealth({ version, kv }) {
  return async function health(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/health") return new Response("not found", { status: 404 });
    const flag = kv ? await kv.get("posting_enabled") : null;
    return Response.json(
      { version, posting_enabled: flag !== "off" },
      { headers: { "cache-control": "no-store" } },
    );
  };
}
