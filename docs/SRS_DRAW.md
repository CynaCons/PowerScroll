# SRS: Drawing & Eraser

**Project:** PowerScroll (formerly PowerNote)
**Version:** 0.10.5
**Date:** 2026-04-23

## Purpose

Allow users to draw freehand strokes on the canvas using a pen tool and erase strokes using stroke-level or zone-level erasers, with full persistence through save/load.

## Requirements

| ID | Description | Priority | Test Ref |
|----|-------------|----------|----------|
| REQ-DRAW-001 | With the draw tool active, clicking and dragging on the canvas shall create a freehand stroke composed of recorded points | Must | — |
| REQ-DRAW-002 | Stroke color shall be configurable via the draw toolbar | Must | — |
| REQ-DRAW-003 | Stroke width shall be configurable between 1px and 20px via the draw toolbar | Must | — |
| REQ-DRAW-004 | Stroke eraser mode shall delete an entire stroke when the eraser cursor contacts any part of it | Should | T189 |
| REQ-DRAW-005 | Zone eraser mode shall remove only the portion of a stroke that falls under the eraser cursor | Should | T189 |
| REQ-DRAW-006 | Zone eraser size shall be configurable (small, medium, large) | Should | T189 |
| REQ-DRAW-007 | Strokes shall persist when navigating away from a page and returning | Must | — |
| REQ-DRAW-008 | Strokes shall be included in the exported HTML file and restored on import | Must | — |
| REQ-DRAW-009 | Freehand strokes shall render visually above all canvas nodes (images, text, shapes), regardless of the node's `layer` value, so the user can annotate over screenshots and other content | Must | T81 |
| REQ-DRAW-010 | The draw, erase, shape and lasso tools shall accept input from mouse, pen (stylus) and touch pointers via pointer events; a pen contact shall never be dropped in favour of a synthesized mouse event (no double strokes) | Must | T135 |
| REQ-DRAW-011 | Pen strokes shall record per-point pressure and render with variable width proportional to pressure; strokes without pressure data (mouse, finger, all previously saved strokes) shall render at constant width exactly as before | Must | T135 |
| REQ-DRAW-012 | A touch-draw mode (`auto` / `always` / `never`) shall control whether a single finger draws or pans in draw mode. In `auto` (default), fingers draw until the first pen contact is seen, after which fingers pan; in `never`, fingers always pan; in `always`, fingers always draw | Must | T136 |
| REQ-DRAW-013 | While a pen contact is active, all touch pointers shall be ignored (palm rejection); a second finger landing during a single-finger touch stroke shall cancel that stroke and hand the gesture to pinch-zoom | Must | T136 |
| REQ-DRAW-014 | The stylus eraser end (pointer `buttons` bit 32) shall erase while held using the current eraser mode and size, and inking shall resume when the eraser end is lifted, without changing the selected tool | Should | T135 |
| REQ-DRAW-015 | Stroke eraser hit-testing shall test against complete stroke segments, with tolerance held constant in screen space across viewport zoom | Must | T189 |
| REQ-DRAW-016 | Stroke eraser contacts shall preview as dimmed pending strokes and commit on pointerup; Escape and pointercancel shall abandon the pending erase | Must | T189 |
| REQ-DRAW-017 | Holding Alt while using the stroke eraser shall unmark touched pending strokes so they survive the gesture | Should | T189 |
| REQ-DRAW-018 | One erase gesture shall create at most one draw undo entry in both stroke and zone modes | Must | T189 |
| REQ-DRAW-019 | Zone eraser shall erase continuously along the swept path between pointer samples | Must | T189 |
