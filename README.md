# CompetitorPulse

CompetitorPulse tracks competitor product listings over time. A scheduler polls the listing source, decides which differences matter to a product manager, and asks an LLM to explain each change in plain English. A small React UI shows the competitor list and a timeline per competitor.

- **Live instance:** TODO: fill in after deploying. The system is **not deployed yet**; the deployment files and procedure are ready (see [Deploy to a VPS](#deploy-to-a-vps)).

Terms follow the domain language of the project: a **Competitor** is tracked by id, each attempt to fetch its listing is a **Poll**, every Poll is stored as a **Snapshot**, and a **Change** is a difference that matters, compared with the **Baseline** (the last successful Poll).

## Run it

### With Docker Compose (everything, including the provided source and mock LLM)

```sh
docker compose up --build
```

| What            | URL                                                                  |
| --------------- | -------------------------------------------------------------------- |
| UI              | http://localhost:8080                                                |
| API             | http://localhost:3000 (the UI also proxies `/api` on :8080)          |
| Listing source  | http://localhost:4002 (from `files/listing-source`, unchanged)       |
| Mock LLM        | http://localhost:4001 (from `files/mock-llm`, unchanged)             |
| Health endpoint | http://localhost:3000/api/health (Poll lag and remaining LLM budget) |

The backend applies database migrations at every start, before the scheduler runs, so there is no separate setup step. Settings in the compose file can be overridden from the shell or from a `.env` file next to `docker-compose.yml`, for example `POLL_INTERVAL_SECONDS=60 docker compose up --build`.

### Local development

Requirements: Node 22, Postgres 17 (or `docker compose up -d postgres`), Python 3 (for the mock LLM), and the source running.

```sh
npm ci                                   # installs both workspaces and the git hook
cp .env.example .env                     # then export it, or set the variables in your shell
docker compose up -d postgres listing-source mock-llm   # or start the provided servers by hand
npm run migrate -w backend               # one command sets up the database
npm run dev -w backend                   # API and scheduler on :3000
npm run dev -w frontend                  # UI on :5173, proxies /api to :3000
```

The backend reads the process environment only; it does not load `.env` itself (for example `set -a; . ./.env; set +a`).

New schema change: edit `backend/src/db/schema.ts`, then `npm run db:generate -w backend`. A migration that was already applied is never edited.

### Tests and checks

```sh
npm run format:check && npm run lint && npm run typecheck
npm test                                  # unit and integration tests
npm run test:e2e                          # Playwright, see below
```

- Integration tests need Postgres and the environment variable `TEST_DATABASE_URL`, for example `postgres://competitor_pulse:competitor_pulse@localhost:5432/competitor_pulse`. Use a database you do not mind having tables created in. Without it, the integration tests fail with a clear message.
- The integration tests start the provided source (`node`) and mock LLM (`python3`) from `files/` on free ports and drive them through their `/control/*` endpoints. They do not read `listings.json`.
- `npm run test:e2e` runs Playwright against a running system (`docker compose up --build`, then `npx playwright install chromium` once). It covers a change with a summary, an LLM failure that still keeps the Snapshot, and an unknown id. Variables: `E2E_BASE_URL` (default `http://localhost:8080`), `E2E_SOURCE_URL` (default `http://localhost:4002`), `E2E_LLM_CONTROL_URL` (default `http://localhost:4001`). Start the system with a short `POLL_INTERVAL_SECONDS` (CI uses `3`) so a scenario sees a Poll within seconds. The scenarios reset the source and mock LLM, so do not run them against an instance someone else uses.
- CI (`.github/workflows/ci.yml`) runs format, lint, typecheck, migrations on a clean Postgres, all tests, `docker compose build`, and the e2e suite against `docker compose up`.

## Which LLM is used and how to configure it

The default is the **provided mock LLM** (`files/mock-llm`). It speaks the OpenAI Chat Completions shape and echoes its input, so summaries in the default setup are not real prose; they only prove that the call, the budget, and the failure handling work.

The backend talks to any **OpenAI Chat Completions compatible** endpoint, so switching to a real provider or a local model is configuration only. There is no provider-specific client.

| Variable       | Mock LLM (default)        | Example: OpenAI                     | Example: Ollama                        |
| -------------- | ------------------------- | ----------------------------------- | -------------------------------------- |
| `LLM_BASE_URL` | `http://mock-llm:4001/v1` | `https://api.openai.com/v1`         | `http://host.docker.internal:11434/v1` |
| `LLM_API_KEY`  | `mock-key` (not checked)  | your key                            | any non-empty string                   |
| `LLM_MODEL`    | `mock-llm`                | a chat model name from the provider | the model you pulled                   |

Put the real key in an untracked `.env` file or in the shell, never in a committed file. The examples above are not tested against those providers; only the mock LLM has been used.

What happens when the LLM misbehaves: the Snapshot of a Poll is saved first, and the Summary is written afterwards in the background, so the Poll result never depends on the LLM. The user sees one of these Summary statuses instead of a summary:

| Summary status     | Meaning shown to the user                                       |
| ------------------ | --------------------------------------------------------------- |
| `ready`            | A summary exists.                                               |
| `pending`          | A Change was found and the summary is being written.            |
| `not_applicable`   | Nothing changed (or the Poll failed or was incomplete).         |
| `llm_timeout`      | The model took longer than `LLM_TIMEOUT_MS`.                    |
| `llm_failed`       | The provider answered with an error or could not be reached.    |
| `llm_unusable`     | The answer failed validation (wrong shape, empty, or too long). |
| `budget_exhausted` | The Daily LLM budget or the Hourly allowance is used up.        |

There are no retries: one LLM call per Change at most.

## Point it at another Source

The source is an external website; the backend only talks to it over HTTP and never imports its code or reads its data files.

- Compose: `SOURCE_BASE_URL=http://my-source:4002 docker compose up --build` (the provided `listing-source` container still starts; it is simply unused).
- Local: set `SOURCE_BASE_URL` in the environment.

The backend requests `GET {SOURCE_BASE_URL}/listings/:id`. The same applies to the LLM through `LLM_BASE_URL`.

## Configuration reference

All configuration is environment variables, validated at startup with zod. An invalid value stops the process with a message naming the variable (values are never printed). `.env.example` has the local defaults; `docker-compose.yml` passes the same variables to the backend.

| Variable                     | Default  | Meaning                                                                                            |
| ---------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `PORT`                       | `3000`   | API port.                                                                                          |
| `LOG_LEVEL`                  | `info`   | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`. Logs are structured JSON.         |
| `DATABASE_URL`               | required | Postgres connection string.                                                                        |
| `SOURCE_BASE_URL`            | required | Base URL of the listing source (`http` or `https`).                                                |
| `SOURCE_TIMEOUT_MS`          | `10000`  | Timeout of every request to the source. The provided source can hold a request open for 8 s.       |
| `SOURCE_REQUESTS_PER_SECOND` | `4`      | Request rate to the source across all Competitors. Keep it below the source's own limit (5).       |
| `LLM_BASE_URL`               | required | OpenAI-compatible base URL, ending in `/v1`.                                                       |
| `LLM_API_KEY`                | required | Key sent to the LLM endpoint. Never logged.                                                        |
| `LLM_MODEL`                  | required | Model name.                                                                                        |
| `LLM_TIMEOUT_MS`             | `20000`  | Timeout of one LLM call.                                                                           |
| `LLM_DAILY_CAP`              | `2000`   | Hard cap of LLM calls per UTC day.                                                                 |
| `LLM_BUDGET_WINDOWS_PER_DAY` | `24`     | Number of windows the cap is spread over (24 gives the Hourly allowance; `1` turns spreading off). |
| `POLL_INTERVAL_SECONDS`      | required | How often each Competitor is polled. Compose default `900` (15 minutes).                           |
| `SCHEDULER_TICK_MS`          | `1000`   | How often the scheduler looks for Competitors that are due.                                        |
| `POLL_MAX_IN_FLIGHT`         | `4`      | Maximum Polls running at once.                                                                     |

For the VPS override only: `SITE_ADDRESS` (see below). Test and e2e variables are described above.

## API

```
GET    /api/competitors                  -> [{ id, lastChangedAt, changedInLast24h, lastPolledAt, lastPollStatus, ... }]
POST   /api/competitors  { "id": "..." } -> 201 (422 if the source does not know the id)
DELETE /api/competitors/:id              -> 204
GET    /api/competitors/:id/snapshots    -> [Snapshot, ...]   newest first
GET    /api/health                       -> { status, pollLagSeconds, llmBudget }
```

A Snapshot has the fields of the brief plus `pollStatus` (`ok`, `failed`, `incomplete`, `delisted`), `summaryStatus` (table above), `failureReason`, and `priceParts` (amount, currency, period). The UI turns `summaryStatus` and `failureReason` into a sentence, so it always tells the user why a summary is missing.

## How the production numbers are handled

The brief asks for 6,000 Competitors polled every 15 minutes, a source limit of 5 requests per second, 2,000 LLM calls per day, and 90 days of history. These do not all fit together. This is what the system does about each.

**6,000 Competitors, every 15 minutes, 5 requests per second.** 6,000 Polls in 900 seconds need 6.67 requests per second, which is above the source's limit of 5. The system never breaks the limit; it lets the interval stretch instead.

- A token bucket holds the request rate at `SOURCE_REQUESTS_PER_SECOND` (default **4**), leaving headroom below 5 for `429` answers and for the source counting differently from us. Every source request goes through it.
- At 4 requests per second, one pass over 6,000 Competitors takes 1,500 seconds, so the **effective interval is about 25 minutes**, not 15. `POLL_INTERVAL_SECONDS` is the target; the real interval is the larger of the target and what the rate allows.
- The scheduler ticks every second and takes the Competitors whose `next_poll_at` is in the past, **most overdue first**, up to `POLL_MAX_IN_FLIGHT`. `next_poll_at` lives in Postgres, so a restart loses nothing.
- On `429` the whole scheduler pauses for the `Retry-After` time, because the limit is global.
- **Poll lag** (how overdue the most overdue Competitor is) is exposed in `GET /api/health`, so the stretch is visible.
- Not built, only described: adaptive intervals (poll rarely changing Competitors less often), asking the source owner for a higher limit, and sharding the Competitors across several backend instances behind one shared rate budget.

**2,000 LLM calls per day.** The cap is hard and cannot be lost on a restart.

- The counter is in Postgres, per UTC day. A slot is **reserved atomically before the call** (`UPDATE ... WHERE used < cap`), so concurrent calls cannot pass the cap and a crash cannot hide a call.
- The slot is given back only when the request provably never left (for example, connection refused). After a timeout, a `5xx`, or unusable output it is kept, because the provider may have billed the call. A crash between reservation and call loses one slot: the system under-uses the cap and never exceeds it.
- The day is spread over hours: the **Hourly allowance** is about 83 calls (2,000 / 24), and the unused part of an hour carries over to later hours of the same UTC day. The daily cap stays hard. Both counters are updated in one atomic statement.
- When the budget is gone, the Snapshot is kept with no summary and Summary status `budget_exhausted`. There is no backfill the next day.
- Delisting and return after delisting have fixed summary text and do not use the LLM.

**90 days of history, including polls with no change and failed polls.** Every Poll writes one narrow Snapshot row, whatever its status; the raw source response is not stored (it is mostly noise). At 6,000 Competitors, 96 Polls per day each at the 15-minute target, that is about 576,000 rows per day and about **52 million rows in 90 days** (somewhat fewer at the stretched ~25 minute interval). Rows are indexed on `(competitor_id, fetched_at desc)`, which is what the timeline reads. The brief asks for _at least_ 90 days, so nothing is deleted. Only described, not built: monthly partitioning of the Snapshot table and dropping partitions older than 90 days.

## Main decisions and alternatives

- **What counts as a Change.** Any difference in title, tagline, price, or description after normalization. The price is split into amount, currency, and period; whitespace and letter case are collapsed; noise fields and fields that change on every request are ignored. A Poll is compared with the Baseline, the last `ok` Poll, not with the previous Poll, so a failed or incomplete Poll in between cannot hide or invent a Change. No thresholds (for example, "price moved by more than 5%"): they would be a product decision nobody asked for. Considered: comparing raw responses (every poll would change) and field-specific thresholds.
- **Delisted and returned.** A `404` for a known Competitor is a Poll with status `delisted` and counts as a Change with fixed text. On return, the listing is compared with the last `ok` Baseline: identical content gives a "returned" Change with fixed text, different content gets an LLM summary.
- **Incomplete listings.** A listing with a missing, empty, or null field is stored as `incomplete`, is not compared, and does not replace the Baseline. It is never a Change; the UI says the source returned incomplete data.
- **Failed Polls.** Recorded with the reason and retried at the next regular time. No fast retry and no per-Competitor backoff; both would spend request budget that is already short at full scale.
- **Adding an unknown id.** The add makes one request to the source. A `404` gives `422` and nothing is stored. A transient error (`5xx`, timeout, `429`) stores the Competitor as "awaiting first poll" and returns the reason. Considered: storing any id without checking (typos would be tracked forever) and rejecting on any error (a source outage would block adding).
- **Adding a known id.** If the id is already in the database (active or removed), the source is not asked and the answer is `201`; a removed Competitor is restored with its Snapshots and Baseline. Considered: always asking the source (a Competitor the source has delisted would get `422` and its history could not be restored); asking only for an active Competitor (no benefit, it only spends rate limit); answering `200` or `409` for an active one (more informative, but the brief only asks for `201`). Known consequence: the "awaiting first poll" reason is not refreshed on a repeated add.
- **Removing a Competitor** is a soft delete. Polling stops and it disappears from the list, but its Snapshots stay.
- **Summary is written after the Snapshot is saved.** The LLM runs in the background, with a timeout and no retries, so a slow or broken LLM can never fail or delay a Poll. Output is validated with zod (shape, not empty, not too long). Considered: calling the LLM inside the Poll (a slow model would hold the rate-limited worker and could lose the result).
- **LLM budget: Hourly allowance, not first-come-first-served.** Rejected first-come-first-served because one early burst of Changes (for example, a source that republishes all listings) would use the whole day's budget, and every later Change that day would get `budget_exhausted`. The cost is that some of the budget can stay unused on a quiet day with a burst late in the evening, which is the safe side of a hard cap.
- **LLM client.** One OpenAI-compatible client and no provider SDK, so the mock LLM, a real provider, and Ollama are all configuration.
- **Scheduler in the backend process.** One instance, state in Postgres, no Redis or queue. Considered: a job queue (more moving parts, nothing in the brief needs it at one instance). Scaling to several instances is only described.
- **Database.** Postgres with Drizzle and `drizzle-kit` migrations, instead of a flat file: the atomic budget counter, `next_poll_at` scheduling, and the row count above need a real database.
- **Deployment.** A VPS with the same compose file plus Caddy for HTTPS, because one compose file works locally and in the cloud. Considered: Fly.io and Render (separate config for each of four services).

## What was left out on purpose

- Partitioning and deleting Snapshots older than 90 days (described above).
- Adaptive polling intervals, sharding, and more than one backend instance.
- Per-Competitor backoff and fast retry after a failed Poll.
- Backfilling summaries that were skipped because of the budget or a failed LLM call.
- Automatic refresh of the UI: it loads data when a view opens; reload to see new Polls.
- Authentication (the brief says one internal user), pagination of the timeline, and any styling.
- Manual "poll now" endpoint.
- LLM prompt tuning: with the mock LLM the text cannot be judged, so the prompt is a plain statement of the old and new listing.
- Metrics and dashboards: only structured logs and `GET /api/health` exist.

## AI tools used

Claude Code (Anthropic) was used for planning, writing code and tests, and this README, under written project rules in `CLAUDE.md` and `docs/agents/`. The user made the open product decisions (what counts as a Change, unknown ids, budget policy, deployment) in a question-and-answer session; the assistant proposed, the user accepted or changed.

### One place where the AI proposal was changed

The assistant first proposed reserving an LLM slot before the call and **never giving it back**, as the simplest way to keep the cap hard. The user asked what happens when the call never left the process, for example when the connection is refused or the request could not be built. That would burn a slot for nothing. Decision: give the slot back **only when the request provably did not leave**, and keep it after a timeout, a `5xx`, or unusable output, where the provider may already have billed it. A crash between reservation and call still loses one slot, which stays on the safe side.

## Deploy to a VPS

Status: **not deployed yet.** The procedure below is what the files in this repository are set up for; it has not been run on a real server, and the override was only checked with `docker compose config` (it shows that only Caddy publishes ports); `docker compose up` was not run with it. Fill in the live link at the top of this file after the first deployment.

The production setup is the normal compose file plus `docker-compose.prod.yml`, which adds Caddy and unpublishes every other port. Only ports 80 and 443 are reachable from outside.

1. **Server.** Any VPS with Docker Engine and the Compose plugin (Compose 2.24 or newer, because the override uses `!override`), a public IPv4 address, and ports 80 and 443 open in the provider's firewall.
2. **Code.** `git clone <repository url> && cd competitor-pulse`.
3. **Hostname.** Pick `SITE_ADDRESS` in this order:
   1. The hostname the VPS provider gives the server, if it resolves to the server's IP.
   2. Otherwise `<ip>.sslip.io` with dots replaced by dashes, for example `203-0-113-7.sslip.io` for `203.0.113.7`. This public DNS service resolves to the embedded IP, and Caddy can get a trusted certificate for it.
   3. Last resort, if no certificate can be obtained: `:80`, which serves plain HTTP on the IP. Do not use this for anything private.
4. **Settings.** Create `.env` next to `docker-compose.yml` (never commit it):

   ```sh
   SITE_ADDRESS=203-0-113-7.sslip.io
   # Optional: a real LLM instead of the mock (see "Which LLM is used"), and the interval.
   # LLM_BASE_URL=https://api.openai.com/v1
   # LLM_API_KEY=...
   # LLM_MODEL=...
   # POLL_INTERVAL_SECONDS=900
   ```

5. **Start.** `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`. Caddy requests the certificate on the first request to the hostname (DNS must already point at the server; certificates are kept in the `caddy_data` volume).
6. **Check.** Open `https://<SITE_ADDRESS>/`, then `https://<SITE_ADDRESS>/api/health`. Follow logs with `docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f backend caddy`.
7. **Update.** `git pull` and repeat step 5. Data stays in the `pgdata` volume.

Notes: the Postgres password in `docker-compose.yml` is a fixed local default; it is safe here only because the override does not publish the Postgres port. The provided source and mock LLM run in the same compose project, so the deployed instance can be pointed elsewhere with `SOURCE_BASE_URL` and `LLM_BASE_URL` as described above.
