# The GitHub Apps

I registered both apps on 2026-10-18 from `packages/app/app-manifest.json` through GitHub's manifest flow (OPS-02, D26). The
manifest lists `pull_request` and `workflow_run`; GitHub refused `installation` and `installation_repositories` as subscribed
events, because every app receives them without subscribing (APP-02, contract v2l).

| App | Id | Slug | Worker | Webhook |
|---|---|---|---|---|
| truedone-dev (development) | 5363933 | `truedone-dev` | `truedone-dev.ledgerguard-global.workers.dev` | `/api/github/webhook` on that Worker |
| truedone (production) | 5364032 | `truedone` | `truedone.ledgerguard-global.workers.dev` | `/api/github/webhook` on that Worker |

Each app's private key, webhook secret and OAuth client secret, with its app id and client id, exist only as secrets of its
Worker (`WEBHOOK_SECRET`, `PRIVATE_KEY`, `CLIENT_SECRET`, `APP_ID`, `CLIENT_ID`), written straight from the manifest exchange
with `wrangler secret put`; the exchange file was removed and no copy exists on any machine or in this repository (S5). The
production app's client id and secret are also secrets of the sign-in exchange Worker `truedone-exchange` (WEB-02).

Cloudflare resources for the Workers (APP-08 declares them): KV namespaces `worker-truedone-dev-kv`
(`5e2652856f244451ab9bfe9ecc1d0c2d`) and `worker-truedone-kv` (`df78deb9ed7d4936b92678778d739f73`); queues `truedone-dev` and
`truedone`. Both Workers answer `/health` with the deployed commit.

Open: the development app is installed only on `mgillr/truedone-sandbox`; the production app is installed nowhere until the
app is offered (REL-W4). The dead-letter queues `truedone-dev-dlq` and `truedone-dlq` are created when I say so.
