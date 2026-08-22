# PowerScroll MCP

Lets an agent read and edit a **running PowerScroll notebook**. Existing
PowerNote notebooks use the same compatible bridge protocol.

## How it connects

```
agent  ──MCP/stdio──▶  powerscroll-mcp  ──WebSocket──▶  PowerScroll (browser)
                       (hosts ws://127.0.0.1:41777)             (dials out)
```

The server hosts the socket and the app dials **out** to it. A browser page
cannot listen on a port, and PowerScroll ships as a single static HTML file with
no runtime backend, so the app is necessarily the client.

Commands mutate the app's live stores, so agent edits flow through the same
auto-save pipeline as anything you type — there is no separate write path to
the `.html` file and nothing to reconcile.

## Install

Run the current public package without a global installation:

```bash
npx -y powerscroll-mcp
```

The executable is published as [`powerscroll-mcp`](https://www.npmjs.com/package/powerscroll-mcp)
and registered for discovery as
[`io.github.CynaCons/powerscroll`](https://registry.modelcontextprotocol.io/?q=powerscroll).
The latest GitHub release also contains `powerscroll-mcp.tgz` as a fallback; an
MCP-only npm patch may be newer than that app-release attachment.

Repository contributors can run `npm install --prefix powernote-mcp`; the
server is registered in `.mcp.json`. Restart the agent session after changing
that file so the tools load.

## Turning it on

1. Open your notebook in PowerScroll.
2. Settings → **Agent bridge** → *"Let a local agent write into this notebook"*.
3. The status dot goes green when the app reaches the server. Order doesn't
   matter — the app retries with backoff, so either side can start first.

The bridge is **off by default** and the flag is stored in `localStorage`, not
in the notebook. A notebook you send to someone else will never try to dial a
socket on their machine.

## Tools

| Tool | What it does |
|------|--------------|
| `list_pages` | Every section and page, with block counts and which is open. Call first to get ids. |
| `read_page` | A page as ordered markdown blocks plus diagrams[] and images[] indexes. Labels no longer leak; image payloads never appear. Supports include (default `blocks,diagrams,images`), scrollId, limit/cursor, and a hard 20k size cap (blocks, then sources, then diagrams, then images, then markdown). Flow: `images[].id` → `read_image`. |
| `read_diagram` | One diagram (source + a page of members). `member_limit`/`member_cursor` page members; source that alone blows the 20k cap is truncated. Ids come from read_page diagrams[]. |
| `read_image` | Export one image by id to a local file (`out_path` or a temp file). Response is path + format + bytes + dims + alt — never the base64. Then open the file. |
| `get_block` | One markdown block by id. Cheap re-fetch after a capped read_page. Oversized markdown is truncated to the 20k cap. |
| `fit_diagram` | Refit a diagram to its scroll band in both directions (grow or shrink). |
| `create_section` | New section (sidebar tab), with an initial empty page. |
| `create_page` | New titled page, opened. Also writes an `# Title` block unless `withHeading: false`. |
| `append_block` | Append a markdown block to the bottom of a page. The main way to write. |
| `insert_block` | Insert a block after an id (preferred) or at an index, shifting occupants below (including diagrams). |
| `insert_image` | Insert an image into a scroll. Exactly one of `data` (a `data:image/...;base64,` URI) or `path` (local png/jpg/jpeg/gif/webp — this server reads and encodes it). Placement matches `insert_block`. Optional `alt` and `mini`. Returns id + dims, never the payload. One undo. |
| `move_block` | Move a block or diagram frame within or across scrolls. Id-relative `after`. One undo. |
| `update_block` | Replace an existing block's markdown, by id. Occupants below reflow. |
| `create_diagram_plantuml` | Draw a UML diagram from PlantUML source, as native canvas shapes. See [Diagrams](#diagrams). |
| `create_diagram_mermaid` | Draw a flowchart or sequence from Mermaid source, as native canvas shapes. See [Diagrams](#diagrams). |
| `rename_page` | Retitle a page, and its `# Title` block if that still matches. |
| `move_page` | Move a page into another section. |
| `list_scrolls` | The named scrolls (columns) on a page, with block counts. Call before writing to a shared page. |
| `create_scroll` | New titled scroll to the right of the existing ones. Returns a `scrollId`. |
| `rename_scroll` | Retitle a scroll. The title shows at the top of the column on the canvas. |
| `move_scroll` | Move a scroll left/right or to a column. Members, grouped ink and width travel with the band. |
| `delete_page` | Delete a page and its content. Requires `confirm`. |
| `delete_section` | Delete a section and every page in it. Requires `confirm`. |
| `delete_scroll` | Delete a scroll; keeps its blocks unless `withBlocks`. Requires `confirm`. |
| `delete_block` | Delete one markdown block by id. Requires `confirm`. |
| `get_background` | The notebook's current guide style and background colour. |
| `set_background` | Change the guide style (`pages`/`scroll`/`grid`/`none`) and/or colour. Stored in the notebook. |
| `rename_notebook` | Rename the notebook in the app (not the file on disk). |
| `save_notebook` | Write the notebook back to the file it was opened from. |
| `bridge_status` | Who else is working in this notebook, and who holds it. Never blocked. |
| `check_update` | Is a newer PowerScroll release available? |
| `run_update` | Install it. Overwrites the file and reloads the app. |

### Diagrams

Two tools, named for the language each takes: `create_diagram_plantuml` and
`create_diagram_mermaid`. What lands is ordinary PowerScroll shapes and text
inside a diagram frame — **not an image** — so the user can drag any part of it
afterwards. We take the syntax and throw the renderer away; that is what makes
the result editable.

Only the parser differs between the two. Both produce the same spec, and layout
and rendering are shared, so a Mermaid flowchart looks like it belongs in the
same notebook as a PlantUML component diagram.

#### `create_diagram_plantuml`

Two PlantUML dialects, and the right one is detected from the source:

**Component and composite structure**

```
component "gateway" as gw {
  portin telemetry
  portout storage
  component "broker : MqttBroker [1]" as broker
  component "buffer : StoreForward [1..*]" as buffer
  broker --> buffer : Queue
  telemetry --> broker
  buffer --> storage
}
```

Nested components, ports (`port` / `portin` / `portout`), provided and required
interfaces, assembly and delegation connectors. A composite-structure part puts
its role in the label: `"role : Type [multiplicity]"`. Connector kind is derived
from UML's rule, not declared — an end on a port that is not on a part is a
delegation, otherwise an assembly.

**Activity with swimlanes**

```
|Sensor|
start
:sample burst;
|Gateway|
:buffer to flash;
if (uplink up?) then (yes)
|Cloud|
:ingest batch;
else (no)
:hold in store-forward;
endif
stop
```

`|Lane|` switches the swimlane, `start` and `stop` are the pseudostates,
`:action;` is a step, and `if (cond) then (label) / else (label) / endif` adds a
decision with guards on the arrows. Steps run top to bottom in source order and
the lane fixes the column.

#### `create_diagram_mermaid`

A **documented subset**, because a parser that guesses at the rest would draw a
diagram nobody wrote. Anything outside it comes back as a diagnostic.

**Flowchart**

```
flowchart LR
  A[Read sensor] --> B{Uplink up?}
  B -->|yes| C[Send batch]
  B -->|no| D[Store and forward]
  D --- C
```

Nodes `A`, `A[Label]`, `A(Label)`, `A{Label}`. Edges `-->`, `---` and their
`|label|` forms, including chains such as `A --> B --> C`. A bare id is a node,
as it is in Mermaid.

**Sequence**

```
sequenceDiagram
  participant S as Sensor
  participant G as Gateway
  S->>G: telemetry burst
  G-->>S: ack
```

`participant X`, `participant X as Label`, `actor X`, and the `->>` and `-->>`
messages. A `-->>` reply renders dashed.

**Two things to expect.** Node SHAPE travels as a stereotype above the name, not
as geometry: `{decision}` renders as a box labelled «decision» rather than as a
diamond, because the shared layout has one box shape and showing the wrong shape
is worse than naming the right one. LAYOUT is left to right whatever direction
the header names, and a sequence renders as participants side by side with
numbered messages rather than lifelines running down the page.

**Not supported, and refused with a diagnostic:** subgraphs, dotted (`-.->`),
thick (`==>`) and circle/cross (`--o`, `--x`) links, compound node shapes such
as `A[[Sub]]` and `A((Circle))`, `loop`/`alt`/`opt`/`par`/`note` blocks, and the
class, state, ER and Gantt families.

**Rules worth knowing**

- Supply semantics only. Every coordinate is computed from real text metrics,
  and there is no syntax for positioning anything yourself.
- Send each language to its own tool. A source in the other language is refused
  rather than half-drawn — PlantUML would happily render `A[Read sensor]` as an
  entity literally named `A[Read sensor]`.
- `skinparam`, `!include`, `!theme`, `style`, `classDef` and `%%{init}%%` are
  **reported back as skipped**, not silently dropped — PowerScroll supplies the
  style.
- `fork`, `split`, `while` and `repeat` are refused with a diagnostic rather
  than drawn wrong.
- Activity `if/else` branches currently render in source order rather than as
  parallel paths that rejoin.
- The response carries the diagnostics, so one call is enough to know whether it
  came out right. A source that draws nothing is a `PRECONDITION` error, not an
  empty frame.

### Several agents at once

More than one agent may connect. They may not **operate** at once.

One server process is spawned per agent session, so they race for the port. The
winner becomes the **hub** and owns the single connection to the notebook; the
losers become **peers** and forward their calls to it. That keeps exactly one
socket to the app and one place where the lock lives. If the hub process exits,
the survivors re-race and one is promoted — agents see a brief unavailable
window, not a broken bridge.

The hub hands out a **lease**:

- A writing tool takes the lease, holds it for the whole command — including
  slow ones like `save_notebook` and `run_update` — and keeps it for a short
  idle grace afterwards (`POWERNOTE_LOCK_IDLE_MS`, default 10 s).
- A second agent writing meanwhile gets a `LOCKED` error naming the holder, how
  long it has been working, roughly when it frees up, and your queue position.
- **Reads are never blocked.** An agent that cannot look also cannot find out
  why it is blocked.
- The lease is released when it goes idle, when the holding agent disconnects,
  or when the notebook does. A crashed agent cannot wedge the notebook.
- A holder still working after `POWERNOTE_LOCK_MAX_HOLD_MS` (default 2 min)
  yields at its next command **if** anyone is waiting.

Call `bridge_status` when you get `LOCKED`. A "free" answer can go stale
immediately, so treat the error as the real signal and the status as the
explanation. Every tool result carries `_agent`, so you always know which agent
you are.

### Blocks, not rows

A block is one text node holding one markdown chunk. Prefer one block per
logical unit — a whole list, a whole paragraph — rather than one per line.
Blocks are full page width and stack down a column; their height is measured
against the real renderer at write time, so they never overlap.

### Scrolls (columns)

A page is divided into vertical bands. Each band can be a named **scroll**, with
its title drawn at the top of the column in the app. Scrolls stack
independently, so writing into a second scroll starts at the top of the page
regardless of how long the first one is — which is what makes it safe for two
workstreams to share a page.

Target one with `append_block({ scrollId })`, using an id from `list_scrolls`.
`read_page` reports each block's `scrollId` and returns blocks column-major —
all of the leftmost scroll top to bottom, then the next. Diagram labels no
longer appear in `blocks[]`; diagrams are listed separately in `diagrams[]`
(`id`, `title`, `format`, `memberCount`, `bounds`). Pass `include: ["diagrams"]`
for a diagrams-only fetch, `scrollId` to filter a band, and `limit`/`cursor`
to page. A response that would exceed 20000 characters is trimmed at a
block boundary (`truncated.at`), then sources, then diagrams — rather than
failing. An oversized single block has its markdown cut (`markdownTruncated`).

Membership is **positional**: a block belongs to whichever scroll it physically
sits in, so a block the user drags into another scroll moves with it, and
nothing can end up filed under a scroll it is not visibly in.

`append_block` and `create_page` still accept a raw `column` integer (0 = the
leftmost band). It keeps working, but prefer `scrollId` — a column index points
at a position, and positions shift when scrolls are reordered.

Markdown is rendered live, so `- [ ]` checkboxes arrive as real checkboxes the
user can click, and clicking one writes back into the block's markdown.

### Saving, and what the agent cannot do

Edits land in the live app immediately, but they are only on disk once the
notebook is saved. `save_notebook` overwrites the file the notebook was opened
from — and only that file. It cannot Save As: the browser's file picker needs a
real click, so a notebook that was never saved has nothing for the agent to
write to, and the tool says so instead of quietly doing nothing.

`rename_notebook` is the same story from the other side. It renames the notebook
*inside* the app; the `.html` on disk keeps the name it already had until the
user saves it somewhere new. The result includes the bound filename so the agent
can tell the user the two now differ.

### Updates

`check_update` compares the running build against the latest GitHub release.
Read the `checked` field before trusting `available`: when GitHub is unreachable
or rate-limiting, `checked` is `false` and the status is simply unknown — not
"up to date".

`run_update` downloads the new build, injects the current notebook into it,
overwrites the file on disk and reloads the app. That drops this bridge until
the notebook reconnects, so the tool acknowledges *before* reloading rather than
letting the agent time out on a success. It requires `confirm: true`; ask the
user first. A safety backup is downloaded beforehand where the browser permits
it — an unattended browser may block the download, so the backup is best-effort,
not a guarantee.

## Config

| Env var | Default | Purpose |
|---------|---------|---------|
| `POWERNOTE_BRIDGE_PORT` | `41777` | WebSocket port (loopback only). |
| `POWERNOTE_BRIDGE_TIMEOUT_MS` | `10000` | How long to wait for the app to answer. |
| `POWERNOTE_BRIDGE_SLOW_TIMEOUT_MS` | `120000` | Budget for the network-bound tools (`check_update`, `run_update`, `save_notebook`). |
| `POWERNOTE_AGENT_NAME` | `agent-<id>` | Label other agents see in `LOCKED` errors and `bridge_status`. |
| `POWERNOTE_LOCK_IDLE_MS` | `10000` | Idle grace before another agent may take the notebook. |
| `POWERNOTE_LOCK_MAX_HOLD_MS` | `120000` | After this a holder yields, if anyone is waiting. |

If the port is taken the server says so on stderr rather than dying silently.

## Security

The bridge has no authentication. Anything that can reach the port can edit the
open notebook, so only enable it on a machine you control. It binds `127.0.0.1`
and never `0.0.0.0`. A handshake token is the obvious next step if this ever
runs somewhere shared.

## One notebook at a time

The newest connection wins, so a stale socket can never lock out the notebook
you are actually looking at. The displaced notebook is sent a `displaced` frame
before its socket closes, and it then stops for good rather than retrying — it
also unticks its own Agent bridge box and says why. Tick the box again to take
the connection back.

That handshake matters. Without it the displaced client reconnects on backoff,
displaces the newcomer in turn, and the two trade the slot forever while writes
land in whichever notebook currently holds it.

## Tests

```bash
npm test --prefix powernote-mcp
```

Covers the connection-slot behaviour, including that the `displaced` frame
arrives *before* the close. The app-side half is covered by Playwright T98.

## Notes

- `stdout` is the MCP transport; all logging goes to `stderr`.
- If no notebook is connected, tools fail immediately with instructions rather
  than hanging. Requests already in flight to a displaced notebook fail straight
  away too, instead of waiting out the timeout.
