# SRS: Agent Bridge

**Project:** PowerScroll (formerly PowerNote)
**Version:** 0.66.0
**Date:** 2026-08-21

## Purpose

Let an external agent structure information directly into a notebook — create
pages and fill them with markdown content (bullet lists, checklists, headings)
— so the user can delegate note-shaping instead of doing it by hand.

## Design notes

The MCP server hosts a WebSocket on loopback and the app dials **out** to it.
A browser page cannot listen on a port, and PowerNote ships as a single static
HTML file with no runtime backend, so the app is necessarily the client.

The agent mutates the live Zustand stores rather than rewriting the `.html` on
disk. This is what makes the design safe: agent edits flow through the same
auto-save pipeline as user edits, so there is no external-write vs. auto-save
race to arbitrate.

The unit of content is a **block** — one text node holding one markdown chunk,
laid out at full page width and stacked down a page-guide column. Blocks are
used rather than fixed "rows" because text nodes already render markdown and
already auto-measure their own height, so a chunk that wraps to six visual lines
needs no row bookkeeping.

Only one notebook may hold the bridge at a time. The newest connection wins, so
a stale socket cannot lock out the notebook the user is actually looking at, and
the displaced client is explicitly told to stand down. That handshake is
load-bearing: without it the displaced client's reconnect backoff makes the two
notebooks trade the slot indefinitely and writes land in whichever one happens
to hold it (found while demoing the bridge, fixed before release).

Block heights are measured, not estimated, and the measurement must apply the
renderer's **inline** styles rather than just its CSS class. Font size, line
height and padding all live inline; measuring without them under-reports a
heading by ~12px, which is enough to overlap the block below.

## Requirements

| ID | Description | Priority | Test Ref |
|----|-------------|----------|----------|
| REQ-AGENT-001 | The app shall connect to an agent bridge server only when the user enables it in Settings; the bridge shall be OFF by default | Must | T94 |
| REQ-AGENT-002 | The enable flag shall persist per-machine (localStorage) and shall never be written into the notebook file | Must | T94 |
| REQ-AGENT-003 | Settings shall show bridge connection status (off / connecting / connected / error) and a served-command count | Should | T94 |
| REQ-AGENT-004 | An agent shall list every section and page with title, block count, and which page is active | Must | T95 |
| REQ-AGENT-005 | An agent shall create a section, which shall receive an initial empty page | Must | T95 |
| REQ-AGENT-006 | An agent shall create a titled page; by default a matching `# Title` block shall also be written onto the canvas | Must | T95 |
| REQ-AGENT-007 | An agent shall append a markdown block below all existing content on a page, without overlapping it | Must | T96 |
| REQ-AGENT-008 | Appended blocks shall render as markdown, including GFM checklists that remain clickable by the user | Must | T96 |
| REQ-AGENT-009 | An agent shall read a page back as ordered markdown blocks with stable block ids | Must | T96 |
| REQ-AGENT-010 | An agent shall replace the markdown of an existing block by id (`update_block`). If the block's height changes, occupants below it in the same scroll shall shift by the height delta (REQ-AGENT-067). The response includes `displacedCount`. | Must | T96, T110 |
| REQ-AGENT-011 | A command targeting a non-active page shall save the current page, switch, and load the target before mutating | Must | T97 |
| REQ-AGENT-012 | Agent edits shall mark the notebook dirty and survive a save/reload round-trip | Must | T97 |
| REQ-AGENT-013 | Unknown commands, missing ids, and non-text targets shall return a typed error without crashing the app | Must | T97 |
| REQ-AGENT-014 | The bridge server shall bind to loopback (127.0.0.1) only | Must | — |
| REQ-AGENT-015 | Tool calls made with no notebook connected shall fail fast with actionable guidance, not hang | Must | — |

## Requirements — demo findings

Added after the feature was demoed live and before it shipped.

| ID | Description | Priority | Test Ref |
|----|-------------|----------|----------|
| REQ-AGENT-016 | When a second notebook connects, the server shall keep the newest, send the older one a `displaced` frame, and only then close it | Must | T98, powernote-mcp `displacement.test.mjs` |
| REQ-AGENT-017 | A displaced client shall stand down permanently — no reconnect — and report why in Settings | Must | T98 |
| REQ-AGENT-018 | Displacement shall clear the persisted enable flag, so a forgotten background tab cannot silently re-claim the slot after a reload | Must | T98 |
| REQ-AGENT-019 | In-flight requests to a displaced notebook shall fail immediately rather than waiting for the request timeout | Must | powernote-mcp `displacement.test.mjs` |
| REQ-AGENT-020 | An agent shall choose which A4 page-guide column to write into (`column`, 0 = leftmost) | Must | T98 |
| REQ-AGENT-021 | Each column shall stack independently — filling column 1 shall not depend on the length of column 0 | Must | T98 |
| REQ-AGENT-022 | `read_page` shall report each block's column and order blocks column-major | Must | T98 |
| REQ-AGENT-023 | A non-integer or negative column shall be rejected with `BAD_PARAMS` | Must | T98 |
| REQ-AGENT-024 | Block height measurement shall apply the renderer's inline styles, so a placed block's height needs no post-render correction | Must | T96, T98 |
| REQ-AGENT-025 | An unrecognised or malformed server frame shall be ignored without disturbing the bridge | Should | T98 |
| REQ-AGENT-026 | An agent shall rename a page (`rename_page`), defaulting to the open page | Must | T100 |
| REQ-AGENT-027 | `rename_page` shall also retitle the page's canvas H1 when that block still matches the previous title, and shall leave a hand-edited heading untouched | Must | T100 |
| REQ-AGENT-028 | An agent shall move a page to another section (`move_page`), appending to the end unless `toIndex` is given | Must | T100 |
| REQ-AGENT-029 | `move_page` shall refuse with `PRECONDITION` when the move would leave the source section with no pages, and shall leave the notebook unchanged | Must | T100 |
| REQ-AGENT-030 | When the moved page is the open one, its section shall follow it, so subsequent writes still reach the page rather than being dropped by `savePageNodes` | Must | T100 |
| REQ-AGENT-031 | An agent shall rename the notebook (`rename_notebook`); the file already on disk keeps its own name, which the result shall report | Must | T100 |
| REQ-AGENT-032 | An agent shall persist the notebook to its bound file (`save_notebook`) | Must | T100 |
| REQ-AGENT-033 | `save_notebook` shall fail with `PRECONDITION` when no file is bound, rather than opening a Save As picker the bridge cannot drive | Must | T100 |
| REQ-AGENT-034 | An agent shall query update status (`check_update`), reporting current and latest version | Must | T100 |
| REQ-AGENT-035 | `check_update` shall distinguish "up to date" from "could not check" via a `checked` flag, so an unreachable API is never reported as current | Must | T100 |
| REQ-AGENT-036 | `run_update` shall require `confirm: true`, refuse when no newer installable release exists, and acknowledge before the live-swap reload drops the connection | Must | T100 |
| REQ-AGENT-037 | An agent shall list, create and rename scrolls, and target one by `scrollId` when appending, so two workstreams can share a page without interleaving | Must | T105 |
| REQ-AGENT-038 | An unknown `scrollId` shall be rejected with `NOT_FOUND` naming the known scrolls, and shall not fall back to another column | Must | T105 |
| REQ-AGENT-039 | An agent shall read and set the canvas look (`get_background`, `set_background`); background colour shall be addressed by name (`white`, `light-gray`, `gray`, `paper`), with the stored hex accepted as an alias | Must | T102 |
| REQ-AGENT-040 | `set_background` shall validate before writing: an unknown guide style or colour shall be rejected with `BAD_PARAMS` listing the valid values, leaving the notebook unchanged, and a call setting neither field shall be an error rather than a silent no-op | Must | T102 |
| REQ-AGENT-041 | `set_background` shall accept an optional `scope` (`notebook` by default, or `page`) and reject any other value with `BAD_PARAMS`. The default is fixed by compatibility, not preference: the tool shipped meaning notebook-wide, so re-pointing it at the current page would silently change what already-written agents do | Must | T102 |
| REQ-AGENT-041 | An agent-set canvas look shall persist through the normal auto-save/save path, requiring no persistence path of its own | Must | T103 |
| REQ-AGENT-042 | An agent shall delete pages, sections, scrolls and blocks (`delete_page`, `delete_section`, `delete_scroll`, `delete_block`) | Must | T109 |
| REQ-AGENT-043 | Every delete verb shall require `confirm: true`, since the bridge exposes no undo; without it the call shall fail with `BAD_PARAMS` and change nothing | Must | T109 |
| REQ-AGENT-044 | Deletes that the store refuses — the last page in a section, the last section, the last scroll on a page — shall report `PRECONDITION` naming the reason, never a silent no-op | Must | T109 |
| REQ-AGENT-045 | SUPERSEDED by REQ-AGENT-052. Was: `delete_scroll` shall preserve the blocks in its band unless `withBlocks: true`, and shall report how many blocks were removed | Must | T109 |
| REQ-AGENT-046 | Deleting the open page shall reload the canvas from the newly active page, so the deleted page's blocks are not flushed onto it | Must | T109 |
| REQ-AGENT-051 | An agent shall delete a diagram (`delete_diagram`) by frame id. The call shall require `confirm: true`. Occupants below the frame in the same scroll shall close the gap (REQ-AGENT-067). An unknown id shall be `NOT_FOUND`. A non-diagram node id shall be refused, naming the type and suggesting `delete_block` | Must | T155, T110 |
| REQ-AGENT-052 | `delete_scroll` shall require `content: 'delete' \| 'keep'` when the scroll's band holds any content (nodes, group members, or strokes). Missing `content` on a non-empty band shall be `BAD_PARAMS` naming the counts and what each value does. An empty band shall not require the param. There is no default: the previous default was keep (REQ-AGENT-045), and a default flip is unrecoverable. `withBlocks` remains a deprecated alias and the response shall include a deprecation notice. Membership is group-aware: a diagram belongs to the band of its frame origin and its members and grouped strokes follow that verdict. Ungrouped strokes belong to the band of their first point and are deleted with it. One undo shall restore the band, its nodes and its ink | Must | T156 |
| REQ-AGENT-053 | `rename_scroll` shall accept an empty title and untitled the scroll. Last-scroll deletion stays `PRECONDITION`, and the message shall name untitled-instead-of-delete | Must | T157 |
| REQ-AGENT-054 | An agent shall move a scroll (`move_scroll`) by `direction: "left" \| "right"` or `toColumn`. Members, grouped ink and the band's `width` travel with it; neighbouring offsets are recomputed. Unknown `scrollId` is `NOT_FOUND`. Already-at-edge (or already at `toColumn`) is `PRECONDITION` naming the edge. One undo restores nodes, strokes, scroll order and widths | Must | T158 |
| REQ-AGENT-055 | `read_page` shall return free-standing markdown in `blocks[]` and a diagrams index in `diagrams[]` (`id`, `title`, `format` via sniff, `memberCount`, `bounds`). Group-owned text (diagram labels) shall not appear in `blocks[]`. `include` defaults to `["blocks","diagrams","images"]` (images index is REQ-AGENT-069); `["diagrams"]` is the diagrams-only fetch; `strokes-summary` is opt-in. `scrollId` filters blocks, diagrams and images (`NOT_FOUND` if unknown). `limit` + `cursor` page `blocks[]` in column-major reading order (`cursor` = last returned block id; next page starts after it). If the serialized response would exceed `READ_PAGE_RESPONSE_BUDGET` (20000 characters), the blocks list shall be truncated at a block boundary and `truncated: {at, notice}` set — the call shall not fail. Further over-budget steps are REQ-AGENT-065. `include_diagram_source: true` expands `source` on each diagram entry. Discovery flow: `read_page` → `diagrams[].id` → `read_diagram` / `delete_diagram` / `fit_diagram`; `read_page` → `images[].id` → `read_image` | Must | T159, T172 |
| REQ-AGENT-056 | An agent shall read one diagram (`read_diagram`) by frame id, receiving `{id, title, format, source, bounds, memberCount, members: [{id, type, x, y, w, h, label?}]}`. `memberCount` is the total; `members[]` is a page (REQ-AGENT-064). Unknown id is `NOT_FOUND`. A non-diagram id is `UNSUPPORTED` naming the type | Must | T160 |
| REQ-AGENT-057 | An agent shall refit an existing diagram (`fit_diagram`) to the band its frame sits in. Unlike placement-time fit (shrink-only, REQ-DIAG-136), this scales both directions: up to fill band-width minus padding when under, down with the 0.45 floor when over. An out-of-band frame is `PRECONDITION` naming the diagram. One undo | Must | T160 |
| REQ-AGENT-058 | An agent shall re-fetch one markdown block (`get_block`) by id as a `BlockSummary` plus page location. Unknown or non-block ids are `NOT_FOUND`. An oversized block is truncated per REQ-AGENT-065 | Must | T159 |
| REQ-AGENT-059 | `delete_block` and `update_block` shall refuse a diagram-member id (`UNSUPPORTED`) naming the owning diagram and pointing at `delete_diagram` / the redraw path. `delete_block` on the frame id still cascades (REQ-AGENT-051 / REQ-DIAG-141) | Must | T159 |
| REQ-AGENT-060 | An agent shall insert a markdown block (`insert_block`) into a scroll at a chosen position. `scrollId` and `markdown` are required. Exactly one of `after` (an occupant id in that scroll — a markdown block or diagram frame — preferred) or `index` (0-based in that scroll's packed-occupant reading order). Index 0 lands at the top of column content, ceiling-clamped when a titled scroll arms the page ceiling. The new block's y is the anchor's bottom + `BLOCK_GAP` (12), or the column top for index 0. Every top-level occupant in that column at or below the insertion y shall shift down by the new block's height + `BLOCK_GAP` (text, diagram frames, images, shapes, ungrouped ink). Frame members and group ink ride the frame. The response is a `BlockSummary` plus `displacedCount`. Both `after` and `index`, or neither, is `BAD_PARAMS`. An `after` id that is not a top-level occupant in that scroll is `BAD_PARAMS` naming the mismatch. Unknown `scrollId` / `after` is `NOT_FOUND` | Must | T161, T110 |
| REQ-AGENT-061 | An agent shall move a markdown block or diagram frame (`move_block`) within a scroll or across scrolls on the same page. Addressing is id-relative: `after` (an occupant id) is preferred over `index` because ids survive reordering (the same reason `scrollId` is preferred over a raw column). Exactly one of `after` or `index`. Optional `scrollId` defaults to the block's current scroll. The source gap closes and the target gap opens as one undo entry. Occupants below — including diagrams — reflow. Frame members ride the frame. Unknown ids are `NOT_FOUND`. An `after` occupant not in the destination scroll is `BAD_PARAMS` naming the mismatch. Both/neither of `after`+`index` is `BAD_PARAMS`. Moving a diagram **member** is `UNSUPPORTED` naming the owning diagram. A shape/image/stroke as the move target is `UNSUPPORTED` naming the type | Must | T161, T110 |
| REQ-AGENT-062 | Guide style does not gate reflow. Every scroll packs as a column for insert/move/update_block/height-change/delete-gap, including a pages/grid/none sheet with only the default untitled scroll. Human drag does not reflow. | Must | T161, T110 |
| REQ-AGENT-067 | insert/move/`update_block`/height-change/`delete_block`/`delete_diagram` shall pack every top-level occupant of the band — text, diagram frames (members and group ink ride the frame), images, shapes, ungrouped ink. Other columns are untouched. Human drag does not reflow. | Must | T110 |
| REQ-AGENT-063 | Absolute budget invariant. Every serialized `read_page`, `read_diagram` and `get_block` response shall be at most `READ_PAGE_RESPONSE_BUDGET` (20000) characters. The call shall not fail for size. After the documented trim/truncate steps, a response that still exceeds the budget is `INTERNAL` (a bug, not a user error) | Must | T162 |
| REQ-AGENT-064 | `read_diagram` shall page `members[]` with `member_limit` + `member_cursor` (cursor = last returned member id; next page starts after it — same style as `read_page`). Default `member_limit` is derived from `READ_PAGE_RESPONSE_BUDGET` (half the budget divided by a typical member's serialized size) so a typical response sits well under the cap. `source` counts toward the budget. If the serialized response is still over after the window, members shall be trimmed at an entry boundary and `truncated: {at, notice}` set. If `source` alone exceeds the budget, `source` shall be truncated to fit and `sourceTruncated: {fullLength, notice}` shall name the full length and suggest exporting as `.drawio` for the whole file | Must | T162 |
| REQ-AGENT-065 | Over-budget `read_page` shall, after trimming blocks to one (REQ-AGENT-055), drop per-diagram `source` fields next, replacing each with `sourceOmitted: {length, notice: "use read_diagram"}`. If still over, `diagrams[]` shall be trimmed at an entry boundary with `diagramsTruncated: {at, notice}`. If still over, `images[]` shall be trimmed at an entry boundary with `imagesTruncated: {at, notice}` (REQ-AGENT-069). A single block larger than the budget shall still be returned (always-at-least-one) by `read_page` and `get_block`, with its markdown cut to fit and `markdownTruncated: {fullLength, notice}` set. One helper implements the markdown cut for both tools | Must | T162, T172 |
| REQ-AGENT-066 | `get_block` shall accept a non-negative `offset` into the block markdown. A truncated response shall carry `nextOffset` (resume point) and `markdownTruncated.fullLength` describing the WHOLE block, not the slice — so a block of any size is fully readable in bounded calls: the budget truncates a call, never strands content. `offset` past the end is `BAD_PARAMS` naming the length | Must | T162 |
| REQ-AGENT-068 | An agent shall insert an image (`insert_image`) into a scroll. Source is exactly one of `data` (a base64 data URI) or `path` (a local file the MCP server reads and encodes); both or neither is `BAD_PARAMS`. Placement addressing matches `insert_block` (`scrollId` + `after`/`index`), occupants below shift per REQ-AGENT-067. Optional `alt` and `mini`. The image runs the same downscale/embed pipeline as UI imports (REQ-IMAGE-021) — the persisted `src` is always a data URI. The response is the node id plus final display and natural dims. One undo restores | Must | T171 |
| REQ-AGENT-069 | `read_page` shall list image nodes in an `images[]` index: `{id, alt, w, h, naturalWidth, naturalHeight, bytes, mini, scrollId}` — never the base64 payload, in any tool response. `include` gains `"images"` (in the default set); `scrollId` filters it. The REQ-AGENT-063 budget invariant holds on pages dense with images; over budget, `images[]` trims at an entry boundary with `imagesTruncated: {at, notice}` | Must | T172 |
| REQ-AGENT-070 | An agent shall export one image (`read_image`) by node id: the decoded bytes are written to `out_path` (or a temp file the response names) so the agent can view the file directly; the response carries the path, format, byte size and dims — not the payload. Unknown id is `NOT_FOUND`; a non-image id is `UNSUPPORTED` naming the type | Must | T172 |
| REQ-AGENT-071 | An agent shall resize a scroll by stable id with `resize_scroll`. Width is finite, clamped by the same shared bounds as the UI, persists on that page, shifts every right-hand node/stroke by the delta, and returns the requested/effective width and delta. Unknown ids are `NOT_FOUND`; one undo restores | Must | T186 |
| REQ-AGENT-072 | An agent shall list, create and read boards and cards (`board_list`, `board_create`, `board_read`, `card_create`, `card_get`, `card_update`, `card_claim`, `card_release`, `card_move`, `card_note`, `card_check`, `card_checklist_add`, `agent_status`, `board_updates`). Writes record `actor`. `board_create` shall not switch the owner's page. | Must | T211 |
| REQ-AGENT-073 | Every board write tool takes `me` matching `^[a-z0-9][a-z0-9._-]{0,39}$`. When omitted the MCP server fills it from `POWERNOTE_AGENT_NAME` or the process label and passes it to the app as `actor`. An invalid `me` is `INVALID` and does not reach the notebook. | Must | powernote-mcp `board-tools.test.mjs` |
| REQ-AGENT-074 | `board_updates` shall return events with seq > `since` (omit `since` for cursor only). If none and `wait_seconds` > 0 the MCP server shall re-ask the app every 1 s until events arrive or the wait (max 300 s) ends, returning `{events, cursor}`. | Must | powernote-mcp `board-tools.test.mjs`, T211 |
| REQ-AGENT-075 | `board_list`, `board_read`, `card_get` and `board_updates` are read-only and bypass the lease. Other board tools take the write lease. `agent_status` is a write that does not change the board. | Must | test:bridge, powernote-mcp `board-tools.test.mjs` |

## Related

- REQ-SCROLL family — scroll identity, titles and derived band membership
- REQ-TEXT family — markdown rendering and clickable checkboxes in text nodes
- REQ-HIERARCHY family — section/page structure and navigation
- REQ-FILE family — auto-save and notebook persistence

## Multiple agents (v0.36)

Several agents may connect at once; they may not operate at once.

One MCP server process is spawned per agent session, so they race for the bridge
port. The winner is the **hub** and owns the single connection to the notebook;
the losers are **peers** and forward their tool calls to the hub. Exactly one
socket ever reaches the app, which is why the app side is unchanged.

| ID | Description | Priority | Test Ref |
|----|-------------|----------|----------|
| REQ-AGENT-040 | A server that cannot bind the bridge port shall join the existing server as a peer rather than failing | Must | test:bridge |
| REQ-AGENT-041 | A peer's tool calls shall be executed by the hub against the one connected notebook | Must | test:bridge |
| REQ-AGENT-042 | A mutating tool shall acquire a lease before running; a second agent's mutating tool shall be refused with `LOCKED` | Must | test:bridge |
| REQ-AGENT-043 | The `LOCKED` message shall name the holder, how long it has held, roughly when it frees up, and the caller's queue position | Must | test:bridge |
| REQ-AGENT-044 | The lease shall be held for the whole duration of a command, so a slow command cannot lose it mid-flight | Must | test:bridge |
| REQ-AGENT-045 | Read-only tools shall never be blocked — an agent that cannot read cannot discover why it is blocked | Must | test:bridge |
| REQ-AGENT-046 | The lease shall be released on idle, on holder disconnect, and on notebook disconnect, so no crash can wedge the notebook | Must | test:bridge |
| REQ-AGENT-047 | A holder past the maximum hold shall yield at its next command, but only when another agent is waiting | Should | — |
| REQ-AGENT-048 | `bridge_status` shall report the notebook, every connected agent, the holder, and whether the caller is the holder | Must | test:bridge |
| REQ-AGENT-049 | Every tool result shall carry the calling agent's identity | Must | test:bridge |
| REQ-AGENT-050 | If the hub exits, a surviving peer shall take the port and continue serving | Must | test:bridge |

**Expiry is evaluated on use, not on a timer.** A timer firing while nothing is
happening tells us nothing, and one firing mid-command would be wrong.

**Coverage.** `npm run test:bridge` spawns two real server processes and a stub
notebook. The Playwright suite drives the app side of the bridge and never
starts the server, so this topology has no coverage there.
