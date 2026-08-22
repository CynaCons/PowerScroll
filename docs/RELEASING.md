# Releasing PowerScroll

This is the canonical release runbook for the PowerScroll application, its
GitHub Pages site, and the `powerscroll-mcp` distribution. Read it before
changing a version, creating a tag, publishing to npm, or publishing MCP
Registry metadata. After a deployment, update [`DEPLOYMENTS.md`](DEPLOYMENTS.md)
from observed production state.

## Release surfaces

| Change | GitHub app release | GitHub Pages | npm | Official MCP Registry |
|---|---:|---:|---:|---:|
| Application code or bundled extension | Yes | Yes, from `main` | No | No |
| Root-only development/build dependency | Usually no | Yes, after push | No | No |
| MCP implementation or MCP dependency | Optional attachment/tag | No | Yes | Yes |
| MCP installation identity or metadata | Optional | No | Usually yes | Yes |
| Documentation/site content only | No | Yes, from `main` | Only if npm README must change | Usually no |
| Coordinated application and MCP feature | Yes | Yes | Yes | Yes |

Do not publish merely because a version-looking file changed. First determine
which deployed surface consumes that file.

## Invariants

- npm and MCP Registry versions are immutable. Correct a published mistake with
  a new version.
- npm must contain the exact MCP version before the MCP Registry metadata is
  submitted. Registry validation queries npm during publication.
- The MCP identity is case-sensitive and must be
  `io.github.CynaCons/powerscroll` in both `powernote-mcp/package.json`
  (`mcpName`) and `powernote-mcp/server.json` (`name`).
- An MCP release keeps these values synchronized:
  `powernote-mcp/package.json` version, both root-package entries in
  `powernote-mcp/package-lock.json`, the SDK server version in
  `powernote-mcp/server.js`, `server.json` version, and its package version.
- An application release keeps `src/version.ts` and the root `package.json` /
  `package-lock.json` versions synchronized.
- `dist-template/` is rebuilt and committed at every application release tag.
  Updates and tag-pinned extension fetching depend on the tagged template.
- Preserve legacy `powernote-*` data and protocol identifiers. Release both
  `PowerScroll.html` and the byte-identical `PowerNote.html` compatibility
  alias while old notebooks remain supported.
- Never publish credentials, npm tokens, recovery codes, Registry tokens, or
  local authentication files. Prefer npm Trusted Publishing and MCP Registry
  GitHub OIDC once the backlog automation exists.
- Never publish bytes that have not been reviewed, tested, and committed.
  Never amend a release commit.
- The full Playwright campaign is a local pre-tag confidence run. It is not a
  GitHub publishing-job gate. Do not edit `src/` while it runs because Vite HMR
  reloads test pages.

## Common preflight

1. Confirm the requested release surface and version. An instruction to prepare
   a release is not authorization to push a tag or publish externally.
2. Read `PLAN.md`, relevant SRS files, `CLAUDE.md`, and this runbook. Close or
   explicitly carry every scoped item.
3. Inspect `git status --short`; preserve unrelated user files and changes.
4. Compare local state with the deployed state in `docs/DEPLOYMENTS.md` and the
   live services. Do not assume the ledger is current.
5. Review the diff, dependency audit, compatibility impact, and migration path.

## Application release

1. Finish the iteration's implementation, SRS traceability, tests, and required
   showcase artifact.
2. Set the application version in `src/version.ts`, then update the root npm
   metadata with `npm version <version> --no-git-tag-version`.
3. Run the proportional checks, including at minimum:

   ```bash
   npm run typecheck
   npm run lint -- --max-warnings 9999
   npm run build:template
   npm test --prefix powernote-mcp
   npm run test:bridge
   ```

4. Run focused Playwright coverage for the changed behavior and update path,
   then the complete campaign locally before tagging. Record honest totals,
   failures, retries, and flakes.
5. Smoke-test the built template and the development app: canvas and bridge
   ready, no critical console errors. For update-sensitive changes, exercise a
   real previously released notebook against the intended GitHub release path
   and verify content, extensions, and version survive.
6. Inspect and commit `dist-template/` with source, version, plan, SRS, tests,
   and deployment documentation. Push the commit only when requested.
7. Create and push the annotated release tag only when requested. Never reuse or
   move a published tag. `.github/workflows/release.yml` builds and attaches:
   `PowerScroll.html`, `PowerNote.html`, and `powerscroll-mcp.tgz`.
8. Verify the GitHub release is non-draft, its three assets exist, asset digests
   are present, the in-app update resolves the tag-pinned template, and Pages
   completed from the expected commit.

## MCP release

1. Bump every synchronized MCP version field listed under **Invariants**. Keep
   `mcpName` and Registry `name` exactly `io.github.CynaCons/powerscroll`.
2. Run:

   ```bash
   npm test --prefix powernote-mcp
   npm audit --prefix powernote-mcp
   npm pack --dry-run --prefix powernote-mcp
   ```

   The package should contain only the intended distributable files (currently
   `LICENSE`, `README.md`, `package.json`, and `server.js`). Inspect the output.
3. Commit and push the reviewed package bytes and metadata before publication.
4. Publish the immutable package from `powernote-mcp/`:

   ```bash
   npm publish --access public
   ```

   Browser/passkey authentication may be required. Do not ask anyone to paste a
   token or authenticator code into chat.
5. Wait until the exact version is publicly resolvable. npm may acknowledge a
   publish before its read API has propagated:

   ```bash
   npm view powerscroll-mcp@<version> version
   ```

6. Publish the matching `powernote-mcp/server.json` only after step 5:

   ```bash
   mcp-publisher login github
   mcp-publisher publish powernote-mcp/server.json
   ```

   The interactive login is needed only when no valid Registry session or OIDC
   identity is available.
7. Verify both live systems rather than trusting command exit text:

   ```bash
   npm view powerscroll-mcp name version dist-tags --json
   curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=powerscroll&version=latest"
   ```

   The Registry result must be active, latest, and point to the same exact npm
   version. Then update `docs/DEPLOYMENTS.md`.

## Coordinated application and MCP release

Prepare and test both surfaces in one committed release candidate. Publish in
this order:

1. Commit reviewed source, generated template, version metadata, and docs.
2. Publish the exact MCP package to npm.
3. Wait for npm read-side propagation.
4. Publish and verify the official MCP Registry entry.
5. Push the application tag so GitHub creates the downloadable app release.
6. Verify GitHub Pages, the GitHub release assets, live update, npm, and MCP
   Registry; then update the deployment ledger.

If any external publish fails, do not overwrite, unpublish, retag, or guess.
Record which surfaces succeeded, correct forward with a new immutable version
where required, and resume from the first incomplete surface.

## Planned publishing automation

The backlog item in `PLAN.md` will replace the manual external steps with a
GitHub Actions workflow that supports coordinated tags and MCP-only manual
dispatch. It must:

- use npm Trusted Publishing and MCP Registry GitHub OIDC with `id-token: write`;
- validate versions and the case-sensitive namespace before mutation;
- publish npm first, poll public availability, then publish the Registry entry;
- make reruns safe when an exact version is already present;
- verify both public APIs and write a useful workflow summary;
- avoid long-lived repository secrets and avoid rerunning the full Playwright
  campaign inside the publishing job.

