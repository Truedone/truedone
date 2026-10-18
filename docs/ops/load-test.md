# The load test

APP-06 replays 1,000 installations' webhook volume against the Worker's own
code in process: the real intake (`makeIntake`) verifying a throwaway HMAC
secret, the real KV dedupe, the real queue handler, and the real static stage
with the GitHub API stubbed in process. Nothing leaves the machine and no real
credential is involved; the contract fixes the output shape and the ratio, not
the host.

## The measured run

`node tools/bench/load.mjs --installs 1000`, measured 2026-10-18:

```json
{"installs":1000,"sent":1000,"acked":1000,"retried":0,"processed_ratio":1,"cpu_ms_per_delivery":0.43,"github_stub_calls":8000,"kv_gets":3000,"kv_puts":1000,"queue_sends":1000,"kv_read_usd_month":64.8,"kv_write_usd_month":216,"queue_usd_month":34.56,"cost_usd_month":330.69,"wall_ms":363}
```

Every one of the 1,000 deliveries was verified, deduped, queued and processed
to an acknowledged stage call: `processed_ratio` is 1, against the contract's
floor of 0.99. The stages made 8 stubbed API calls per delivery (the token
mint, the config read, the pull request lookup, the file list, the two file
contents at the base, the check-run lookup and the label calls).

## The cost model

The model uses Cloudflare's published Workers Paid figures: USD 5 per month
base, 10 million requests included, then USD 0.30 per million requests, and
USD 0.02 per million CPU-milliseconds. The replay measures 0.43 CPU-ms per
delivery; the extrapolation assumes each installation sends one delivery per
minute around the clock, which is 43.2 million deliveries per month for 1,000
installations and about 5.2 CPU-hours.

| line | per month | USD |
|---|---|---|
| base | the Workers Paid plan | 5.00 |
| requests | 43.2M at 0.30 per million over the included 10M | 9.96 |
| CPU | 18.6M CPU-ms at 0.02 per million CPU-ms | 0.37 |
| KV reads | 129.6M at 0.50 per million (three reads per delivery: the dedupe check and the two posting flags) | 64.80 |
| KV writes | 43.2M at 5.00 per million (the dedupe record) | 216.00 |
| Queues | 86.4M operations at 0.40 per million (a send and a delivery per message) | 34.56 |
| **total** | | **330.69** |

The KV and Queues rows were missing from the first publication (lane-b's
review, 2026-10-18): the replay counts three KV reads, one KV write and one
queue send per delivery, and at the bench's own worst-case volume those
dominate the bill. The corrected number prices them from the same replay.

The number is a ceiling: it prices a delivery every minute from every one of
the 1,000 installations, while the observed GitHub Apps volume for a
repository-hosted app is far below one webhook per installation per minute.

## Reproducing

Run `node tools/bench/load.mjs --installs 1000`. The exit code is 0 when the
processed ratio is at least 0.99; the last stdout line is the JSON object this
page quotes.
