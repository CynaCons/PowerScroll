# SRS: Storefront (GitHub Pages site)

**Project:** PowerScroll (formerly PowerNote)
**Version:** 0.76.0
**Date:** 2026-09-05

## Purpose

The public storefront at `site/` is what GitHub Pages serves at the repository
root. Its single job is to get a visitor to open the live notebook (`./app/`)
or download `PowerScroll.html`. It is plain static HTML and CSS copied verbatim
by `.github/workflows/pages.yml`; nothing in `src/` renders it.

Design rules the page follows, so a future edit does not drift back to a
template: the palette is the diagram token set (`src/diagram/tokens.ts`), the
app's selection blue marks only things the visitor can act on, and ACCENT
(`#B4552D`) marks the one genuine hazard (a notebook is executable HTML) and is
never decoration.

## Requirements

| ID | Description | Priority | Test Ref |
|----|-------------|----------|----------|
| REQ-SITE-001 | The hero shall be laid out as a PowerScroll canvas: at least three named scrolls (title band, paper surface) standing side by side on the canvas ground, the first one carrying the headline and the primary actions | Must | T200 |
| REQ-SITE-002 | Each hero scroll shall be resizable by dragging the handle at the right edge of its title band, and by arrow keys when the handle is focused, mirroring the app's own scroll-resize gesture (REQ-SCROLL widths); width shall be clamped to a readable range | Must | T200 |
| REQ-SITE-003 | The primary action shall link to the live notebook (`./app/`) and the secondary action to the latest `PowerScroll.html` release download; the header and the closing call to action shall use the same labels as the hero | Must | T200 |
| REQ-SITE-004 | The page shall keep its discovery metadata: `<title>`, `description`, canonical URL, Open Graph tags and the `SoftwareApplication` JSON-LD block | Must | T200 |
| REQ-SITE-005 | Every product screenshot on the page shall be captured from the running app (never mocked in HTML), and the page shall load with no console errors when served from disk | Must | T200 |
