# PowerScroll Deployment Ledger

This file records externally observed deployment state. Update it after every
release or distribution change. It is a ledger, not a substitute for querying
the live services before a new release.

**Last verified:** 2026-10-14 (Europe/Berlin)

## Current public state

| Surface | Deployed state | Verification |
|---|---|---|
| Source repository | `CynaCons/PowerScroll`; app release source is tag `v0.84.0` at `f0f52d2` | [Repository](https://github.com/CynaCons/PowerScroll) |
| Application release | `v0.84.0`, published 2026-10-14 10:42 UTC, non-draft, `Latest`; app reports `0.84.0` | [GitHub release](https://github.com/CynaCons/PowerScroll/releases/tag/v0.84.0) |
| GitHub Pages | Public, HTTPS, workflow-deployed from `main` at `f0f52d2` (run succeeded 2026-10-14); live app reports `0.84.0` | [Storefront](https://cynacons.github.io/PowerScroll/) · [Live app](https://cynacons.github.io/PowerScroll/app/) · [deployments](https://github.com/CynaCons/PowerScroll/actions/workflows/pages.yml) |
| npm | `powerscroll-mcp@0.67.1`; `latest` = `0.67.1`. **0.68.0 (board tools) is committed at `d9912d5` but NOT published**: npm was not signed in on the release machine (`npm whoami` 401) | [npm package](https://www.npmjs.com/package/powerscroll-mcp) |
| Official MCP Registry | `io.github.CynaCons/powerscroll@0.67.1`, active. 0.68.0 waits for npm (Registry validation queries npm) | [Registry search](https://registry.modelcontextprotocol.io/?q=powerscroll) |

The surfaces diverge on purpose at this snapshot: the app ships the board UI
and the bridge commands, but agents only get the 14 board tools once
`powerscroll-mcp@0.68.0` is on npm. Until then `npx -y powerscroll-mcp`
resolves 0.67.1 (no board tools); a local checkout (`node powernote-mcp/server.js`)
already has them.

## GitHub release assets

The `v0.84.0` release contains (digests reported by the GitHub API; the HTML
size matches the committed `dist-template/index.html`):

| Asset | Size | SHA-256 | Meaning |
|---|---:|---|---|
| `PowerScroll.html` | 2,666,755 bytes | `32316748ce1ddbb10b4e9977140258aa1707db3b15670c12b2c7d88d7170474f` | Primary self-contained notebook application |
| `PowerNote.html` | 2,666,755 bytes | `32316748ce1ddbb10b4e9977140258aa1707db3b15670c12b2c7d88d7170474f` | Byte-identical compatibility alias for legacy updates |
| `powerscroll-mcp.tgz` | 32,268 bytes | `e8b9d4934e38298521ec39b453ffa6f742aaf08673347a5e424d1768fbda7827` | MCP package snapshot at the app tag (package version `0.68.0`, not yet on npm) |

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
