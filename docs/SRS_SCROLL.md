# SRS: Scrolls

**Project:** PowerScroll (formerly PowerNote)
**Version:** 0.78.0
**Date:** 2026-08-21

## Purpose

Give the vertical column bands on a page an identity — a stable id and a visible
title — so that more than one workstream can share a page without their content
interleaving, and so an agent can target a specific column instead of guessing
an index.

## Design notes

A **scroll** is a named band, not a container. `ScrollRecord { id, title, column }`
lives on the page and owns identity only; which blocks belong to a scroll is
**derived** from each block's `x`, through the same `columnAt` band test the page
guides draw with.

Storing membership on the block (as groups do with `groupId`) was rejected
deliberately. A group is a user-formed set that cannot be derived from position;
a scroll *is* a position. With stored membership, dragging a block into another
scroll would leave it filed under the old one, and the next agent append would
stack beneath a block that is no longer visibly there. Deriving it means the
canvas and the record can never disagree.

Because bands are positional, any operation that renumbers them (reorder, delete)
must move the affected blocks in the same state update — see `compactColumns`,
where array order is the instruction and every node move is resolved against a
snapshot of the pre-move layout.

Scroll titles are drawn as canvas **chrome**, not as text nodes. A title is not
content: as a node it would be selectable, draggable, deletable, and would
surface in `read_page` as the scroll's first block.

Untitled scrolls draw no header. Every page written before v0.31 is backfilled
with an untitled record on load, so drawing a placeholder would put a header on
every page of every existing notebook. A name is chosen, not inherited.

Scrolls provide **spatial isolation, not concurrency**. The bridge still holds a
single app socket, so agent commands arrive sequentially; what scrolls guarantee
is that sequential writes from different workstreams land in different columns.

## Requirements

| ID | Requirement | Priority | Test |
|---|---|---|---|
| REQ-SCROLL-001 | Every page shall carry at least one scroll record, created with the page and backfilled on load for pages written before v0.31 | Must | T104 |
| REQ-SCROLL-002 | A scroll record shall have a stable id that survives save → open, reorder and deletion of other scrolls | Must | T104 |
| REQ-SCROLL-003 | A block shall belong to the scroll whose column band it physically occupies; membership shall not be stored on the block | Must | T104 |
| REQ-SCROLL-004 | Reordering a scroll shall move its blocks into the new band in the same update | Must | T104 |
| REQ-SCROLL-005 | Deleting a scroll shall close the resulting gap; blocks in the removed band shall be preserved unless deletion is explicitly requested with them, and the last scroll on a page shall not be deletable | Must | T104 |
| REQ-SCROLL-006 | An agent shall be able to list a page's scrolls with their ids, titles, columns and block counts | Must | T105 |
| REQ-SCROLL-007 | An agent shall be able to create and rename scrolls, and to target one by id when appending a block | Must | T105 |
| REQ-SCROLL-008 | A named scroll's title shall be shown at the top of its column on the canvas, in the hierarchy panel, and renameable by double-clicking the header; untitled scrolls shall render no header | Must | T104 |
| REQ-SCROLL-009 | An unknown `scrollId` shall be rejected with NOT_FOUND and shall not fall back to another band | Must | T105 |
| REQ-SCROLL-010 | The legacy `column` parameter shall keep working for `append_block` and `create_page` | Should | T105 |
| REQ-SCROLL-011 | Exactly one scroll on the active page shall be *active*, set by an explicit click (sidebar entry or canvas header) and defaulting to the leftmost; it shall be marked in both places, and shall reset when the page changes | Must | T108 |
| REQ-SCROLL-012 | Clicking a scroll in the sidebar shall open its page, make it active, and move the viewport to the top of that scroll | Must | T108 |
| REQ-SCROLL-030 | Every scroll packs as a column for insert/move/height-change (REQ-DIAG-002..004, REQ-AGENT-067). Guide style (pages / grid / scroll / none) is visual only. Human drag does not reflow. | Must | T110 |
| REQ-SCROLL-031 | A scroll's effective width shall be persistent per page, clamped to the shared minimum/maximum, and used by cumulative `columnLeft` geometry. Changing it in either direction shall shift all content to the right of the band by the same delta while leaving the resized band's occupants fixed | Must | T186 |
| REQ-SCROLL-032 | Manual resize preview and commit shall use one drag-start snapshot and the viewport scale, never mix absolute screen coordinates with canvas coordinates. Previewing shall not write workspace history; pointer-up shall commit exactly once | Must | T186 |

## Traceability

- T104 — `tests/scroll/104-scroll-identity.spec.ts`
- T105 — `tests/agent/105-agent-parallel-scrolls.spec.ts`
- T186 — `tests/scroll/186-resize-scroll.spec.ts`

See also `docs/SRS_AGENT.md` for the bridge transport and the single-connection
constraint that bounds what "parallel" means here.

## Affordances (v0.35)

Scrolls had identity from v0.31 but almost nothing you could do with them: only
an agent could create one, and the title left the screen the moment you read
past it.

| ID | Description | Priority | Test Ref |
|----|-------------|----------|----------|
| REQ-SCROLL-020 | The sidebar shall offer a "New scroll" action under a page's scroll list | Must | T122 |
| REQ-SCROLL-021 | Committing a non-empty name shall create a scroll in the next free column and make it active | Must | T122 |
| REQ-SCROLL-022 | An empty name, or Escape, shall cancel without creating — an unnamed scroll draws no header and would be invisible | Must | T122 |
| REQ-SCROLL-023 | A scroll title shall hold at the top of the viewport once the viewport scrolls past its resting position, for every named scroll at once | Must | T123 |
| REQ-SCROLL-024 | A held title shall be visually distinguished from a resting one, and shall draw above page content rather than beneath it **(superseded by REQ-SCROLL-039..044)** | Must | T123, T202 |
| REQ-SCROLL-025 | Dragging a node shall snap its left edge to a scroll band's left, or its right edge to the band's right, within a threshold | Must | T124 |
| REQ-SCROLL-026 | The snap shall release when dragged beyond the threshold, so a deliberate off-band placement holds | Must | T124 |
| REQ-SCROLL-027 | The scroll snap shall not require a modifier key, unlike node-to-node snapping | Must | T124 |
| REQ-SCROLL-028 | Sidebar scroll entries shall use a scroll glyph rather than a column-split glyph | Should | T122 |
| REQ-SCROLL-033 | A resting named scroll shall draw its title at 24 canvas units, weight 700, on a hairline rule at the foot of a 34-unit resting header (rest row 12, rule at 46), so it never overlaps the first block, which sits at 48 in every existing notebook. **(superseded by REQ-SCROLL-039)** | Must | T202 |
| REQ-SCROLL-034 | A held scroll header shall be a 32 screen-pixel paper band with a 22 screen-pixel paper-to-transparent fade below it at every viewport scale. **(superseded by REQ-SCROLL-039..042)** | Must | T202 |
| REQ-SCROLL-035 | A held scroll header shall show a two screen-pixel progress rule derived from the visible position in that scroll's own content. **(superseded by REQ-SCROLL-043)** | Must | T202 |
| REQ-SCROLL-036 | Only the active scroll shall show its two canvas-unit ink spine from the resting row through its content. **(superseded by REQ-SCROLL-039)** | Must | T202 |
| REQ-SCROLL-037 | During manual scroll resize, the screen-constant pixel readout shall be rendered inside the header band before the grip. **(superseded by REQ-SCROLL-039)** | Must | T202 |
| REQ-SCROLL-038 | Scroll rename shall edit in the title's exact current-state box without changing its type scale. **(superseded by REQ-SCROLL-039)** | Must | T202 |
| REQ-SCROLL-039 | Every named scroll shall render an opaque, screen-space 44 px by 8 px-radius header card above all page content, controls and ink; it shall contain the left-aligned ScrollText icon/title, active/inactive ring, in-place rename and resize affordance. | Must | T152, T202, T208 |
| REQ-SCROLL-040 | A resting card shall leave a 6 px visual gap before the scroll body, and shall remain screen-constant at every zoom. | Must | T152, T208 |
| REQ-SCROLL-041 | Once pinned, a card shall sit 8 px below the canvas top and an opaque canvas-background mask shall conceal all band content through the card and its body gap, with a crisp rounded body edge. | Must | T152, T208 |
| REQ-SCROLL-042 | A header card shall show the current viewport page and the total rendered scroll pages as a mono “page N of M” counter. | Must | T202 |
| REQ-SCROLL-043 | A card shall retain a clipped 3 px ink progress rule whose width follows reading position in that scroll. | Must | T208 |
| REQ-SCROLL-044 | Scroll-mode page boundaries shall use 16 canvas-unit background-colour sheet gaps with rounded sheet corners and no legacy separator caps or rules. | Must | T101, T208 |
| REQ-SCROLL-045 | Scroll-mode sheet gaps shall show centred mono page numbers from page 2 onward when zoom is at least 30%. | Must | T101, T208 |

Vertical position is never snapped: blocks stack freely down a band, and
snapping y would fight that.

## Traceability (v0.35)

- T122 — `tests/scroll/122-scroll-create-pin-snap.spec.ts` (creation, icon)
- T123 — same file (pinned titles)
- T124 — same file (magnetic snap)
- T202 — `tests/scroll/202-scroll-header-states.spec.ts`
