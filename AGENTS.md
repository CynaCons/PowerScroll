# Agent instructions (Codex, Grok, Gemini and other CLI agents)

Read `CLAUDE.md` first — it is the canonical project guide (stack, patterns,
testing rules, showcase rules). The rules below are the ones sub-agents most
often get wrong.

- **Tests**: Playwright E2E only, in `tests/<feature>/NN-name.spec.ts`. Test
  numbers are globally unique across the whole project (check the highest
  existing number before adding one). Each spec header says `Covers: REQ-XXX-NNN`.
- **Requirements**: every user-visible behaviour has a `REQ-<AREA>-NNN` row in
  `docs/SRS_<AREA>.md` with the covering test in the last column.
- **Verification before you report**: `npm run typecheck`, `npm run lint`,
  then `npx playwright test` (full suite, ~3–5 min, starts its own Vite on
  port 5193). Never enable retries. Report exact pass/fail counts.
- **Driving the canvas in tests**: synthetic mouse events do not reach Konva.
  Use pointer events dispatched on the stage container, or set state through
  `window.__POWERNOTE_STORES__` / `window.__POWERNOTE_BRIDGE__`. Look at
  `tests/helpers.ts` and an existing spec in the same folder first.
- **Do not commit, tag, bump versions, or edit `PLAN.md`** unless your task
  explicitly says so. The coordinator owns those.
- **Style**: simplicity over completeness. Small, readable diffs. No new
  dependencies unless the task names them.
- Finish with a short summary: files changed, decisions taken, exact test
  numbers, anything left undone.
