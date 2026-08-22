# PowerScroll

**A local-first visual notebook in one editable HTML file—with an MCP bridge for AI agents.**

[Try PowerScroll](https://cynacons.github.io/PowerScroll/app/) ·
[Download PowerScroll.html](https://github.com/CynaCons/PowerScroll/releases/latest/download/PowerScroll.html) ·
[Agent setup](#let-an-agent-work-in-your-notebook) ·
[Report a problem](https://github.com/CynaCons/PowerScroll/issues/new/choose)

![PowerScroll visual notebook showing structured pages, independent scrolls, markdown and an editable architecture diagram](site/assets/powerscroll-canvas.png)

PowerScroll combines the hierarchy of OneNote, the freeform canvas of a
whiteboard, and editable diagrams in a notebook you completely own. No account,
server, proprietary database, or cloud connection is required.

## Start in under a minute

1. Open the [live demo](https://cynacons.github.io/PowerScroll/app/) or download
   [`PowerScroll.html`](https://github.com/CynaCons/PowerScroll/releases/latest/download/PowerScroll.html).
2. Add text, images, drawings, shapes, pages, and independent vertical scrolls.
3. Press **Ctrl+S**. The application and your notebook data are saved together
   in one HTML file.
4. Open that file in a browser whenever you want to continue.

The hosted demo does not upload notebook content. Download or save your notebook
to keep it; your browser file is the source of truth.

## Why PowerScroll is different

### One file is the product and the data

Every notebook contains the complete editor, structured workspace, drawings,
images, and optional extensions. It opens offline and remains editable. Sharing
the file shares a working copy rather than an export that needs PowerScroll
installed elsewhere.

### Visual without losing structure

Sections and pages provide notebook hierarchy. Inside each page, named scrolls
create independent vertical workstreams on an infinite canvas. Markdown, math,
images, ink, shapes, PlantUML, Mermaid, SVG, and draw.io content can live beside
one another.

### Humans and agents share the same canvas

The local MCP bridge lets an agent read pages, add and move blocks, manage
scrolls, insert images, create native editable diagrams, and save the notebook.
Agent edits use the same in-memory stores, undo history, and save path as human
edits—there is no shadow database to reconcile.

![PowerScroll agent bridge and editable native diagram workflow](site/assets/powerscroll-agent.png)

## Let an agent work in your notebook

The bridge is off by default and listens only on your machine. Run the published
package directly from npm:

```bash
npx -y powerscroll-mcp
```

Then open a notebook and enable **Settings → Agent bridge → Let a local agent
write into this notebook**. See the [complete tool and client setup guide](powernote-mcp/README.md).

The executable is published as [`powerscroll-mcp`](https://www.npmjs.com/package/powerscroll-mcp)
and its discovery metadata is active in the
[official MCP Registry](https://registry.modelcontextprotocol.io/?q=powerscroll).
The latest GitHub release also carries a package tarball as a fallback, but npm
is the canonical install source.

## Selected capabilities

- Infinite canvas with pan, zoom, touch, lasso, alignment guides, and undo/redo
- Markdown, tables, checkboxes, links, syntax blocks, and KaTeX mathematics
- Images with paste/import, crop, rotate, lightbox, notes, and compact mode
- Freehand pen and erasers; styled rectangles, circles, triangles, arrows, lines, and arcs
- Sections, pages, named resizable scrolls, outline, search, and replace
- Native editable diagrams from PlantUML, Mermaid, SVG, and draw.io
- Direct disk save and autosave in Chrome/Edge, with browser download fallback
- In-app updates that preserve notebook content and installed extensions
- Local multi-agent MCP bridge with a single-writer lease and unblocked reads

## Privacy and security

Normal editing does not require a PowerScroll server or account. Update checks
and optional extension installation contact GitHub; the local agent bridge makes
a loopback WebSocket connection only after the user enables it.

A notebook is executable HTML. Open notebooks only from people you trust, just
as you would any executable document. See [SECURITY.md](SECURITY.md) for the
threat model and private vulnerability-reporting instructions.

## Migrating a PowerNote notebook

PowerScroll opens existing PowerNote notebooks directly. Legacy embedded ids,
internal links, storage, and bridge protocol identifiers remain supported.

For a notebook too old to update itself:

1. Open the latest `PowerScroll.html`.
2. Use the **Open** button to select the old notebook.
3. Press **Ctrl+S** to write the current PowerScroll editor back with its content.

## Development

```bash
npm install
npm install --prefix powernote-mcp
npm run dev
npm run build:template
npx playwright test
npm run test:bridge
```

PowerScroll is built with React, TypeScript, Vite, Konva, and Zustand. Behavioral
requirements and their test traceability live in [`docs/`](docs/). Contribution
expectations are in [CONTRIBUTING.md](CONTRIBUTING.md). Maintainers should use
the [release runbook](docs/RELEASING.md) and update the
[deployment ledger](docs/DEPLOYMENTS.md) after publishing.

## License

[MIT](LICENSE) © 2026 Constantin Chabirand
