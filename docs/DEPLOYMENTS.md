# PowerScroll Deployment Ledger

This file records externally observed deployment state. Update it after every
release or distribution change. It is a ledger, not a substitute for querying
the live services before a new release.

**Last verified:** 2026-10-14 (Europe/Berlin)

## Current public state

| Surface | Deployed state | Verification |
|---|---|---|
| Source repository | `CynaCons/PowerScroll`; app release source is tag `v0.81.0` at `925bf61` | [Repository](https://github.com/CynaCons/PowerScroll) |
| Application release | `v0.81.0`, published 2026-10-14 08:26 UTC, non-draft, `Latest`; app reports `0.81.0` | [GitHub release](https://github.com/CynaCons/PowerScroll/releases/tag/v0.81.0) |
| GitHub Pages | Public, HTTPS, workflow-deployed from `main` at `925bf61` (run completed 2026-10-14); live app reports `0.81.0` | [Storefront](https://cynacons.github.io/PowerScroll/) · [Live app](https://cynacons.github.io/PowerScroll/app/) · [deployments](https://github.com/CynaCons/PowerScroll/actions/workflows/pages.yml) |
| npm | `powerscroll-mcp@0.67.1`; `latest` = `0.67.1` — unchanged by this release, re-queried 2026-10-14 | [npm package](https://www.npmjs.com/package/powerscroll-mcp) |
| Official MCP Registry | `io.github.CynaCons/powerscroll@0.67.1`, active, points to npm `powerscroll-mcp@0.67.1` — unchanged by this release, re-queried 2026-10-14 | [Registry search](https://registry.modelcontextprotocol.io/?q=powerscroll) |

The application and MCP versions intentionally differ at this snapshot.
`v0.81.0` was an application-only release: settings overlay, autosave to the
linked file and the browser, shape preview, freehand ink back to the pre-v0.69
renderer with a native pen cursor, plus the demo notebook, brand mark and
scroll header (v0.76.1–v0.78.0). Nothing under `powernote-mcp/` changed since
the MCP `0.67.1` publication, so npm and the Registry were not republished.

## GitHub release assets

The `v0.81.0` release contains (digests reported by the GitHub API; the HTML
size matches the locally built and committed `dist-template/index.html`):

| Asset | Size | SHA-256 | Meaning |
|---|---:|---|---|
| `PowerScroll.html` | 2,620,072 bytes | `9f2a876a3299b40d16f31b743e3132468ac9ef3d4eac2b36e7ba3739079c0c8f` | Primary self-contained notebook application |
| `PowerNote.html` | 2,620,072 bytes | `9f2a876a3299b40d16f31b743e3132468ac9ef3d4eac2b36e7ba3739079c0c8f` | Byte-identical compatibility alias for legacy updates |
| `powerscroll-mcp.tgz` | 29,542 bytes | `4860aa52d011b97995c3ecb66f020143639ecfaea4cf3bf2878b063333957d07` | MCP package snapshot (package version `0.67.1`, identical to the v0.73.0 asset) |

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
