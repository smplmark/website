# smplkit.com/scheduler-latency — source of record

The Scheduler Latency benchmark is an API-backed resource on app.smplmark.org
(benchmark id `51e42d4d-7092-44e6-a335-c724c13307ec`). This file is the
source-of-record for its authored text fields. To apply an edit, PUT the full
attribute set (the endpoint is full-replace — always resend
`measurement_schema`, `subject_type`, `category`, and `tags` alongside the text
fields) to `https://app.smplmark.org/api/v1/benchmarks/{id}`.

The methodology renderer supports headings, lists, block quotes, inline
code, links, and emphasis — not pipe tables. Tabular content is authored as
lists.

## description

A measure of HTTP-based job scheduler latency (how "on time" various job schedulers fire).

## methodology

Each scheduler is configured to execute a single HTTP POST to `https://app.smplmark.org/api/v1/measurements` every 60 minutes, at the top of the hour. The receiver records the date/time each request arrives; the derived metric is the number of milliseconds past the top of the hour — the skew. The lower the skew, the more on time the scheduler.

**How arrival time is captured.** The receiver is a Cloudflare Worker; the received-at timestamp is read from the Worker's clock in the application-layer request handler, after the request body is parsed and the sending run is authorized against the database — not at the network edge. Workers advance their clock only at I/O boundaries (a Spectre mitigation), so the stamp reflects the platform clock as of the last of those database reads, a few milliseconds after the first byte arrives. Cloudflare publishes no accuracy specification for that clock; it is visibly stable across days, but its absolute discipline is Cloudflare's, not ours. The receiver is identical for every subject, so its overhead is a constant, not a bias between contestants.

**The wrap.** Skew is computed modulo the hour, so a scheduler that fires 61 minutes late reads as 1 minute late — and a request that arrived early would read as nearly an hour late. Most schedulers don't expose the intended fire time to the request payload (AWS EventBridge Scheduler is an exception — it can inject the scheduled time via context attributes), and we configured all ten subjects identically rather than special-casing the one that can. So we measure at the receiver and accept the wrap. In practice the only subject that gets near it is GitHub Actions, which misses by wild margins, not by seconds.

**Geography.** The receiver operates in US-East. Schedulers firing from US-West or Europe pay a network tax of a few milliseconds that US-East schedulers — including Smpl Jobs, which runs in AWS us-east-1 — do not. The scheduling engine's own latency dominates the results.

**Configuration.** Each subject is configured for a single hourly job at the top of the hour. Most run on the vendor's free tier; the couple that bill at all cost on the order of a dollar a month (per-subject tiers: TBD (Mike)).

- **AWS EventBridge Scheduler** — hourly, top of the hour; region: TBD (Mike); flexible time window: TBD (Mike; expected: Off).
- **Cloudflare Workers** — hourly cron trigger, top of the hour; runs on Cloudflare's network (no region to choose).
- **cron-job.org** — hourly, top of the hour; region: TBD (Mike).
- **EasyCron** — hourly, top of the hour; region: TBD (Mike).
- **GitHub Actions** — hourly `schedule` cron, top of the hour; GitHub-hosted runners (no region to choose).
- **Google Cloud Scheduler** — hourly, top of the hour; region: TBD (Mike).
- **Posthook** — hourly, top of the hour; region: TBD (Mike).
- **QStash** — hourly schedule, top of the hour; region: TBD (Mike).
- **Runhooks** — hourly, top of the hour; region: TBD (Mike).
- **Smpl Jobs** — hourly, top of the hour; AWS us-east-1.

**Changelog.**

- July 19, 2026: measurement began with seven subjects — AWS EventBridge, cron-job.org, EasyCron, GitHub Actions, Google Cloud Scheduler, Posthook, and Smpl Jobs.
- July 20, 2026: Smpl Jobs shipped dispatch-overhead compensation — the worker starts 250 ms early to absorb internal dispatch latency. The change applies to all customers. Windows cited in the smplkit article start after this date.
- July 21, 2026: Cloudflare Workers and QStash joined the board.
- July 22, 2026: Runhooks joined the board.

**Disputes.** Every subject's configuration is listed above, and the benchmark never stops running. A faster scheduler shows up on the board within the hour. That's the appeals process.

Published by smplkit.com. smplmark.org is owned and operated by smplkit.com; Smpl Jobs is a smplkit product and a subject on this board.
