# SRS: Math / LaTeX Rendering

**Project:** PowerScroll (formerly PowerNote)
**Version:** 0.14.0
**Date:** 2026-04-14

## Purpose

Allow users to embed LaTeX math expressions inside text nodes and render them via KaTeX, both inline and as display blocks, without breaking markdown editing or save/load round-trips.

## Requirements

| ID | Description | Priority | Test Ref |
|----|-------------|----------|----------|
| REQ-MATH-001 | Inline math delimited by single `$` (e.g. `$E = mc^2$`) shall be rendered via KaTeX with the `.katex` CSS class in rendered text nodes | Must | T78 |
| REQ-MATH-002 | Display math delimited by `$$ ... $$` shall be rendered as a block with the `.katex-display` CSS class | Must | T78 |
| REQ-MATH-003 | Invalid LaTeX expressions shall be handled gracefully via KaTeX `throwOnError: false` — the node shall not be deleted and the original text shall remain visible | Must | T78 |
| REQ-MATH-004 | Math content shall live inside the markdown source of text nodes and round-trip through save/load without corruption | Must | T78 |
| REQ-MATH-005 | The KaTeX stylesheet shall be bundled into the standalone HTML export so math renders offline with no external CDN fetches | Must | — |
| REQ-MATH-006 | Raw-edit mode shall show the LaTeX source (not the rendered output), so users can edit expressions directly (since v0.89.0: clicking a formula while editing opens its source, REQ-TEXT-067) | Must | T234 |
