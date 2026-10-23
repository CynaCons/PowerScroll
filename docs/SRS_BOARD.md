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
| REQ-BOARD-029 | (assignee clause superseded by REQ-BOARD-036) Text typed in the card overlay (title, description, assignee) shall stay a draft until the overlay closes (X, Escape, backdrop, Archive, leaving the board or the tab going hidden); closing then writes at most one `updated` event for title and description together and one `claimed`/`released` for the assignee, and nothing if the text is unchanged. Typing shall never write an event per keystroke. Enter in the title or assignee ends editing without saving early. Card history and the activity list shall show a run of adjacent `updated` events by the same actor on the same card as one line. Owner report 2026-10-14 | Must | T218 |
| REQ-BOARD-030 | Clicking a checklist item's text in the card overlay shall turn it into an input; Enter or leaving the input saves the new text as one `updated` event, Escape cancels the edit without closing the card, and blank or unchanged text saves nothing. Owner request 2026-10-20 | Must | T223 |
| REQ-BOARD-031 | Checklist items shall reorder by dragging their grip handle (mouse, pen or touch) and by Alt+Up / Alt+Down on a focused item; the new order is saved with the card and keeps keyboard focus on the moved item. Owner request 2026-10-20 | Must | T223 |
| REQ-BOARD-032 | A card with checklist items shall show a done/total progress bar on its face and in the overlay; the bar fills in proportion and turns green when every item is ticked. Cards without items show no bar. Owner request 2026-10-20 | Must | T223 |
| REQ-BOARD-033 | A card face shall preview its first 5 checklist items in their order, each with an open or ticked box, ticked items struck through, text cut to one line, then "+N more" when there are more; the preview is read-only and clicking it opens the card. Cards without items show no preview. Owner request 2026-10-20 | Must | T223 |
| REQ-BOARD-034 | While a card is dragged (mouse, pen or touch), a tilted copy of it shall follow the pointer at the grab offset, the card shall leave its column, the landing slot shall have the card's height, and cards around the slot shall slide rather than jump; on release the card shall glide from the pointer into its slot. Escape during the drag puts the card back. A release after a drag never opens the card. Animations are skipped when the system asks for reduced motion. Owner request 2026-10-20 | Must | T224 |
| REQ-BOARD-035 | The card overlay sidebar shall open with a Details panel listing Status, Assignee, Labels, Created and Updated as rows. Status, Assignee and Add label shall open anchored menus (not native selects or datalists): Status lists the four columns with their colour and a tick on the current one; Assignee lists You and every name on the board with avatars, a search field, "Assign to" for a new name and Unassign; Add label lists the board's other labels and creates a typed one. Arrow keys move through a menu, Escape or a click outside closes it (Escape does not close the card), focus returns to the trigger. Owner request 2026-10-20 | Must | T210, T225 |
| REQ-BOARD-036 | Choosing an assignee in the Assignee menu (click or Enter) shall save at once as one `claimed` event for the chosen name, or one `released` for Unassign; typing in the menu's search field writes nothing. Supersedes the assignee clause of REQ-BOARD-029. Owner request 2026-10-20 | Must | T218, T225 |
| REQ-BOARD-037 | The board header shall offer a Labels filter menu listing every label on live cards with its count, most used first; choosing one or more labels shows only cards carrying any of them, combined with All / Needs me; the trigger shows the chosen labels, an x clears them, the subtitle reads "N of M cards", and columns count only shown cards. A drag while filtered keeps hidden cards in their order. The filter is per board for the session and is not saved in the notebook. Owner request 2026-10-20 | Must | T225 |
| REQ-BOARD-038 | Each label shall have one colour per board, the same on card faces, in the card and in the filter, out of eight soft tints (no orange). Labels take colours in the order they were first used; each gets its name's colour unless an earlier label on the board has it, then the next free one, so up to eight labels on a board all differ. Owner request 2026-10-20 | Should | T225 |
| REQ-BOARD-039 | A card moved to a column position (drag, keyboard or bridge) shall end at exactly that position among the column's live cards; the other cards keep their relative order. Found 2026-10-20: the moved card kept its old `order` and was sorted back. | Must | T224, T225 |
| REQ-BOARD-040 | Checklist items shall nest up to four levels (depth 0 to 3), like PowerPlan's indented tasks: an item is at most one level deeper than the item above it, and the first item is at the top level. Rows show their level as indentation in the card and on the card face. Notebooks saved before nesting open with every item at the top level. Owner request 2026-10-23 | Must | T237 |
| REQ-BOARD-041 | In the card, each item shall have Indent and Outdent buttons, and Alt+Right / Alt+Left on a focused item or Tab / Shift+Tab while editing its text shall indent or outdent it; its sub-items move with it. Removing an item keeps its sub-items, one level up. Owner request 2026-10-23 | Must | T237 |
| REQ-BOARD-042 | Agents shall create, read, update and delete checklist items over MCP: `card_checklist_add` (text, optional `under` an item or `position` and `depth`), `card_checklist_update` (text, done, depth), `card_checklist_remove`, `card_checklist_move` (to a 1-based position) and `card_checklist_set` (the whole list from items or `- [ ]` Markdown lines, two spaces per level; items whose text is unchanged keep their id). Items are named by id or 1-based position; `card_get` returns each item's id, position, text, done and depth. Every change records the agent as the actor. Owner request 2026-10-23 | Must | T237, T211 |
| REQ-BOARD-043 | A board with labels shall show swim lanes: one lane per label, in the order the labels were first used on its live cards, then a "No label" lane; each lane is a row across the four columns, lined up between columns, titled in the first column with the label and its card count. A card with several labels shows in each of their lanes; column headers count each card once. Lanes with no shown cards are left out; with a label filter on only the chosen labels' lanes show. A board without labels looks as before, with no lane titles. Lanes are always on. Owner request 2026-10-23 | Must | T238 |
| REQ-BOARD-044 | Each lane shall collapse and expand from its title; a collapsed lane hides its cards in every column and keeps its title and count. Collapsed lanes are per board for the session and not saved in the notebook. Owner request 2026-10-23 | Should | T238 |
| REQ-BOARD-045 | Dragging a card into another lane shall swap the label of the lane it came from for the target lane's label (into "No label": remove its labels), in the same drop as its column move. Owner request 2026-10-23 | Must | T238 |

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
- T223 — `tests/board/223-card-checklist.spec.ts`
- T224 — `tests/board/224-card-drag.spec.ts`
- T225 — `tests/board/225-card-properties-label-filter.spec.ts`
- T237 — `tests/board/237-checklist-nesting.spec.ts`
- T238 — `tests/board/238-swim-lanes.spec.ts`
