---
name: powerscroll-release
description: Prepare, publish, verify, or audit PowerScroll application, GitHub Pages, npm MCP, and official MCP Registry releases. Use for version bumps, tags, release workflows, deployment checks, or distribution failures; do not use for ordinary feature implementation before release preparation begins.
---

# PowerScroll Release

Use the repository's canonical release documentation rather than reconstructing
the process from shell history or prior chat.

1. Read [`docs/RELEASING.md`](../../../docs/RELEASING.md) completely before any
   version, tag, npm, Registry, GitHub release, or Pages mutation.
2. Read [`docs/DEPLOYMENTS.md`](../../../docs/DEPLOYMENTS.md), then query every
   live surface in scope because the ledger may lag production.
3. Determine whether the change is app-only, build/docs-only, MCP-only, or
   coordinated. Publish only the surfaces required by that classification.
4. Preserve unrelated working-tree changes. Never publish uncommitted or
   unverified bytes, reuse an immutable version, move a published tag, expose a
   credential, or bypass a failed check without reporting it.
5. Require explicit user authorization immediately before an external publish
   or tag push unless the current request already clearly grants it. Browser,
   passkey, or GitHub device authorization remains the user's step.
6. For MCP publication, enforce the case-sensitive
   `io.github.CynaCons/powerscroll` identity and npm-before-Registry order.
7. After publishing, verify the public APIs and artifacts, update the deployment
   ledger from observed results, and report partial success honestly if surfaces
   diverge.

The full Playwright campaign is local pre-tag evidence, not a publishing-job
gate. Follow `CLAUDE.md` for planning, SRS, showcase, commit, and test-reporting
requirements that are outside distribution mechanics.

