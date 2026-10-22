# Design: text block engine (v0.89.0)

**Date:** 2026-10-22 · **Requirements:** docs/SRS_TEXT.md, REQ-TEXT-049..066

## Context

The owner, 2026-10-22: "I wanted to select a piece of text and put it in bold, and then the entire text block was in bold, and I wasn't able to unbold anymore. Nothing was working ... This text block needs a redesign."

An audit of v0.88.1 with real mouse and keyboard found 28 problems. They come from three design faults:

1. **Bold and italic lived in two places.** One was the block-wide `fontStyle`, which the toolbar set when no editor was open. The other was inline `**` written by the editor. The editor could not remove the first, and the toolbar showed only the first.
2. **The editor showed raw markdown** in CodeMirror, while the finished block was HTML from `marked`. Two renderers meant text jumped when editing started, markers showed, and lists, checkboxes, tables and math looked different.
3. **Formatting was text surgery on markers.** Repeating a command could leave `****`, `wo****rld`, `hello** new**` or broken overlaps.

## Decision

- **One formatting model.** Formatting belongs to the text and is stored as markdown, which is the contract with agents and files. `fontStyle` is never written again. Old files that carry `bold` or `italic` there are read as bold or italic on all of the text. Size, font and colour stay block-wide.
- **ProseMirror is the editor.** It holds a structured document (paragraphs, headings, lists, task rows, quotes, code, tables, math, marks), so formatting is a set of marks, not characters. Toggling is exact, and the pressed state at the caret is a lookup.
- **One renderer.** The finished block is the same ProseMirror document drawn by the same `DOMSerializer`, then sanitised (REQ-TEXT-053). Editing and viewing are the same DOM inside the same `.powernote-markdown` box, so nothing moves (REQ-TEXT-054).
- **The app owns the markdown dialect.** Parsing uses `marked.lexer`, the tokenizer the renderer already used, after the app's existing normalisers (`normalizeListIndents`, `neutralizeSetextHeadings`). The serializer is the app's own and writes:
  - `-` bullets and ordered children indented by 4;
  - a single newline for a line break (marked `breaks: true`);
  - `- [ ]` task rows, GFM tables, `$..$` and `$$..$$` math;
  - `<u>` for underline, and bare autolinks.
- **No-op sessions do not rewrite text.** If an edit session changed nothing, `data.text` keeps its original string byte for byte (REQ-TEXT-064).

The prototype round-tripped a 59-item corpus from tests, the bridge and list habits. All 59 rendered the same and 42 were byte-identical. The remaining diffs are canonical forms that render the same: `*` to `-` bullets, `1)` to `1.`, and a blank line after a heading.

## Alternatives rejected

| Option | Why not |
|---|---|
| CodeMirror 6 live preview (Obsidian style) | It fixes the toolbar but not parity. It is line-based, so there are no real lists, tables or block math, and markers come back on the caret line. |
| Tiptap | ProseMirror plus about 250 KB, and its markdown defaults clash with the dialect in five places (`++u++`, trailing spaces for breaks, escaped TeX, loose lists, dropped images). |
| prosemirror-markdown with markdown-it | A second markdown parser that disagrees with `marked` on edge cases, plus 97 KB. Its default parser collapses single newlines and tables. |
| Lexical, Milkdown | Lexical's markdown layer does not model tables, underline, math or tasks. Milkdown brings the unified stack (about 490 KB) and is hard to test headless. |

## Consequences

- **Size:** the bundle shrinks by about 66 KB raw once CodeMirror is removed (ProseMirror core plus tables is about 235 KB raw, CodeMirror about 301 KB).
- **Retired:** `markdownToggle.ts` and the marker-surgery parts of `markdownCommands.ts`, as their commands become ProseMirror commands. `htmlToMarkdown.ts` stays for paste. `listIndent.ts` and `mathParser.ts` stay for parsing.
- **Tests:** tests that selected by markdown offset or asserted visible markers are rewritten to select words the way a user does. The editor handle `__POWERNOTE_TEXT_EDITOR__` keeps its names: `getValue` and `setValue` take markdown.
- **Decisions the owner accepted (2026-10-22):** Bold on a selected block formats all its text instead of setting a block style. Per-word colour and size are out of scope.

## What would reopen this

- A markdown feature that agents write and the serializer cannot round-trip without visible loss.
- Text editing that measurably lags (more than 16 ms per keystroke on a 5,000-character block).
- A need for per-word colour or size, which markdown cannot store cleanly.
