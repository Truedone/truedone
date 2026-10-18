// The production Worker's health endpoint (DEP-01): GET /health answers the deployed
// version and the posting switch, so a deploy can be verified without any write.
// The switch is the global row posting_enabled of the D1 table flags (APP-19), read on
// every request, as the write path reads it: on only when it reads "on". A read that
// fails answers 503 rather than guess.
import { readSwitch } from "./posting.mjs";

export function makeHealth({ version, flags }) {
  return async function health(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/health") return new Response("not found", { status: 404 });
    const headers = { "cache-control": "no-store" };
    let on;
    try {
      on = (await readSwitch(flags)).global;
    } catch {
      return Response.json({ version, error: "the posting switch could not be read" }, { status: 503, headers });
    }
    return Response.json({ version, posting_enabled: on }, { headers });
  };
}
