# PowerScroll — Claude Instructions

## Project Overview
PowerScroll (formerly PowerNote) is an offline-first, file-based visual note-taking app combining OneNote structure, a presentation canvas, and whiteboard freedom. Built with React 18 + TypeScript + Vite + Konva.js + Zustand.

## Tech Stack
- **Canvas**: Konva.js (react-konva) — MIT license, chosen over tldraw ($6K/year)
- **State**: 9 Zustand stores (workspace, canvas, draw, tool, group, bridge, diagram, editor, fileBinding)
- **Text**: Markdown rendering via `marked`, raw editing in textarea overlay
- **Testing**: Playwright E2E, ASPICE-style SRS docs with traceability

## Critical Workflow: Handling User Feedback

When the user gives feedback, bug reports, or feature requests — **ALWAYS** do these 3 things before writing code:

1. **Update PLAN.md** — Add a task under the current iteration with `- [ ]` checkbox
2. **Create a TodoWrite** — Track the work item as in_progress
3. **Assess SRS impact** — Check if a new requirement (REQ-XXX-NNN) is needed in the relevant `docs/SRS_*.md`. If yes, add it with a test reference.

Only then proceed with implementation.

## PLAN.md Format (STRICT)
- Markdown checklists with `- [ ]` / `- [x]`
- Version-numbered iterations: v0.1.0, v0.1.1, v0.2.0, etc.
- Each iteration has a title and summary
- Status table at the bottom
- Update in real-time as tasks are completed

## powerplan MCP (PLAN.md operations)

PowerNote vendors [powerplan](https://github.com/CynaCons/powerplan) as a git
submodule at `powerplan/` and registers it in project `.mcp.json`.

- **Server:** `powerplan` (stdio) — `python powerplan/powerplan_server.py`
- **Purpose:** single-writer API over `PLAN.md` (create iterations, complete
  tasks, current-iteration queries) without freeform thrash
- **Default plan:** walk-up from cwd finds this repo’s root `PLAN.md`
- **Setup after clone:**
  ```bash
  git submodule update --init --recursive
  # optional: pip install -e ./powerplan
  ```
- Prefer MCP tools (`get_current_iteration`, `complete_task`, …) over hand-editing
  PLAN checkboxes when the server is available. Restart the agent session after
  changing `.mcp.json` so tools load.

## Testing Requirements
- Every feature must have E2E test coverage
- Test numbers are **globally unique** across the project (00, 01, 02, ...)
- Tests reference requirement IDs: `Covers: REQ-TEXT-001`
- Tests live in `tests/<feature>/NN-test-name.spec.ts`
- SRS docs live in `docs/SRS_<FEATURE>.md`
- Run `npx playwright test` after every change — must be green before commit

## Before Reporting Completion
- ALWAYS run a smoke test: `npm run dev` must launch without crashes
- Check console for critical errors
- Run `npx playwright test` — all tests must pass
- Publish a **showcase artifact** (below) — this is the deliverable, not a bonus

## Showcase Artifact (REQUIRED for every iteration or bunch of work)

Finishing a major piece of work means handing over a published artifact showing
what changed and what it looks like. A written summary alone is not delivery.
Scope: any iteration, or any batch of related changes worth a version bump.
Skip only for a single trivial fix.

**Screenshots come from the running app. Never mock them up.**
Drive the real UI with a Playwright script and capture element-clipped shots.
A recreation of the UI in HTML is not evidence and must not be presented as one.

```
const page = await browser.newPage({ viewport: {width:1400,height:880}, deviceScaleFactor: 2 });
await locator.screenshot({ path: ... });   // element-clipped, not full-window
```

Capture gotchas already paid for:
- The script must live **inside the repo** — Node resolves `@playwright/test`
  from the script's own location, not cwd. Write it to the repo root, run it,
  delete it. Never leave capture scripts behind.
- Set up state via `window.__POWERNOTE_BRIDGE__` / `__POWERNOTE_STORES__` rather
  than clicking through the canvas — synthetic mouse events do not reach Konva.
- Crop tight. A full-canvas shot of a mostly-empty page shows nothing.
- Pick states that actually differ. Two guide styles that are both white-on-white
  prove nothing; give one an override with a visible colour.

**Structure — one record per change:**
1. An area label (Selection toolbar, Diagrams, Settings, Canvas, Top bar)
2. A title saying what is now true
3. The **defect stated plainly** — what was broken and why
4. The screenshots as evidence
5. Any decision the user might want to veto, called out

**Be honest about what is shown.** Before/after screenshots require actually
capturing the old build (a git worktree at the previous commit, served on a
second port). If that was not done, *state* the before rather than illustrating
it, and say on the page that it is stated rather than shown.

**Include a verification section with the real numbers** — including failures,
flaky runs and contention. A green number with the failures omitted is a lie of
composition.

**Design it from the app's own system.** Theme from `src/diagram/tokens.ts`
(`TINT #EEF1F0`, `INK #14181A`, `RULE #C3CBC9`, `ACCENT #B4552D`), and honour the
codebase's own rule that ACCENT marks faults and nothing else. Frame each
screenshot the way the app frames a diagram: title band, hairline, mono badge.
Render **both light and dark** before publishing — theme bugs hide in the gap
between source and output.

## User Preferences
- **Always cross-check priorities** with the user before deciding what to build
- Don't assume what's important — ask directly
- Focus on core UX and structural features, not cosmetic additions
- Simplicity > completeness. Speed > features. Ship fast.

## Code Patterns
- Components in `src/components/<area>/`
- Stores in `src/stores/`
- Types in `src/types/data.ts`
- All key DOM elements have `data-testid` attributes
- Zustand stores exposed on `window.__POWERNOTE_STORES__` in dev mode for testing
- Konva nodes use Group positioning: Group at (node.x, node.y), children at (0, 0)

## Git Conventions
- Commit messages: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- Always include `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`
- Tag major milestones: `v0.1.0`, `v0.2.0`
- Never amend commits — always create new ones

## Release and Deployment Operations

Before changing a version, creating or pushing a tag, publishing npm, publishing
MCP Registry metadata, or diagnosing a deployment, read `docs/RELEASING.md` and
the current observed state in `docs/DEPLOYMENTS.md`. The repository-local
`powerscroll-release` skill at `.agents/skills/powerscroll-release/SKILL.md`
routes release work to those canonical documents. Update the deployment ledger
after every external publication; never infer that npm, the MCP Registry,
GitHub Releases, and GitHub Pages moved together.
