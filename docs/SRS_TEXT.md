# SRS: Text Blocks

**Project:** PowerScroll (formerly PowerNote)
**Version:** 0.68.0
**Date:** 2026-08-25

## Purpose

Allow users to create, edit, move, and delete markdown-capable text blocks on the canvas.

## Requirements

| ID | Description | Priority | Test Ref |
|----|-------------|----------|----------|
| REQ-TEXT-001 | With the text tool active, clicking the canvas shall place a new text block at the click position | Must | T03 |
| REQ-TEXT-002 | A newly placed text block shall immediately enter inline edit mode | Must | T03 |
| REQ-TEXT-003 | Double-clicking an existing text block shall enter inline edit mode | Must | T04 |
| REQ-TEXT-004 | Blur (click away) shall commit the text edit | Must | T04 |
| REQ-TEXT-005 | (superseded by REQ-TEXT-047) Pressing Escape during edit shall cancel and revert | Must | T04 |
| REQ-TEXT-006 | Text blocks shall be draggable to reposition on the canvas | Must | T05 |
| REQ-TEXT-007 | Text block **height** shall auto-size to laid-out content at the current width; **width** is intentional (page default or user-resized) and shall not auto-shrink to content | Must | T21 |
| REQ-TEXT-008 | Text shall reflow (word-wrap) within the block width | Must | T16 |
| REQ-TEXT-009 | Delete/Backspace key shall delete the selected text block(s) | Must | T06 |
| REQ-TEXT-010 | The T key shall toggle the text tool on/off | Should | T06 |
| REQ-TEXT-011 | The text tool shall revert to select after placing one text block (one-shot) | Must | — |
| REQ-TEXT-012 | Single click on a text block shall select it (not edit) | Must | — |
| REQ-TEXT-013 | Ctrl+Click shall toggle multi-selection | Must | — |
| REQ-TEXT-014 | Ctrl+C / Ctrl+V shall copy and paste selected text blocks | Must | — |
| REQ-TEXT-015 | Ctrl+A shall select all nodes on the current page | Should | — |
| REQ-TEXT-016 | Text content shall be rendered as markdown (headers, bold, italic, lists, code, blockquotes) | Must | — |
| REQ-TEXT-017 | The text editor shall support Tab/Shift+Tab for indentation | Should | — |
| REQ-TEXT-018 | The text editor shall auto-continue bullet points and numbered lists on Enter | Should | — |
| REQ-TEXT-019 | Shift+drag shall show snap alignment guides when edges/centers align with other nodes | Should | — |
| REQ-TEXT-020 | Newly placed text blocks shall default to **one page width** (A4 at 96 DPI = 794px). Width shall be preserved across edit commits. Minimum width 60px; wider-than-page widths are allowed (soft max for drag safety only) | Must | T03, T21, T92 |
| REQ-TEXT-021 | Markdown task list checkboxes (- [ ] / - [x]) shall be clickable to toggle state | Must | — |
| REQ-TEXT-022 | While editing a text block, applying bold/italic shall wrap **only the selected text** in markdown markers (`**`/`*`), leaving the rest of the block unaffected — it shall NOT change the whole block's style | Must | T83 |
| REQ-TEXT-023 | While editing, Ctrl/Cmd+B and Ctrl/Cmd+I shall apply bold/italic to the current selection (same inline behavior as the toolbar buttons) | Should | T83 |
| REQ-TEXT-024 | While editing with no text selected, applying bold/italic shall insert an empty marker pair and place the caret between the markers, so subsequently typed text is formatted (Word-style) | Should | T83 |
| REQ-TEXT-025 | While editing, applying Strike/Code/Underline shall wrap only the selected substring (or unwrap if already wrapped); when no substring is selected the markers shall be inserted at the caret | Must | T84 |
| REQ-TEXT-026 | The text editor shall support Ctrl+U (underline), Ctrl+E (inline code), Ctrl+Shift+X (strikethrough) keyboard shortcuts | Should | T84 |
| REQ-TEXT-027 | Underline shall be persisted as `<u>...</u>` HTML inside the markdown source and rendered as an underline by the markdown renderer | Should | T84 |
| REQ-TEXT-028 | While editing, the text editor wrap width shall equal the node’s intentional width (not a temporary stub narrower than the node) | Must | T92 |
| REQ-TEXT-029 | When a text block is selected (not editing), left/right resize handles shall change width; height remains content-driven after reflow | Must | T92 |
| REQ-TEXT-030 | Markdown headings shall render visually larger and heavier than body text — `#` at 1.6em/700, `##` at 1.3em/600, `###` at 1.1em/600 | Must | T58 |
| REQ-TEXT-031 | Heading sizes shall be expressed relative to the block's own `fontSize`, so changing a block's font size scales its headings with it | Must | T58 |
| REQ-TEXT-032 | Double-tapping an existing text block (touch) shall enter inline edit mode, matching double-click (REQ-TEXT-003) | Must | T139 |
| REQ-TEXT-033 | Tab on a numbered list item shall nest it under the previous sibling as a child ordered list (CommonMark content-column indent, restarting at 1); Shift+Tab shall un-nest it and restore parent numbering. Bullet indent (2 spaces) is unchanged. | Must | T188 |
| REQ-TEXT-034 | Nested ordered lists shall cycle marker style by depth: decimal, lower-alpha, lower-roman, then decimal again | Should | T188 |
| REQ-TEXT-035 | While editing, an inline format (bold, italic, strike, code, underline) applied to a selection spanning one or more lines shall be applied per line inside each line's block prefix (indent, quote marker, list marker, task box, heading hashes) and per cell in table rows, so `- row` becomes `- **row**` and lists, quotes, headings and tables keep their structure; code-fence lines, rules and table delimiter rows are left alone. Owner report 2026-10-16 | Must | T219 |
| REQ-TEXT-036 | Whitespace at the edges of a formatted piece shall stay outside the markers (`**word** `, never `**word **`). When every selected piece already has the format, applying it again shall remove it; otherwise it is added to the pieces that lack it, absorbing stray markers of the same kind inside them | Must | T219 |
| REQ-TEXT-037 | A line of only `-` or `=` directly under a non-blank line shall never render the line above as a heading (no setext headings): a lone `-` renders as an empty list row, `---` or longer as a horizontal rule, any other run (`--`, `=`, `===`) as plain text; inside code fences nothing changes. Headings come from `#`. Owner report 2026-10-16 | Must | T219 |
| REQ-TEXT-038 | While editing, the text block shall show its markdown styled: headings at the rendered sizes (REQ-TEXT-030), bold, italic, strikethrough, monospace code, links and quotes as they will render, with the markdown markers drawn in a dimmed colour. The stored text remains markdown. Owner 2026-10-16: "modern robust text editing" | Must | T220 |
| REQ-TEXT-039 | The editor shall keep its own undo history while editing: Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) step through typing and commands, and each format, heading, list or link command is one undo step | Must | T220 |
| REQ-TEXT-040 | Opening an existing block for editing shall place the caret where the user double-clicked (or double-tapped) and select nothing, so a single key cannot replace the block's text; a new block opens empty with the caret in it | Must | T220 |
| REQ-TEXT-041 | Ctrl+Shift+1/2/3 (also Ctrl+Alt+1/2/3 where the layout has no AltGr characters on the digits) shall set the touched lines to a level 1/2/3 heading and Ctrl+Shift+0 / Ctrl+Alt+0 back to text; applying the level a line already has turns it back to text. The toolbar heading menu (H1, H2, H3, Text) does the same | Must | T221 |
| REQ-TEXT-042 | A list row made a heading shall leave the list (marker removed), so the heading separates the rows above and below; a heading turned back to text whose neighbouring row is a list row at the same indent shall get that row's marker back | Must | T221 |
| REQ-TEXT-043 | Ctrl+Shift+8 / 7 / 9 and the toolbar list buttons shall switch the touched non-blank lines to bullets / numbers (counted 1, 2, 3 per indent) / an unchecked checklist; when every line already is that kind, the markers are removed | Must | T221 |
| REQ-TEXT-044 | Ctrl+Enter shall tick or untick the checkboxes on the touched lines; Alt+Up / Alt+Down shall move the touched lines; Backspace with the caret right after a list marker or heading hashes shall remove that marker; Enter in a list row continues the list (next number, empty checkbox) and Enter on a row holding only its marker ends the list | Must | T221 |
| REQ-TEXT-045 | Ctrl+K shall wrap the selection as a markdown link with the address placeholder selected (a link text placeholder when nothing is selected); pasting a URL over selected text on one line shall make that text a link to the URL | Should | T222 |
| REQ-TEXT-046 | Pasting HTML that carries formatting (web pages, Word, Google Docs, OneNote) shall insert markdown keeping headings, bold, italics, underline, strikethrough, lists, links, tables and code; HTML without formatting (e.g. coloured code from an editor) shall paste as its plain text | Should | T222 |
| REQ-TEXT-047 | (superseded by REQ-TEXT-048) Pressing Escape while editing shall leave edit mode and keep the text, the same as clicking away (the app's long-standing behaviour; typed text is never discarded by a key). Supersedes REQ-TEXT-005 | Must | T04 |
| REQ-TEXT-048 | Pressing Escape while editing shall leave edit mode, keep the text (a new empty block stays where it was placed), clear the selection and give the keyboard back to the canvas, so the block can be dragged at once from anywhere on it. Clicking away still commits and keeps the block selected. Supersedes REQ-TEXT-047 | Must | T04, T226 |
