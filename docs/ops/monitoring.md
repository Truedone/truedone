# Monitoring

APP-06's three signals land in Workers Analytics Engine through the `METRICS`
binding; the dashboard queries them by index (the pull request number) and the
blobs carry the verdict and the repository id.

## Label latency

Every posted verdict writes one datapoint whose double is the milliseconds
from the delivery's arrival to the label and check run being posted, measured
in `packages/app/src/static.mjs` (pull_request) and
`packages/app/src/redgreen.mjs` (workflow_run). The label latency p50 and p95
come from that datapoint, and the contract's own bench measures them from
GitHub's issue events (`tools/bench/app.mjs`, p50 under 3 s and p95 under
15 s). An email alert goes to Ryan when the p95 datapoint rises above 15
seconds over five minutes (a Cloudflare alert policy on the analytics query).
The posting switch is a D1 row (APP-19): D1 keeps one primary with no
replicas, so a write is read at every location from the next delivery, and a
failed read stops posting. The switch-off smoke still waits 60 s before it
seeds its second pull request, as measured caution.

## Webhook errors

The intake refuses bad signatures and duplicate delivery ids with 4xx answers;
every refused or failed delivery is visible in the Worker's built-in error and
request metrics, and anything the queue cannot process after its retries lands
in the dead-letter queue (`truedone-dev-dlq`, `truedone-dlq`), whose depth is
the error signal. An email alert to Ryan fires when the dead-letter queue is
non-empty.

## Queue age

The queue consumer's oldest-message age is a Cloudflare queue metric; the alert
policy watches it at one minute. The consumer acknowledges in-process work
within seconds (the load test measures 0.38 CPU-ms per delivery), so an age
above a minute means the stages are waiting on GitHub.

## Where the data lives

- `METRICS` (Workers Analytics Engine): one datapoint per posted verdict, the
  verdict and repository id in blobs, the pull request number in the index,
  the milliseconds in the double.
- The dead-letter queues: every delivery that exhausted its retries.
- The Workers dashboard: request, error and CPU metrics per Worker.
