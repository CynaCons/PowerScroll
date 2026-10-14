# SRS: Board pages

**Project:** PowerScroll
**Version:** 0.83.2
**Date:** 2026-10-14

## Purpose

Board pages are a separate notebook page kind for lightweight task flow. They
are persisted with the notebook but are not a canvas and do not participate in
canvas undo history.

## Requirements

| ID | Requirement | Priority | Test |
|---|---|---|---|
| REQ-BOARD-001 | A page may be a board; opening it shall not render canvas tools or drawing surface. | Must | T209 |
| REQ-BOARD-002 | The section add controls shall create ordinary Pages and Board pages independently. | Must | T209 |
| REQ-BOARD-003 | A board shall always use the fixed columns To do, In progress, Waiting for feedback, and Done. | Must | T209 |
| REQ-BOARD-004 | A card face shall show its number, #EEF1F0 labels, feedback state/question, title, vivid stable assignee avatar, and relative time written as just now, N min ago, N h ago or N d ago, plus checklist or note metadata. | Should | T209, T210 |
| REQ-BOARD-005 | Each column shall provide inline quick add, committed by Enter and cancelled by Escape. | Must | T209 |
| REQ-BOARD-006 | Cards shall be draggable by pointer within/across columns, with a visible drop position, and movable/reorderable with Alt+arrow keys. | Must | T209 |
| REQ-BOARD-007 | Moving a card into Waiting for feedback shall require a non-empty feedback question; moving it out clears that question. | Must | T209 |
| REQ-BOARD-008 | A card overlay shall edit title, status, assignee, labels, Markdown description, checklist, notes and card history; Escape, close and backdrop shall close it and restore card focus. | Must | T210 |
| REQ-BOARD-009 | Notes shall record the actor and time; owner-created notes display as You. | Must | T210 |
| REQ-BOARD-010 | Board pages and card data shall survive notebook save and reopen through normal workspace serialization. | Must | T209 |
| REQ-BOARD-011 | Board edits shall be persisted but shall not be added to canvas undo history. | Must | T209 |
| REQ-BOARD-012 | The board shall show the 50 newest board events in a 290 px Activity panel, newest first, with actor avatar, action and relative time. | Should | T210 |
| REQ-BOARD-013 | The card overlay shall use a centred 920 x 760 px maximum dialog with an editable header, two-column body and 250 px details/history sidebar. | Must | T210 |

## Traceability

- T209 — `tests/board/209-board-page.spec.ts`
- T210 — `tests/board/210-card-overlay.spec.ts`
