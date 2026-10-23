# PowerScroll Deployment Ledger

This file records externally observed deployment state. Update it after every
release or distribution change. It is a ledger, not a substitute for querying
the live services before a new release.

**Last verified:** 2026-10-23 (Europe/Berlin), after v0.90.0

## Current public state

| Surface | Deployed state | Verification |
|---|---|---|
| Source repository | `CynaCons/PowerScroll`; app release source is tag `v0.90.0` at `da3a031` | [Repository](https://github.com/CynaCons/PowerScroll) |
| Application release | `v0.90.0`, published 2026-10-23, non-draft, `Latest`; app reports `0.90.0` | [GitHub release](https://github.com/CynaCons/PowerScroll/releases/tag/v0.90.0) |
| GitHub Pages | Public, HTTPS, workflow-deployed from `main` at `da3a031` (run succeeded 2026-10-23); live app reports `0.90.0` | [Storefront](https://cynacons.github.io/PowerScroll/) · [Live app](https://cynacons.github.io/PowerScroll/app/) · [deployments](https://github.com/CynaCons/PowerScroll/actions/workflows/pages.yml) |
| npm | `powerscroll-mcp@0.67.1`; `latest` = `0.67.1`. **0.70.0 and 0.71.0 (0.71.0 adds the checklist tools: `card_checklist_update/_remove/_move/_set`, nested items) are committed but NOT published**: npm is not signed in on the release machine (`npm whoami` 401 again on 2026-10-23). Local checkouts (`node powernote-mcp/server.js`) have them | [npm package](https://www.npmjs.com/package/powerscroll-mcp) |
| Official MCP Registry | `io.github.CynaCons/powerscroll@0.67.1`, active. 0.71.0 waits for npm (Registry validation queries npm) | [Registry search](https://registry.modelcontextprotocol.io/?q=powerscroll) |

The surfaces diverge on purpose at this snapshot: the app ships the board UI
and its bridge commands, but agents only get the board tools once
`powerscroll-mcp@0.70.0` is on npm. Until then `npx -y powerscroll-mcp`
resolves 0.67.1; a local checkout (`node powernote-mcp/server.js`) already has
them, and the release carries the 0.70.0 tarball as an asset.

## GitHub release assets

The `v0.90.0` release contains (digests reported by the GitHub API; the HTML
digest equals the committed and locally tested `dist-template/index.html`):

| Asset | Size | SHA-256 | Meaning |
|---|---:|---|---|
| `PowerScroll.html` | 3,023,781 bytes | `7339f41b9aa0915bc610a072fe5cda0de1165df99e518bbffb54c56a1affc96a` | Primary self-contained notebook application |
| `PowerNote.html` | 3,023,781 bytes | `7339f41b9aa0915bc610a072fe5cda0de1165df99e518bbffb54c56a1affc96a` | Byte-identical compatibility alias for legacy updates |
| `powerscroll-mcp.tgz` | 34,200 bytes | `1f04ed044ead26ee9f36c208e72c67d89e0a232c1c6a4b88a0d6f26e98868240` | MCP package snapshot at the app tag (package version `0.71.0`, not on npm) |

## Verified for v0.90.0

- App + MCP source release: nested board checklists (depth 0-3) and agent
  checklist tools (`card_checklist_add` with under/position/depth,
  `card_checklist_update`, `_remove`, `_move`, `_set`). Owner request
  2026-10-23, short path. Pre-tag evidence: typecheck clean; lint 0 errors
  (40 warnings); MCP package tests 13/13; bridge multi-agent tests all
  passed; Playwright `tests/board` + `tests/agent` 161/161 with no retries
  (T237 new, red first). **The full 964-test campaign was not run** for this
  board-only change. The built template opened from disk (sha256
  `7339f41b...`) reported 0.90.0 with zero console errors.
- Post-tag: `Build & Release` succeeded; CI and `Deploy GitHub Pages`
  succeeded for `da3a031`; the live app page contains `0.90.0`.
- Updater paths: `releases/latest` returns `v0.90.0`; the raw `main`
  `package.json` fallback returns `0.90.0`; the tag-pinned
  `dist-template/index.html` returns 3,023,781 bytes.
- Data: checklist items gain an optional `depth`; notebooks without it open
  with every item at the top level. Older apps ignore the field and show the
  items flat.
- npm / Registry: not published (npm not signed in). Agents that run the MCP
  server from this checkout get the new tools after their MCP connection
  restarts.

## Verified for v0.89.0

- App release (MCP package unchanged at 0.70.0; the release tarball digest
  equals v0.88.1's). Text blocks redesigned: ProseMirror editor with one
  renderer for editing and the finished block, markdown still the stored
  format; rendered markdown sanitised (DOMPurify); CodeMirror removed.
  Pre-tag evidence: typecheck clean; lint 0 errors (40 warnings); MCP package
  tests 13/13; bridge multi-agent tests all passed; full local Playwright
  campaign 964/964 with no retries on the release candidate, run in three
  2-worker batches (392 + 359 + 213) because a 3-worker run was stopped by the
  harness at 64/964 for low system memory (0 failures up to then); the built
  template opened from disk (sha256 `8ac8536f...`) placed, typed and bolded a
  block with zero console errors.
- Post-tag: one `Build & Release` run (39909912597) succeeded; CI and
  `Deploy GitHub Pages` succeeded for `d9a075d`; the live app page contains
  `0.89.0`.
- Updater paths: `releases/latest` returns `v0.89.0`; the raw `main`
  `package.json` fallback returns `0.89.0`; the tag-pinned
  `dist-template/index.html` returns 3,018,465 bytes, and the release HTML
  digests equal the local tested file.
- Data: no file format change. Stored text stays markdown; a block opened and
  left without changes keeps its text byte for byte. Edited blocks may gain
  `<br>` lines for blank lines and inline `<strong>`/`<em>`/`<del>` where
  markdown delimiters cannot express the formatting.

## Verified for v0.88.1

- App-only patch release (MCP package unchanged at 0.70.0; the release tarball
  digest equals v0.88.0's). Text blocks: Escape leaves editing, keeps the text
  and clears the selection, so a newly placed block can be dragged at once.
  Pre-tag evidence: typecheck clean; lint 0 errors (40 warnings); MCP package
  tests 13/13; bridge multi-agent tests all passed; full local Playwright
  campaign 876/876 with no retries on the release candidate; the built
  template opened from disk (sha256 `9f34ae47...`) placed, released and dragged
  a block with zero console errors.
- Post-tag: GitHub started `Build & Release` twice for the one tag push (runs
  39800884472 and 39800887803, same commit, one second apart). The second was
  cancelled before it ran so the two would not race to create the release; the
  first succeeded. CI and `Deploy GitHub Pages` succeeded for `532a90d`; the
  live app page contains `0.88.1`.
- Updater paths: `releases/latest` returns `v0.88.1`; the raw `main`
  `package.json` fallback returns `0.88.1`; the tag-pinned
  `dist-template/index.html` returns 3,029,511 bytes, and the release HTML
  digests equal the local tested file.
- Data: no format change.

## Verified for v0.88.0

- App-only minor release (MCP package unchanged at 0.70.0; the release tarball
  digest equals v0.87.0's). Board cards: checklist rename/reorder, card-face
  subtask preview and progress bar, drag copy that follows the pointer, a
  Details panel with status/assignee/label menus, a label filter, and a fix
  for drops between two cards. Pre-tag evidence: typecheck clean; lint 0
  errors (40 warnings); MCP package tests 13/13; bridge multi-agent tests all
  passed; board specs 43/43; full local Playwright campaign 872/872 with no
  retries; the built template opened from disk reporting 0.88.0 with zero
  console errors.
- Post-tag: `Build & Release`, CI and `Deploy GitHub Pages` all succeeded for
  `c1b9912`; the live app page contains `0.88.0`.
- Updater paths: `releases/latest` returns `v0.88.0`; the raw `main`
  `package.json` fallback returns `0.88.0`; the tag-pinned
  `dist-template/index.html` returns 3,029,462 bytes.
- Data: no format change. Card `order` values are renumbered on every move,
  as before; the label filter is session state and is not saved.

## Verified for v0.87.0

- App-only minor release (MCP package unchanged at 0.70.0; the release tarball
  digest equals v0.86.1's). The text-block editor moved to CodeMirror 6 with
  new runtime dependencies (`@codemirror/*`, `@lezer/*`, `turndown`,
  `turndown-plugin-gfm`); the template grew 2,678,237 -> 3,007,877 bytes.
  Pre-tag evidence: typecheck clean; lint 0 errors (40 warnings);
  `npm audit --omit=dev` shows only the pre-existing low katex finding; MCP
  package tests 13/13; bridge multi-agent tests all passed; T219 failed 0/5 on
  the previous code and passed 5/5; new specs T219-T222 16/16; full local
  Playwright campaign 859/859 (an earlier run was 858/859 on T197, fixed
  before the final run); the built template opened from disk reporting 0.87.0
  with zero console errors.
- Post-tag: `Build & Release`, CI and `Deploy GitHub Pages` all succeeded for
  `3da4a38`; the live app page contains `0.87.0`.
- Updater paths: `releases/latest` returns `v0.87.0`; the raw `main`
  `package.json` fallback returns `0.87.0`; the tag-pinned
  `dist-template/index.html` returns 3,007,877 bytes.
- Data: no format change. Text stays markdown. Setext headings
  (`Title` over `===` / `---`) no longer render as headings.

## Verified for v0.86.1

- App-only patch (MCP package unchanged at 0.70.0; the release tarball is
  byte-identical to v0.86.0's). Pre-tag evidence: typecheck clean; lint 0
  errors (40 warnings); `build:template` produced the 2,678,237-byte template
  embedding `0.86.1`; MCP package tests 13/13; bridge multi-agent tests all
  passed; T218 failed on the previous overlay (37 events) and passed on the
  fix; full local Playwright campaign 843/843; the built template opened from
  disk reporting 0.86.1 with zero console errors.
- Post-tag: `Build & Release`, CI and `Deploy GitHub Pages` all succeeded for
  `2f54a88`; the live app string reports `0.86.1`.
- Updater paths: `releases/latest` returns `v0.86.1`; the raw `main`
  `package.json` fallback returns `0.86.1`; the tag-pinned
  `dist-template/index.html` answers HTTP 200 with 2,678,237 bytes.
- Data: no format change. Notebooks edited before this release keep their
  per-keystroke `updated` events; the UI shows each run as one line.

## Verified for v0.86.0

- Pre-tag evidence on the release candidate: typecheck clean; lint 0 errors
  (40 warnings); `build:template` produced the 2,677,224-byte template
  embedding `0.86.0`; MCP package tests 13/13, `npm audit` 0, `npm pack` = the
  4 intended files; bridge multi-agent tests all passed; full local
  Playwright campaign 841/841; the built template opened from disk with the
  bridge object present, Settings reporting v0.86.0, a board page opening,
  and zero console errors.
- Post-tag: `Build & Release`, CI and `Deploy GitHub Pages` all succeeded for
  `817bbd5`; the live app string reports `0.86.0`.
- Updater paths: `releases/latest` returns `v0.86.0`; the raw `main`
  `package.json` fallback returns `0.86.0`; the tag-pinned
  `dist-template/index.html` answers HTTP 200 with 2,677,224 bytes.
- Behaviour change for agents: board calls without `me` (and without
  POWERNOTE_AGENT_NAME) now fail with NAME_REQUIRED; generated-looking names
  (agent-/unnamed- + 8 hex) are refused by the app.

## Verified for v0.85.0

- Pre-tag evidence on the release candidate: typecheck clean; lint 0 errors
  (40 warnings); `build:template` produced the 2,674,079-byte template
  embedding `0.85.0`; MCP package tests 9/9, `npm audit` 0, `npm pack` = the
  4 intended files; bridge multi-agent tests all passed; full local
  Playwright campaign 838/838; the built template opened from disk with the
  bridge object present, Settings reporting v0.85.0, a board page opening,
  and zero console errors.
- Post-tag: `Build & Release`, CI and `Deploy GitHub Pages` all succeeded for
  `66ed75d`; the live app string reports `0.85.0`.
- Updater paths: `releases/latest` returns `v0.85.0`; the raw `main`
  `package.json` fallback returns `0.85.0`; the tag-pinned
  `dist-template/index.html` answers HTTP 200 with 2,674,079 bytes.
- New data: board cards may carry `archivedAt`; board events gain
  `archived`, `restored`, `left`.

## Verified for v0.84.0

- Pre-tag evidence on the release candidate: typecheck clean; lint 0 errors
  (40 warnings); `build:template` produced the 2,666,755-byte template
  embedding `0.84.0`; MCP package tests 8/8, `npm audit` 0, `npm pack` = the
  4 intended files; bridge multi-agent tests all passed; full local
  Playwright campaign 826/826 (the previous run on the same features was
  824/825: T153 asserted the old zoom-scaled ceiling headroom, fixed); the
  built template opened from disk with the bridge object present, Settings
  reporting v0.84.0, a board page opening, and zero console errors.
- Post-tag: `Build & Release`, CI and `Deploy GitHub Pages` all succeeded for
  `f0f52d2`; the live app string reports `0.84.0`.
- Updater paths: `releases/latest` returns `v0.84.0`; the raw `main`
  `package.json` fallback returns `0.84.0`; the tag-pinned
  `dist-template/index.html` answers HTTP 200 with 2,666,755 bytes.
- Not exercised: a previously released notebook through the update path (the
  updater code did not change). New data: pages may carry `kind: 'board'` and
  `board`; an older app opening such a notebook is expected to ignore those
  fields and show the board page as an empty canvas (not tested).
- Owner verification pending: pen feel and cursor (v0.80.0), active
  highlighting on the board (v0.83.4).

## Verified for v0.81.0

- Pre-tag evidence on the release candidate: typecheck clean; lint 0 errors
  (39 warnings); `build:template` produced the 2,620,072-byte template
  embedding `0.81.0`; MCP package tests 3/3; bridge multi-agent tests all
  passed; full local Playwright campaign 812/812 (an earlier run on the same
  features was 809/812 — T97, T90 and T101 still assumed the old library and
  the old settings pop-up; fixed, plus a real library re-link bug T90 caught);
  the built template opened from disk with the bridge object present, five
  canvases, Settings reporting v0.81.0 and zero console errors.
- Post-tag: `Build & Release`, CI and `Deploy GitHub Pages` all succeeded for
  `925bf61`; the live app string reports `0.81.0`.
- Updater paths: `releases/latest` returns `v0.81.0`; the raw `main`
  `package.json` fallback returns `0.81.0`; the tag-pinned
  `dist-template/index.html` answers HTTP 200 with 2,620,072 bytes.
- Not exercised this release: a real previously released notebook through the
  update path. The updater code did not change. New this release: notebooks
  gain a stable `id` on first load and an IndexedDB recovery copy
  (`powerscroll-recovery`); the old localStorage library migrates once.
- Owner verification of the pen feel, the cursor and the shape preview is
  pending (owner chose to test after the release).

## Verified for v0.73.0

- Pre-tag evidence on the release commit: typecheck clean; lint 0 errors
  (35 warnings); `build:template` produced the 2,595,875-byte template
  embedding `0.73.0`; MCP package tests 3/3; bridge multi-agent tests all
  passed; full local Playwright campaign 778/779 (T82 revert failed once
  under load, then 4/4 on two isolated reruns); the built template opened
  from disk with the bridge object present, five canvases and zero console
  errors.
- Post-tag: `Build & Release` run succeeded for `0deac07`; CI succeeded for
  `0deac07`; Pages deployed from `0deac07`; the live app string reports
  `0.73.0`.
- Updater paths: `releases/latest` returns `v0.73.0`; the raw `main`
  `package.json` fallback returns `0.73.0`; the tag-pinned
  `dist-template/index.html` (used by the in-app update and the extension
  fetch) answers HTTP 200 with 2,595,875 bytes.
- Not exercised this release: a real previously released notebook through the
  update path. The updater code did not change since `v0.67.0`, where that
  path was verified with a `v0.63.1` notebook.
- Open Dependabot alerts at release time (root `package-lock.json`, all
  transitive development dependencies: postcss, vite 8.0.x, js-yaml,
  brace-expansion, nanoid 3 under postcss). None ship in the single-file
  build; the app's own `nanoid` is 5.1.16. Dependabot opened a nanoid bump
  branch the same day.

## Compatibility and migration verified for the public launch (v0.67.0)

- Existing PowerNote notebooks remain supported; compatibility-sensitive
  embedded ids and bridge protocol identifiers were retained.
- A real `v0.63.1` notebook was updated through the GitHub release path to the
  PowerScroll public release with its content and version preserved.
- The `v0.67.0` local regression campaign completed with 738/738 Playwright
  tests passing before release.
- MCP `0.67.1` passed 3/3 package tests before npm and Registry publication.
- CI and Pages both completed successfully for commit `d75638f` after the MCP
  Registry metadata correction.

## Installation and discovery

Run the current bridge without a global installation:

```bash
npx -y powerscroll-mcp
```

The npm package hosts the executable. The official MCP Registry hosts discovery
metadata that points to that exact npm version. A GitHub release attachment is
also retained as a transparent fallback, but it can trail an MCP-only patch and
must not be described as the npm latest version without verification.

## Live verification commands

```bash
gh release view v0.73.0 --repo CynaCons/PowerScroll --json tagName,publishedAt,url,assets
gh api repos/CynaCons/PowerScroll/pages
npm view powerscroll-mcp name version dist-tags time --json
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=powerscroll&version=latest"
curl -sI https://raw.githubusercontent.com/CynaCons/PowerScroll/v0.73.0/dist-template/index.html
```

For the required order and release decisions, see [`RELEASING.md`](RELEASING.md).
