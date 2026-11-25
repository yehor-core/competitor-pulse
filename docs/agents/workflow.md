# Workflow rules

## Language

- Talk to the user in Russian.
- Everything a reviewer reads is English: code, comments, README, ADRs, `GLOSSARY.md`, commit messages, `CLAUDE.md`, `docs/agents/*`.

## Decisions

- The brief leaves some decisions open on purpose. Do not decide them silently. Ask the user, using the recommended-answer style of the grilling skill.
- Record each decision with the alternatives considered. Hard to reverse, surprising, real trade-off: write an ADR in `docs/adr/`. Otherwise: add it to the README decisions section.
- If code contradicts an ADR, say so before changing it.
- Keep `README.md` in sync with behavior in the same change.

## Git

- Do not commit or push unless the user asks.
- Conventional Commits. Small commits, one change each.
- Never commit `.env` or any secret. Only `.env.example`.

## AI log

- When the user corrects one of your proposals in a way that matters, add a line to `docs/ai-log.md`: what you proposed, what was decided instead, why. The README must name one such place.

## Asking

- If a requirement is ambiguous and a wrong guess is costly, ask. If a reasonable default exists, use it, say so, and continue.
