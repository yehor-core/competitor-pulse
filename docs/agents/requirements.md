# Requirements as rules

Hard constraints from `instructions.md`. Product decisions the brief leaves open (what counts as a change, unknown ids, storage schema, capacity numbers, summary statuses) are **not** rules. Do not decide them silently; see `workflow.md`.

## Source

- The listing source is an external website. Get listings only over HTTP.
- Never import its code. Never read its `listings.json`.
- The source base URL is configuration. Do not hardcode it.
- Do not depend on fixture content. Reviewers use their own fixtures and settings.
- `files/` is read-only.

## Rate limit

- Never exceed the source's global rate limit (5 requests per second for all ids together).
- On `429`, wait for the time in `Retry-After`.

## LLM

- The daily cap (2,000 calls) is a hard limit. The counter must survive a process restart; do not keep it only in memory.
- A user never loses a poll result because of the LLM. Persist the poll result independently of the LLM call. Handle slow, failed, and unusable LLM output without failing the poll.
- State in the README which LLM option is used and how to configure it.

## History

- Keep history for at least 90 days, including polls with no change and polls that failed.

## API and UI

- Implement at least the API contract in the brief (`/api/competitors`, `/api/competitors/:id/snapshots`, `Snapshot` shape). Extra fields and endpoints are fine.
- The UI always tells the user why a summary is not available.
- Two views: competitor list (with changes in the last 24 hours) and competitor timeline (newest first). No design effort.

## Delivery

- Backend: TypeScript on Node.js. Frontend: React.
- A real database with an established migration tool. One command sets up the database.
- `docker compose up` starts everything, including the source and mock LLM, so they can be swapped for other instances.
- Scheduler interval is configurable.
- README covers: how to run, which LLM and how to configure it, how to point at another source URL, main decisions and alternatives considered, what was left out on purpose, which AI tools were used and one place where the AI proposal was changed.
