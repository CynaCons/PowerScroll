/**
 * Wire protocol shared by PowerScroll and its MCP server. The legacy
 * `app: powernote` wire id stays stable for existing notebooks and clients.
 *
 * Direction matters: the MCP server HOSTS the WebSocket and the app dials OUT
 * to it. A browser page cannot listen on a port, and PowerScroll ships as a
 * single static HTML file with no runtime backend, so the app is always the
 * client here.
 *
 * Because the agent mutates the live Zustand stores (rather than rewriting the
 * .html on disk), the normal auto-save pipeline persists agent edits exactly
 * like user edits — there is no external-write/auto-save collision to resolve.
 */

import type { BackgroundMode } from '../types/data';

export const BRIDGE_PROTOCOL_VERSION = 1;

/** Loopback only — the bridge must never be reachable off-machine. */
export const DEFAULT_BRIDGE_PORT = 41777;
export const DEFAULT_BRIDGE_URL = `ws://127.0.0.1:${DEFAULT_BRIDGE_PORT}`;

export type BridgeCommandName =
  | 'list_pages'
  | 'read_page'
  | 'read_diagram'
  | 'read_image'
  | 'create_section'
  | 'create_page'
  | 'append_block'
  | 'insert_block'
  | 'insert_image'
  | 'move_block'
  | 'create_diagram'
  | 'fit_diagram'
  | 'get_block'
  | 'update_block'
  | 'rename_page'
  | 'move_page'
  | 'list_scrolls'
  | 'create_scroll'
  | 'rename_scroll'
  | 'move_scroll'
  | 'resize_scroll'
  | 'delete_page'
  | 'delete_section'
  | 'delete_scroll'
  | 'delete_block'
  | 'delete_diagram'
  | 'get_background'
  | 'set_background'
  | 'rename_notebook'
  | 'save_notebook'
  | 'check_update'
  | 'run_update'
  | 'board_list'
  | 'board_create'
  | 'board_read'
  | 'board_updates'
  | 'card_create'
  | 'card_get'
  | 'card_update'
  | 'card_claim'
  | 'card_release'
  | 'card_move'
  | 'card_note'
  | 'card_check'
  | 'card_checklist_add'
  | 'card_checklist_update'
  | 'card_checklist_remove'
  | 'card_checklist_move'
  | 'card_checklist_set'
  | 'card_archive'
  | 'card_restore'
  | 'agent_status'
  | 'agent_leave';

/**
 * Hard cap on a serialized read payload, in characters.
 *
 * Applies to every agent-visible read (`read_page`, `read_diagram`,
 * `get_block`, and the MCP-side `read_image` file result). Chosen so a
 * typical agent context is not blown by one call. When the serialized
 * response would exceed this, the tool trims at a documented boundary
 * and sets a notice — it never fails the call for size. A response that
 * still overflows after those steps is an INTERNAL bug.
 *
 * The app→MCP `read_image` frame carries the data URI and is allowed to
 * exceed this cap: the budget is on what the agent sees, not the
 * websocket. The `ws` default maxPayload is 100 MiB and there is no
 * tighter frame cap in the app client; images are already downscaled
 * (2048 long edge) so they sit well under it.
 */
export const READ_PAGE_RESPONSE_BUDGET = 20_000;

/**
 * Representative `read_diagram` member on the wire (id, type, geometry, no
 * label). Default `member_limit` is half the budget divided by this size,
 * so a typical page (envelope + source + one page of members) sits well
 * under the cap. Do not replace this with a second magic page-size number.
 */
const TYPICAL_DIAGRAM_MEMBER_WIRE = JSON.stringify({
  id: 'member-0000',
  type: 'shape',
  x: 1234.56,
  y: 1234.56,
  w: 120,
  h: 48,
});

export const READ_DIAGRAM_DEFAULT_MEMBER_LIMIT = Math.max(
  1,
  Math.floor(READ_PAGE_RESPONSE_BUDGET / 2 / TYPICAL_DIAGRAM_MEMBER_WIRE.length),
);

/** Sent by the app immediately after the socket opens. */
export interface BridgeHello {
  v: number;
  type: 'hello';
  app: 'powernote';
  appVersion: string;
  /** Notebook filename, so the agent can confirm it is writing where it thinks. */
  notebook: string;
}

/**
 * Sent by the server to a client it is about to disconnect because another
 * notebook has claimed the slot.
 *
 * This frame exists to stop a flip-flop: without it, the displaced client's
 * reconnect backoff kicks in, it displaces the new client in turn, and the two
 * trade the slot forever while commands land in whichever notebook happens to
 * hold it. A displaced client must stand down and NOT retry.
 */
export interface BridgeDisplaced {
  v: number;
  type: 'displaced';
  reason: string;
}

/**
 * Presence of MCP agents connected to this notebook. Pushed whenever the app
 * connects and whenever a peer joins or leaves.
 */
export interface BridgeAgents {
  v: number;
  type: 'agents';
  agents: Array<{
    label: string;
    role: string;
    connectedAt: number;
  }>;
}

/** Control frames the server can push outside of request/response. */
export type BridgeControlFrame = BridgeDisplaced | BridgeAgents;

export interface BridgeRequest {
  v: number;
  id: string;
  cmd: BridgeCommandName;
  params: Record<string, unknown>;
}

export type BridgeErrorCode =
  | 'BAD_PARAMS'
  | 'INVALID'
  | 'NAME_REQUIRED'
  | 'NOT_FOUND'
  | 'UNSUPPORTED'
  /** Command is valid but the app cannot run it in its current state. */
  | 'PRECONDITION'
  | 'QUESTION_REQUIRED'
  | 'ARCHIVED'
  | 'INTERNAL';

export interface BridgeOk<T = unknown> {
  v: number;
  id: string;
  ok: true;
  result: T;
}

export interface BridgeErr {
  v: number;
  id: string;
  ok: false;
  error: { code: BridgeErrorCode; message: string };
}

export class BridgeCommandError extends Error {
  code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'BridgeCommandError';
  }
}

export type BridgeResponse<T = unknown> = BridgeOk<T> | BridgeErr;

// ── Result payloads ─────────────────────────────────────────

export interface PageSummary {
  sectionId: string;
  sectionTitle: string;
  pageId: string;
  title: string;
  /** Number of text blocks currently on the page. */
  blockCount: number;
  isActive: boolean;
}

export interface MarkdownTruncation {
  /** Length of the untruncated markdown. */
  fullLength: number;
  notice: string;
}

export interface BlockSummary {
  blockId: string;
  markdown: string;
  /** A4 page-guide column the block sits in (0 = leftmost). */
  column: number;
  /** Scroll the block sits in, derived from its position. */
  scrollId?: string;
  /** Set when this block's markdown was cut to stay under the budget. */
  markdownTruncated?: MarkdownTruncation;
}

/** A named column band. Blocks belong to it by position, not by a stored link. */
export interface ScrollSummary {
  scrollId: string;
  title: string;
  /** 0 = leftmost band. */
  column: number;
  /** Effective persisted band width in canvas pixels. */
  width: number;
  blockCount: number;
}

export interface DiagramBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceOmitted {
  /** Length of the omitted source text. */
  length: number;
  notice: string;
}

/** Index entry for one diagram on a page. No members, no source by default. */
export interface DiagramSummary {
  id: string;
  title: string;
  format: DiagramSourceFormat;
  /**
   * 'snapshot': an exact image rendered by the draw.io viewer extension —
   * memberCount is 0 by design, the source remains the editable truth.
   * 'nodes' (or absent): transpiled native member nodes.
   */
  renderMode?: 'snapshot' | 'nodes';
  memberCount: number;
  bounds: DiagramBounds;
  /** Present only when `include_diagram_source` is true. */
  source?: string;
  /**
   * Replaces `source` when the source was dropped to stay under the budget.
   * `notice` is the short pointer `'use read_diagram'`.
   */
  sourceOmitted?: SourceOmitted;
}

export interface DiagramMemberSummary {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Text of a label node, when the member is type `text`. */
  label?: string;
}

export interface SourceTruncation {
  /** Length of the untruncated source. */
  fullLength: number;
  notice: string;
}

/** Full detail for one diagram (`read_diagram`). */
export interface DiagramDetail {
  id: string;
  title: string;
  format: DiagramSourceFormat;
  source: string;
  bounds: DiagramBounds;
  /** See DiagramSummary.renderMode — snapshot diagrams return members: []. */
  renderMode?: 'snapshot' | 'nodes';
  memberCount: number;
  members: DiagramMemberSummary[];
  /**
   * Id of the last member in this page of results. Pass it back as
   * `member_cursor` to continue. Omitted when this response already holds
   * the rest of the (windowed) member list.
   */
  nextCursor?: string;
  /** Set when the size cap dropped members; `at` is the last member kept. */
  truncated?: PageTruncation;
  /** Set when `source` was cut because it alone exceeded the budget. */
  sourceTruncated?: SourceTruncation;
}

export interface StrokesSummary {
  count: number;
  grouped: number;
}

export interface PageTruncation {
  /** Last item (block, member, diagram, or image) that made it into this response. */
  at: string;
  notice: string;
}

/** Compact index entry for one top-level image. Never includes `src`. */
export interface ImageSummary {
  id: string;
  alt: string;
  x: number;
  y: number;
  w: number;
  h: number;
  naturalWidth: number;
  naturalHeight: number;
  /** Decoded byte size of the embedded payload, from the base64 length. */
  bytes: number;
  mini: boolean;
  scrollId?: string;
}

export interface PageContent {
  sectionId: string;
  pageId: string;
  title: string;
  blocks: BlockSummary[];
  diagrams: DiagramSummary[];
  images: ImageSummary[];
  scrolls: ScrollSummary[];
  strokesSummary?: StrokesSummary;
  /**
   * Id of the last block in this page of results. Pass it back as `cursor`
   * to continue. Omitted when this response already holds the rest of the
   * (filtered) block list.
   */
  nextCursor?: string;
  /** Set when the size cap dropped blocks; `at` is the last block kept. */
  truncated?: PageTruncation;
  /** Set when the size cap dropped diagrams; `at` is the last diagram kept. */
  diagramsTruncated?: PageTruncation;
  /** Set when the size cap dropped images; `at` is the last image kept. */
  imagesTruncated?: PageTruncation;
}

export interface GetBlockResult extends BlockSummary {
  sectionId: string;
  pageId: string;
  /** Echo of the requested markdown offset (0 when not paging). */
  offset?: number;
  /**
   * Present when the returned markdown is a slice: pass this back as `offset`
   * to continue. With it, a block of ANY size is fully readable in bounded
   * calls — the budget truncates a call, never strands content.
   */
  nextOffset?: number;
}

export interface FitDiagramResult {
  diagramId: string;
  scale: number;
  width: number;
  height: number;
  warning?: string;
}

export interface ListScrollsResult {
  sectionId: string;
  pageId: string;
  pageTitle: string;
  scrolls: ScrollSummary[];
}

export interface CreateScrollResult {
  sectionId: string;
  pageId: string;
  scrollId: string;
  title: string;
  column: number;
}

export interface RenameScrollResult {
  scrollId: string;
  title: string;
  previousTitle: string;
}

export interface MoveScrollResult {
  scrollId: string;
  title: string;
  fromColumn: number;
  toColumn: number;
}

export interface ResizeScrollResult {
  scrollId: string;
  title: string;
  requestedWidth: number;
  width: number;
  delta: number;
}

/** What a delete removed. Deletes are irreversible over the bridge — there is
 *  no agent-facing undo — so each result names exactly what went. */
export interface DeleteResult {
  deleted: 'page' | 'section' | 'scroll' | 'block';
  id: string;
  title?: string;
  /** Nodes removed alongside the target (delete_scroll with content:delete). */
  blocksRemoved?: number;
  /** Present when a deprecated alias (e.g. `withBlocks`) was used. */
  notice?: string;
}

/** What `delete_diagram` removed. Counts exclude the frame itself. */
export interface DeleteDiagramResult {
  deletedMembers: number;
  deletedStrokes: number;
}

/**
 * The notebook's canvas look.
 *
 * `color` is an agent-facing NAME ("paper", "light-gray") rather than the hex
 * stored in `WorkspaceSettings.bgColor`. The app offers four presets, not free
 * colour, so a name is both easier for a model to reason about and impossible
 * to get subtly wrong by a digit.
 */
export interface BackgroundResult {
  /** The look the page is actually drawn with, override resolved. */
  guideStyle: BackgroundMode;
  color: string;
  /** Which layer each value came from, so an agent can tell inherited from set. */
  source?: { guideStyle: 'page' | 'notebook'; color: 'page' | 'notebook' };
  /** What a page without an override falls back to. */
  notebookDefault?: { guideStyle: BackgroundMode; color: string };
  /** The page the answer is about. */
  pageId?: string;
  /** Which layer a write went to. */
  scope?: 'page' | 'notebook';
  /** Only present on set_background, so the agent can report what it changed. */
  previous?: { guideStyle: BackgroundMode; color: string };
}

export interface ListPagesResult {
  notebook: string;
  pages: PageSummary[];
}

export interface CreateSectionResult {
  sectionId: string;
  title: string;
  /** First page auto-created with the section. */
  pageId: string;
}

export interface CreatePageResult {
  sectionId: string;
  pageId: string;
  title: string;
  /** Present when a heading block was written onto the canvas. */
  headingBlockId?: string;
}

export interface AppendBlockResult {
  sectionId: string;
  pageId: string;
  blockId: string;
  column: number;
  /** Scroll the block landed in, when the page has a record for that band. */
  scrollId?: string;
}

/** `insert_block` / `move_block`: the block as read_page would report it, plus how many siblings moved. */
export interface InsertBlockResult extends BlockSummary {
  /** Content blocks whose y changed (the inserted/moved block itself is not counted). */
  displacedCount: number;
}

export type MoveBlockResult = InsertBlockResult;

/**
 * App → MCP `read_image`. Carries the data URI so the server can write a
 * file. May exceed `READ_PAGE_RESPONSE_BUDGET` — that cap is on the
 * agent-visible `{path, format, bytes, …}` result, which never includes `src`.
 */
export interface ReadImageResult {
  id: string;
  src: string;
  format: string;
  bytes: number;
  naturalWidth: number;
  naturalHeight: number;
  alt: string;
}

/** MCP → agent `read_image`. Path to the decoded file; never the payload. */
export interface ReadImageFileResult {
  path: string;
  format: string;
  bytes: number;
  naturalWidth: number;
  naturalHeight: number;
  alt: string;
}

/**
 * `insert_image`: display + natural dims of the landed node. Never includes
 * `src` / the base64 payload.
 */
export interface InsertImageResult {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  mini: boolean;
  /** Occupants whose y changed (the inserted image itself is not counted). */
  displacedCount: number;
}

/**
 * Language a diagram source is written in.
 *
 * Duplicated from `src/diagram` rather than imported: this module is the wire
 * contract, and the MCP server reads it without pulling in the renderer.
 */
export type DiagramSourceFormat = 'plantuml' | 'mermaid' | 'svg' | 'drawio';

/** What `create_diagram` drew. Diagnostics travel back with the write, so a
 *  clean diagram costs one round trip and a flawed one still reports why. */
export interface CreateDiagramResult {
  sectionId: string;
  pageId: string;
  /** Id of the diagram node. Its contents carry this as their groupId. */
  diagramId: string;
  title: string;
  /** Grammar that read the source, so the agent can see which tool ran. */
  format: DiagramSourceFormat;
  column: number;
  /**
   * 'snapshot': the source was rendered by the draw.io viewer extension into
   * an exact image — elementCount is 0 by design, not a failure. 'nodes':
   * transpiled native members (the pre-v0.64 behaviour, and the fallback).
   */
  renderMode?: 'snapshot' | 'nodes';
  /** Native shape and text nodes drawn inside the frame. 0 for snapshots. */
  elementCount: number;
  width: number;
  height: number;
  diagnostics: { line: number; severity: 'error' | 'ignored'; message: string }[];
  /**
   * Geometric placement notes (v0.51). Empty when the diagram was not
   * scaled. A floor-scale fit names the scroll, the requested width and
   * the applied scale, riding the v0.34 "warnings in the same response"
   * contract so the agent does not need a second call.
   */
  warnings: string[];
}

export interface UpdateBlockResult {
  blockId: string;
  /** Occupants shoved by the height delta. 0 when the height did not change. */
  displacedCount: number;
}

export interface RenamePageResult {
  sectionId: string;
  pageId: string;
  title: string;
  previousTitle: string;
  /** Set when the canvas H1 was rewritten to match the new title. */
  headingBlockId?: string;
}

export interface MovePageResult {
  pageId: string;
  title: string;
  fromSectionId: string;
  toSectionId: string;
  /** Final position of the page within the target section. */
  index: number;
}

export interface RenameNotebookResult {
  filename: string;
  previousFilename: string;
  /**
   * The bound file on disk is NOT renamed — the handle keeps its own name.
   * Present when a file is bound, so the agent can say so.
   */
  boundFilename?: string;
}

export interface SaveNotebookResult {
  filename: string;
  /** Name of the file actually written on disk. */
  savedTo: string;
  saveRevision: number;
}

export interface CheckUpdateResult {
  currentVersion: string;
  /** False when up to date OR when the check could not run — see `checked`. */
  available: boolean;
  /** False when GitHub was unreachable or rate-limited. */
  checked: boolean;
  latestVersion?: string;
  releaseUrl?: string;
  message?: string;
}

export interface RunUpdateResult {
  fromVersion: string;
  toVersion: string;
  mode: 'live-swap' | 'download';
  /**
   * True for live-swap: the app reloads shortly after this response is sent,
   * which drops the bridge connection until the notebook reconnects.
   */
  reloading: boolean;
}

export function isBridgeErr(r: BridgeResponse): r is BridgeErr {
  return r.ok === false;
}

// ── Board / card payloads ───────────────────────────────────

export interface BoardColumnCounts {
  todo: number;
  doing: number;
  waiting: number;
  done: number;
}

export interface BoardListEntry {
  id: string;
  title: string;
  sectionId: string;
  section: string;
  counts: BoardColumnCounts;
}

export interface BoardListResult {
  boards: BoardListEntry[];
}

export interface BoardCreateResult {
  boardId: string;
  title: string;
  sectionId: string;
}

export interface CardNoteSummary {
  author: string;
  text: string;
  at: number;
}

export interface CardListEntry {
  id: string;
  number: number;
  title: string;
  column: string;
  order: number;
  assignee?: string;
  labels: string[];
  checklist: { done: number; total: number };
  question?: string;
  lastNote?: CardNoteSummary;
  updatedAt: number;
  archivedAt?: number;
}

/** A checklist item as agents see it: `index` is its 1-based position, `depth` its level (0 to 3). */
export interface CheckItemEntry {
  id: string;
  index: number;
  text: string;
  done: boolean;
  depth: number;
}

/** A card after a checklist change, with the item it touched. */
export interface ChecklistEditResult extends CardListEntry {
  item?: CheckItemEntry;
  items: CheckItemEntry[];
}

export interface BoardReadResult {
  boardId: string;
  title: string;
  cards: CardListEntry[];
}

export interface BoardCardDetail {
  id: string;
  number: number;
  title: string;
  description: string;
  column: string;
  order: number;
  assignee?: string;
  labels: string[];
  checklist: CheckItemEntry[];
  notes: Array<{ id: string; author: string; at: number; text: string }>;
  question?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  history: Array<{
    seq: number;
    at: number;
    actor: string;
    type: string;
    from?: string;
    to?: string;
    text?: string;
  }>;
}

export interface CardGetResult {
  boardId: string;
  card: BoardCardDetail;
}

export interface BoardEventEntry {
  seq: number;
  at: number;
  actor: string;
  type: string;
  cardId?: string;
  card?: number;
  from?: string;
  to?: string;
  text?: string;
}

export interface BoardUpdatesResult {
  events: BoardEventEntry[];
  cursor: number;
}

export interface AgentStatusResult {
  me: string;
  text: string;
  boardId?: string;
  cardId?: string;
}

export interface AgentLeaveResult {
  me: string;
  boardId?: string;
}
