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
`truedone`, with the dead-letter queues `truedone-dev-dlq` (`d817d88626ad447b947075ea794fca9f`) and `truedone-dlq`
(`b42a4a0222d547989d9934cf5f62a7c4`), created on 2026-10-18 and named by `packages/app/wrangler.toml`. Both Workers answer
`/health` with the deployed commit and the posting switch: on for the development app, off for the production app.

The posting switch (APP-19, #107) is the D1 table `flags (key TEXT PRIMARY KEY, value TEXT NOT NULL)`, in the databases
`truedone-dev-flags` and `truedone-flags`, created in Eastern North America, where the webhook deliveries arrive (IAD). D1 answers
every location from one primary, so the read after a write sees it: turning the switch off stops posting from the next delivery,
with no deploy. A Workers KV key could not promise that, since KV reaches other locations up to a minute or more after a write and
caches a read for 60 s. The row `posting_enabled` is on only when it reads `on`: a missing row is off, so an unseeded database
never posts. A row `posting_enabled:<installation id>` that reads `off` stops that installation alone, and the uninstall deletes
it. If the database cannot be read, nothing posts (the delivery waits in the queue and is retried) and `/health` answers 503.
The switch tool writes the row with `wrangler d1 execute <database> --remote`.

An uninstall deletes the installation's stored data within 24 hours (R6; APP-24, #122). On `installation.deleted` the intake
writes the KV marker `removed:<installation id>` before it answers, then deletes the installation's `<id>:` keys, its kept token
`token:<id>` and its row `posting_enabled:<id>`, after the answer. The daily cron (`13 4 * * *`) runs the same deletion for every
marker, so it catches a delete that failed or was cut off and anything a delivery in flight wrote afterwards, and it deletes the
marker last. An installation whose sweep fails keeps its marker for the next day, the others are still swept, and the cron run
fails with one log line per failed installation (`"stage": "sweep"`). Labels, check runs and comments already written stay,
since they belong to the repository.

The development app belongs to the Truedone organisation since 2026-10-18 (D36), with the repositories; its installation on
the old account ended with the transfer.

Open: the development app is installed only on `Truedone/truedone-sandbox`. Its first installation landed on this repository by
mistake; I moved it to the sandbox on 2026-10-18, and the Worker logged the sandbox's deliveries from then on. The production app
is installed nowhere, with posting off, until the app is offered (REL-W4). It is private, and GitHub lets only its owner authorize
a private app, so the sign-in on truedone.pages.dev, which uses its client, works for me alone until it is public.
