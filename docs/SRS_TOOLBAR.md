# SRS: Bottom Toolbar

**Project:** PowerScroll (formerly PowerNote)
**Version:** 0.43.0
**Date:** 2026-08-16

## Purpose

Provide a contextual toolbar for formatting text properties (font size, style, color) on new and existing text blocks.

## Requirements

| ID | Description | Priority | Test Ref |
|----|-------------|----------|----------|
| REQ-TOOL-001 | The bottom toolbar shall appear when the text tool is active or a text node is selected | Must | T10 |
| REQ-TOOL-002 | The toolbar shall provide font size selection from predefined sizes | Must | T11 |
| REQ-TOOL-003 | (superseded by REQ-TEXT-050, REQ-TEXT-052) The toolbar shall provide bold, italic, underline, strikethrough, and inline-code buttons. Bold/italic toggle the whole node when no editor is open and operate on the substring selection when an editor is open. Underline/strike/code are only enabled while editing. | Must | T11, T83 |
| REQ-TOOL-004 | The toolbar shall provide text color selection | Must | T11 |
| REQ-TOOL-005 | (superseded by REQ-TEXT-050, REQ-TEXT-060 for bold/italic) When a text node is selected (not being edited), bold/italic shall toggle the whole block's style; size/color changes shall update that node in real-time | Must | T11 |
| REQ-TOOL-006 | (bold/italic excluded by REQ-TEXT-052; size and colour still apply) When no node is selected (text tool mode), toolbar changes shall set defaults for new text blocks | Should | T11 |
| REQ-TOOL-007 | When a text block is being edited, formatting buttons shall format **only the selected text** (inline markdown), shall not blur the editor or commit the edit, and shall preserve the textarea selection across the click | Must | T83, T84 |
| REQ-TOOL-008 | The color, size and eraser popovers shall never be clipped by the toolbar's own bounding box, on any viewport width; they render anchored to their trigger button via a `document.body` portal, independent of the toolbar's overflow | Must | T141 |
| REQ-TOOL-009 | On viewports narrower than the toolbar's natural width, the toolbar shall scroll horizontally (`overflow-x: auto`, no visible scrollbar) rather than spill off-screen or wrap | Must | T141 |
| REQ-TOOL-010 | On coarse (touch) pointers, the selection Transformer's resize handles shall render at a finger-sized target instead of the mouse-sized default; desktop (fine pointer) rendering is unchanged. This is selection/canvas UX (`SelectionTransformer.tsx`) rather than toolbar chrome, but is tracked here alongside the other v0.43 touch-target work | Must | T140 |
| REQ-TOOL-011 | The bottom toolbar and the floating ZoomBar shall never overlap on any viewport width — on viewports ≤768px the ZoomBar stacks above the toolbar instead of sharing its bottom-right corner; on wider viewports both keep today's bottom-right/bottom-center layout unchanged | Must | T142 |
