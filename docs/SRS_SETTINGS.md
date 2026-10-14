# SRS: Settings

**Project:** PowerScroll (formerly PowerNote)
**Version:** 0.81.0
**Date:** 2026-07-18

## Purpose

Provide a settings panel for configuring application preferences such as canvas background mode and page guide visibility.

## Requirements

| ID | Description | Priority | Test Ref |
|----|-------------|----------|----------|
| REQ-SETTINGS-001 | (superseded by REQ-SETTINGS-021) A settings gear icon at the bottom of the NavRail shall toggle a settings panel | Must | — |
| REQ-SETTINGS-002 | The settings panel shall provide a background mode toggle with options: pages (A4 guides), grid, and none | Must | T85 |
| REQ-SETTINGS-003 | Settings selections shall live in workspace state and survive page navigation within the session | Must | T85 |
| REQ-SETTINGS-004 | Canvas settings (`backgroundMode`, `bgColor`) shall be serialized inside `#powernote-data` and restored on open/reload so each notebook remembers its look; older files without `settings` shall hydrate with defaults (pages, white) | Must | T85 |
| REQ-SETTINGS-005 | A `scroll` guide style shall render each occupied column as one continuous sheet with a light separator at every page boundary, rather than as detached A4 cards, and shall keep one blank page of headroom below the last block | Must | T101 |
| REQ-SETTINGS-006 | An agent shall read (`get_background`) and change (`set_background`) the guide style and background colour; the change shall mark the notebook dirty so the existing save pipeline persists it, with no separate persistence path | Must | T102, T103 |
| REQ-SETTINGS-010 | Guide style and background colour shall be settable PER PAGE, stored as an optional `Page.settings` override; an absent override shall mean the page inherits the notebook default, so pages written before overrides existed need no migration | Must | T133 |
| REQ-SETTINGS-011 | An override shall apply field by field: a page pinning only its guide style shall continue to follow the notebook default for colour, rather than freezing the colour at the moment the override was made | Must | T133 |
| REQ-SETTINGS-012 | The resolved look shall be read through one helper (`resolvePageSettings`), which shall also report, per field, whether the value came from the page or the notebook | Must | T133 |
| REQ-SETTINGS-013 | The settings panel shall offer a scope switch (This page / All pages). It shall default to ALL PAGES, because these controls meant notebook-wide before overrides existed and an unchanged click must not silently change meaning. While the scope is All pages the panel shall show the notebook default, not the active page's override | Must | T133, T85 |
| REQ-SETTINGS-014 | Changing the notebook default shall NOT overwrite pages that already carry an override. A page shall return to the default only by an explicit clear, which shall DROP the `settings` key rather than leave an empty object | Must | T133 |
| REQ-SETTINGS-015 | `set_background` shall accept `scope: 'notebook' | 'page'` and shall DEFAULT TO NOTEBOOK, preserving the meaning the shipped tool already had. `get_background` shall report the page's effective look plus `source` and `notebookDefault`, so an agent restoring "the previous look" cannot restore something that was never displayed | Must | T102 |
| REQ-SETTINGS-016 | The settings panel shall offer the touch-draw mode (`auto` / `always` / `never`, REQ-DRAW-012) as a DEVICE setting: stored in localStorage, surviving reload, and never written into the notebook file — which finger behaviour suits a device is a property of the device, not of the document | Must | T137 |
| REQ-SETTINGS-017 | The app shall ship an installable web app manifest (`manifest.webmanifest`, linked from `index.html`) declaring `display: standalone` and 192px/512px icons, so it can be added to a home screen or installed as a standalone app. A service worker (offline support) is explicitly out of scope for this requirement | Must | T145 |
| REQ-SETTINGS-018 | The settings panel shall offer an Extensions section listing the draw.io viewer with a status (`not-installed` / `installing` / `installed` + version / `failed` + reason and Retry) and an Install action that fetches the asset, validates it, and caches it in IndexedDB (`powernote-extensions`). Install is per-browser; a private-mode browser without IndexedDB degrades to per-session behaviour rather than erroring | Must | T181 |
| REQ-SETTINGS-019 | A held extension shall be embedded into the notebook HTML on every save as `<script id="powernote-ext-drawio" type="text/plain">BASE64</script>` — held meaning installed via Settings, harvested from an opened notebook that carried the block, or loaded by rendering a draw.io diagram this session (using draw.io makes the notebook self-carrying, per the original design intent). Re-injected from the runtime accessor rather than relying on DOM survival (the dev save path refetches a pristine template), exactly once per save (replace-by-id, never duplicated), and never as raw executable JS. A notebook that never touched draw.io stays lean | Must | T182, T184 |
| REQ-SETTINGS-021 | The NavRail gear shall open Settings as a modal overlay centred over a dimmed backdrop, sized to 80% of the window's width and height (at widths of 768 px or less: the full window less an 8 px margin), replacing the 220 px pop-up — owner request 2026-10-14 | Must | T207 |
| REQ-SETTINGS-022 | The overlay shall close by a close cross in its top-right corner, by Escape (which then does not also reach the canvas, so it neither clears the selection nor exits isolation), and by a press that starts on the backdrop. On open, focus moves into the overlay; Tab stays inside it; on close, focus returns to the control that opened it | Must | T207 |
| REQ-SETTINGS-023 | Settings shall be one continuously scrolling page of sections (Page look, Drawing & input, Saving & recovery, Agent bridge, Extensions, About & updates) beside a side index of the same sections. Choosing an index entry scrolls its section to the top of the page; while scrolling, the index marks the section being read (the last one whose heading has passed the top, or the last section when scrolled to the bottom) | Must | T207 |
