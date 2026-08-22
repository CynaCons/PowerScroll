# PowerScroll Deployment Ledger

This file records externally observed deployment state. Update it after every
release or distribution change. It is a ledger, not a substitute for querying
the live services before a new release.

**Last verified:** 2026-08-22 (Europe/Berlin)

## Current public state

| Surface | Deployed state | Verification |
|---|---|---|
| Source repository | `CynaCons/PowerScroll`; app release source is tag `v0.67.0` at `945e75c` | [Repository](https://github.com/CynaCons/PowerScroll) |
| Application release | `v0.67.0`, published 2026-08-22; app reports `0.67.0` | [GitHub release](https://github.com/CynaCons/PowerScroll/releases/tag/v0.67.0) |
| GitHub Pages | Public, HTTPS, workflow-deployed from `main`; live app reports `0.67.0` | [Storefront](https://cynacons.github.io/PowerScroll/) · [Live app](https://cynacons.github.io/PowerScroll/app/) · [deployments](https://github.com/CynaCons/PowerScroll/actions/workflows/pages.yml) |
| npm | `powerscroll-mcp@0.67.1`; `latest` = `0.67.1` | [npm package](https://www.npmjs.com/package/powerscroll-mcp) |
| Official MCP Registry | `io.github.CynaCons/powerscroll@0.67.1`, active/latest, points to npm `powerscroll-mcp@0.67.1` | [Registry search](https://registry.modelcontextprotocol.io/?q=powerscroll) |

The application and MCP versions intentionally differ by one patch at this
snapshot. MCP `0.67.1` corrected the case-sensitive Registry identity from
`io.github.cynacons/powerscroll` to the GitHub-authorized
`io.github.CynaCons/powerscroll`; it did not change the PowerScroll app.

## GitHub release assets

The `v0.67.0` release contains:

| Asset | Size | SHA-256 | Meaning |
|---|---:|---|---|
| `PowerScroll.html` | 2,567,117 bytes | `809cd1ded39c5ee1f3af3a66137cd3bea0a1a87b1379474367f1b97ab51cc854` | Primary self-contained notebook application |
| `PowerNote.html` | 2,567,117 bytes | `809cd1ded39c5ee1f3af3a66137cd3bea0a1a87b1379474367f1b97ab51cc854` | Byte-identical compatibility alias for legacy updates |
| `powerscroll-mcp.tgz` | 29,443 bytes | `fd5d7552bcc196dfaf31ce7cf8d599413d6cf4ea8634feb039d50fd3b0d8a912` | MCP package snapshot at the app tag (`0.67.0`); npm `0.67.1` is newer |

## Compatibility and migration verified for the public launch

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
gh release view v0.67.0 --repo CynaCons/PowerScroll --json tagName,publishedAt,url,assets
gh api repos/CynaCons/PowerScroll/pages
npm view powerscroll-mcp name version dist-tags time --json
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=powerscroll&version=latest"
```

For the required order and release decisions, see [`RELEASING.md`](RELEASING.md).
