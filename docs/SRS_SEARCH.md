# SRS: Search

**Project:** PowerScroll (formerly PowerNote)
**Version:** 0.92.0
**Date:** 2026-10-28

## Purpose

Allow users to search for text content within the current page or across the entire notebook, with result highlighting and navigation.

## Requirements

| ID | Description | Priority | Test Ref |
|----|-------------|----------|----------|
| REQ-SEARCH-001 | Pressing Ctrl+F shall open a page-level search panel that filters text nodes on the current page | Must | T30 |
| REQ-SEARCH-002 | Pressing Ctrl+Shift+F shall open a notebook-wide search panel that searches across all sections and pages | Must | T31 |
| REQ-SEARCH-003 | Search results shall highlight matching text content in the result list | Must | T30 |
| REQ-SEARCH-004 | Clicking a notebook search result shall navigate to the page containing the match | Must | T31 |
| REQ-SEARCH-005 | Pressing Escape while the search panel is focused shall close it | Must | T30 |
| REQ-SEARCH-006 | The search panel shall provide a toggle to enter replace mode, revealing a replace input field | Must | T76 |
| REQ-SEARCH-007 | In replace mode, "Replace All" shall update every matching occurrence across the current search scope (current page or notebook-wide) | Must | T76 |
| REQ-SEARCH-008 | Replace operations shall update the underlying text node content in the canvas store (not just the visible rendering) | Must | T76 |
| REQ-SEARCH-009 | The search panel shall display the total number of matches and a snippet for each result | Should | T76 |

## Search you can find, that finds everything (v0.92.0)

Owner, 2026-10-28: "we don't have a search functionality in PowerScroll. That's obviously needed."
Search existed since v0.10 but only behind Ctrl+F, and Ctrl+Shift+F never fired for a real
keyboard (the handler compared `e.key` with lowercase `f` while Shift sends `F`). The rows below
are written from the user's side: what they see, press and get.

| ID | Description | Priority | Test Ref |
|----|-------------|----------|----------|
| REQ-SEARCH-010 | The nav rail shall carry a Search button (magnifier, tooltip "Search (Ctrl+F)") that opens the search panel scoped to the whole notebook, with the cursor in the search field | Must | T237 |
| REQ-SEARCH-011 | The panel shall show a scope switch "This page" / "Whole notebook"; Ctrl+F opens it on "This page", Ctrl+Shift+F on "Whole notebook", and switching scope keeps the typed query | Must | T237 |
| REQ-SEARCH-012 | Ctrl+Shift+F shall open notebook search for a real keyboard, whatever the case of the reported key | Must | T237 |
| REQ-SEARCH-013 | Search shall open and work on board pages too (button, Ctrl+F, Ctrl+Shift+F); "This page" on a board searches its cards | Must | T237 |
| REQ-SEARCH-014 | Notebook search shall find, besides text blocks and diagrams: section titles, page titles, scroll titles, board card titles, descriptions, checklist items and notes, shape labels, and image captions and alt text. Archived board cards are not searched | Must | T238 |
| REQ-SEARCH-015 | Text blocks shall be matched against the text as the reader sees it: formatting symbols, link addresses and HTML tags neither match nor appear in snippets, and a phrase that runs across formatting ("very **bold** move" found by "very bold move") is found. Diagram sources written in XML (draw.io, SVG) are matched on their labels, not their tags | Must | T238 |
| REQ-SEARCH-016 | Matching shall ignore case and accents ("ecole" finds "École") | Must | T238 |
| REQ-SEARCH-017 | Each result shall say what matched (Text, Diagram, Shape, Image, Card #N, Page title, Section title, Scroll title) and show a snippet in which every occurrence of the query inside the snippet is marked | Must | T238 |
| REQ-SEARCH-018 | Notebook results shall be grouped under one "Section > Page" heading per page, in notebook order | Should | T238 |
| REQ-SEARCH-019 | Choosing a canvas result shall open its page, select the block and move the view so the whole block, or its top when taller than the view, is visible; the zoom level is kept | Must | T239 |
| REQ-SEARCH-020 | Choosing a board card result shall open its board page and open that card | Must | T239 |
| REQ-SEARCH-021 | Choosing a page, section or scroll title result shall open that page (a section opens its first page) | Must | T239 |
| REQ-SEARCH-022 | The first result shall be active; ArrowDown and ArrowUp shall move the active result (kept scrolled into view) and Enter shall open it | Must | T239 |
| REQ-SEARCH-023 | On a notebook of 2,000 text blocks, results shall update within 100 ms of a keystroke | Should | T238 |

REQ-SEARCH-007 and REQ-SEARCH-008 are unchanged: Replace All edits the stored text of text blocks
only; titles, cards, shapes and diagrams are found but never rewritten by Replace.
