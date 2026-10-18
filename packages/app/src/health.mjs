// The production Worker's health endpoint (DEP-01): GET /health answers the deployed
// version and the posting switch, so a deploy can be verified without any write.

export function makeHealth({ version, postingEnabled }) {
  return function health(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/health") return new Response("not found", { status: 404 });
    return Response.json(
      { version, posting_enabled: postingEnabled === true },
      { headers: { "cache-control": "no-store" } },
    );
  };
}
