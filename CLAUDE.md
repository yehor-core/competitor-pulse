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

Fill in once the project is scaffolded (install, dev, test, lint, typecheck, migrate, `docker compose up`).

## Agent skills

### Issue tracker

Issues are local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
