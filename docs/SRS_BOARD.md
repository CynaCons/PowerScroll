# SRS: Board pages

**Project:** PowerScroll
**Version:** 0.83.4
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
| REQ-BOARD-014 | Every board write from the agent bridge shall record the supplied `actor` on the card, note and board event it produces. | Must | T211 |
| REQ-BOARD-015 | Moving a card to Waiting for feedback over the bridge shall fail with `QUESTION_REQUIRED` when no question is supplied and the card has none. | Must | T211 |
| REQ-BOARD-016 | Bridge card commands shall accept a card by id, by number (`15`) or by `#15`. | Must | T211 |
| REQ-BOARD-017 | Board bridge commands shall update the board in place and shall not switch the owner's active page or disturb the canvas. | Must | T211 |
| REQ-BOARD-018 | The app shall accept a server `agents` frame `{type:'agents', agents:[{label, role, connectedAt}]}` and store the connected labels. | Must | T212 |
| REQ-BOARD-019 | (superseded by REQ-BOARD-024) A board shall show an agents strip between the header and the columns: one chip per name that is connected or that acted on this board in the last 30 minutes, with avatar, name, status line and a presence dot. | Must | T212 |
| REQ-BOARD-020 | A card is active while its assignee has acted on it in the last 60 s and is still connected: 2 px ring in the agent colour, glow at 22% alpha, 2.4 s pulse, footer "<name> · working now". The window lapsing or the agent disconnecting fades the highlight over ~600 ms. Under `prefers-reduced-motion: reduce` the ring stays and animation is off. Recomputed on a 5 s ticker. | Must | T212 |
| REQ-BOARD-021 | A card changed by someone other than `you` shall flash its background for ~1.2 s; the owner's own edits shall not. | Must | T212 |
| REQ-BOARD-022 | `board_updates` with no `since` shall return `{events: [], cursor}` for the latest event; with `since` it shall return events with seq greater than that cursor. | Must | T211 |
| REQ-BOARD-023 | The Needs me header filter shall show a count badge of cards in Waiting for feedback. | Should | T212 |
| REQ-BOARD-024 | Agent chips shall come from board activity only: a name gets a chip when it acted on this board in the last 30 minutes and has not left. Connected-but-silent MCP process labels shall not appear. Chip avatar, status line and presence-dot colour/blink are unchanged. | Must | T213 |
| REQ-BOARD-025 | A name shall leave the strip (chip removed, its cards stop being active at once, the active fade still plays) when (a) `agent_leave` is called, (b) an `agents` frame arrives without a previously listed process label equal to that name, (c) the owner dismisses the chip via its × (`board-agent-dismiss-<name>`), or (d) 30 minutes of silence on this board. Acting again by that name shall restore the chip and clear left. | Must | T213 |
| REQ-BOARD-026 | A live card may be archived (`archivedAt` set, `archived` event); archived cards are excluded from column order/renumbering, counts, the Needs me filter and "Board · N cards". Done's Clear button (`board-clear-done`) shall confirm inline (`board-clear-done-confirm`) then archive every live Done card. Overlay Archive (`card-archive`) archives that card and closes. `Archived (N)` (`board-archived-toggle`) lists archived cards with Restore (`board-restore-<number>`), which returns a card to the end of its previous column (`restored` event). `moveCard`/`updateCard` on an archived card fail with `ARCHIVED`. Archive state shall persist across save and reopen. | Must | T214 |
| REQ-BOARD-027 | Clicking an agent chip body shall toggle a transient spotlight on that name (`aria-pressed`, `data-spotlight` on the board): cards whose assignee or createdBy is that name stay at full opacity with a 2 px ring in the agent's colour; all other cards dim to about 0.35 opacity. Columns stay in place. Clicking the same chip, another chip, or Escape (when no overlay is open) shall change or clear it. Spotlight shall combine with the All / Needs me filter; dimmed cards stay clickable; active highlighting still shows on top. | Must | T215 |
| REQ-BOARD-028 | The activity panel shall collapse to a 44 px rail from a button in its header, giving the columns the space; the rail shows the live dot, the count of events that arrived while collapsed, and expands on click (the count then clears). The collapsed state is a device preference (localStorage), not saved in the notebook. Owner request 2026-10-14 | Must | T216 |
| REQ-BOARD-029 | Text typed in the card overlay (title, description, assignee) shall stay a draft until the overlay closes (X, Escape, backdrop, Archive, leaving the board or the tab going hidden); closing then writes at most one `updated` event for title and description together and one `claimed`/`released` for the assignee, and nothing if the text is unchanged. Typing shall never write an event per keystroke. Enter in the title or assignee ends editing without saving early. Card history and the activity list shall show a run of adjacent `updated` events by the same actor on the same card as one line. Owner report 2026-10-14 | Must | T218 |

## Traceability

- T209 — `tests/board/209-board-page.spec.ts`
- T210 — `tests/board/210-card-overlay.spec.ts`
- T211 — `tests/agent/211-board-agent-tools.spec.ts`
- T212 — `tests/board/212-live-board.spec.ts`
- T213 — `tests/board/213-agents-leave.spec.ts`
- T214 — `tests/board/214-clear-done.spec.ts`
- T215 — `tests/board/215-agent-spotlight.spec.ts`
- T216 — `tests/board/216-activity-collapse.spec.ts`
- T218 — `tests/board/218-card-drafts.spec.ts`
