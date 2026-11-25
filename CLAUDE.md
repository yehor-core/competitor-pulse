# CompetitorPulse

Tracks competitor product listings, detects changes that matter, and explains them with an LLM. Backend-focused take-home assignment. The brief is `instructions.md` and is the source of truth.

## Repo layout

- `backend/`: Node.js + TypeScript API, scheduler, persistence, LLM integration.
- `frontend/`: React (Vite) UI.
- `files/`: provided listing source and mock LLM. **Read-only. Never edit.**
- `docker-compose.yml`: starts the whole system, including `files/*`.
- `docs/adr/`, `GLOSSARY.md`, `docs/ai-log.md`, `.scratch/`: decisions, vocabulary, AI log, issues.

## Rules (details are imported, read them)

@docs/agents/requirements.md
@docs/agents/engineering.md
@docs/agents/workflow.md

## Commands

- Install: `npm ci` (npm workspaces: `backend`, `frontend`; also installs the husky hook).
- Backend dev: `npm run dev -w backend`. Frontend dev: `npm run dev -w frontend`.
- Migrate: `npm run migrate -w backend`. Generate a new migration after a schema change: `npm run db:generate -w backend`.
- Test: `npm test`. Integration tests need Postgres: `docker compose up -d postgres` and set `TEST_DATABASE_URL` (see `.env.example` for the URL shape).
- Lint, format, typecheck: `npm run lint`, `npm run format:check`, `npm run typecheck`.
- Whole system: `docker compose up --build`. UI on :8080, API on :3000, Source on :4002, mock LLM on :4001.

## Agent skills

### Issue tracker

Issues are local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
