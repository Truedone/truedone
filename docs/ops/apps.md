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

A queued delivery holds no pull request text (APP-25, #125). The intake queues, for each event, only the fields its stage reads:
the action, the installation id and the repository's id, owner and name, with a pull request's number and base and head shas, or
a workflow run's id, head sha, head repository, conclusion and jobs URL. The stages read only those fields, so a message queued
in the full shape is handled the same way. A queued pull request run reads the pull request from GitHub with the installation
token, so it analyses the title, body and author as they stand when it runs, while its check and label are still written at
the queued head commit. The direct run in the intake analyses the delivery it has just received and makes no extra call. Each
dead-letter queue has a consumer in the same Worker that logs one line per message (`"stage": "dead-letter"`, with the queue,
the delivery id, the event and the attempts) and acknowledges it, so nothing waits there for Cloudflare's four days. On
2026-10-18 at 20:58Z `truedone-dev-dlq` held 386 messages in the full shape (6,633,339 bytes) and `truedone-dlq` held 1. The
first deploy with these consumers acknowledges them.

The dedupe runs beside the stage (APP-26). A kept delivery waited 296 ms at p50 (n=30) for the KV read of `delivery:<id>` and
then its write before its stage started, inside the opened-to-label time GitHub measures (PV-A03). For a pull_request delivery
run in the intake, the stage now starts at once, and the read and, for a new delivery, the write run beside its switch and read
phases. The check run and the label, and any hand-over to the queue, wait for that verdict, so a duplicate writes nothing, and
the answer to GitHub waits for it too: `{analysing}`, `duplicate`, or a 500 when KV fails, as before. A queued delivery is still
deduped before its send. The read and the write are not one atomic step and KV reaches other locations up to a minute after a
write, so two copies of one delivery id within about a minute can both pass; that was so before APP-26, and closing it needs a
strongly consistent record, such as a D1 insert on the id.

The red-green stage believes a report only when its `proved_step` is the truedone step the repository's default branch pins,
or the commit of a published release (PV-A06; APP-27, #164). The step counts in either form, `Truedone/truedone-action@<sha>`
or the interim `Truedone/truedone/packages/action@<sha>`, and only when it is pinned by a full 40-hex SHA on a step's `uses:`
line: `@main`, a tag or a short SHA names no commit and matches nothing, and so does a comment or a step of another
repository, the action's old address on the mgillr account included. The published releases are the tags of
`Truedone/truedone-action`. Until APP-27 the App read the tags of `truedone/action`, which answers 404, and matched only the
first form, so the sandbox's interim step was never found. On 2026-10-19 `Truedone/truedone-action` had no tags, so for now a
report is believed only through the default branch's step. Each refused report logs one line (`"stage": "red-green"`, with
the delivery id, the repository id, the pull request number and the reason in `refused`) and writes nothing.

The development app belongs to the Truedone organisation since 2026-10-18 (D36), with the repositories; its installation on
the old account ended with the transfer.

Open: the development app is installed only on `Truedone/truedone-sandbox`. Its first installation landed on this repository by
mistake; I moved it to the sandbox on 2026-10-18, and the Worker logged the sandbox's deliveries from then on. The production app
is installed nowhere yet, with posting off.

The production app is public since 2026-10-18 (D35), so anyone can install it from https://github.com/apps/truedone and sign in
on truedone.pages.dev. Its posting stays off until the development app's smoke passes on the sandbox. I set its page the same day,
and `packages/app/app-manifest.json` records it: the description, the homepage https://truedone.pages.dev, the logo
(`packages/app/logo.svg`, uploaded as `logo.png` on the badge colour #0d1117) and one callback, the site's `/signin/callback`. I
removed the setup URL and the callback `/api/github/callback`: the Worker routes only `/health` and `/api/github/webhook`, so both
answered 404, and a new user would have landed on an error page after installing. Ryan read the settings page back the same day
and approved it: description saved, one callback, no setup URL, logo set, badge #0d1117. `node tools/app-listing-check.mjs`
reads the public page without a token and fails unless it equals the manifest (description, homepage, permissions, events); with
`--urls` it also reads the homepage and each callback live and fails on any answer other than 200 or a redirect.
