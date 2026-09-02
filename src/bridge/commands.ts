/**
 * Bridge command handlers.
 *
 * These drive the same Zustand stores the UI drives — the agent is just
 * another editor. Two invariants make that safe:
 *
 *  1. `savePageNodes` only ever writes the ACTIVE page, so any command
 *     touching page P must navigate to P first (`navigateToPage`).
 *  2. Auto-save subscribes to the WORKSPACE store only. A canvas-store write
 *     (`addNode`/`updateNode`) does not schedule a save on its own, so every
 *     mutating command must `flush()` afterwards or the edit can sit unsaved.
 */

import type {
  BackgroundMode,
  CanvasBgColor,
  CanvasNode,
  DiagramNodeData,
  ImageNodeData,
  ScrollRecord,
  Stroke,
  TextNodeData,
  WorkspaceSettings,
} from '../types/data';
import { notebookSettings, resolvePageSettings } from '../utils/pageSettings';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useCanvasStore } from '../stores/useCanvasStore';
import { useHistoryStore } from '../stores/useHistoryStore';
import { useDrawStore } from '../stores/useDrawStore';
import { liveCeiling } from '../utils/scrollCeiling';
import {
  createBlockNode,
  blockHeight,
  columnOf,
  diagramFrameIds,
  isContentBlock,
  orderedDiagramFrames,
  orderedImageNodes,
  orderedTextNodes,
  nextBlockY,
} from './blocks';
import { columnX } from './blocks';
import {
  diagramMembers,
  diagramSourceOf,
  fitExistingDiagram,
  isSnapshotDiagram,
  placeDiagramOnCanvas,
  placeDiagramSnapshotOnCanvas,
} from '../diagram/canvasOps';
import { renderDrawioSnapshot } from '../diagram/drawioRender';
import { sniffFormat, normalizeDrawioSource } from '../diagram';
import { A4_WIDTH, columnWidth } from '../utils/pageLayout';
import { contentBelongsToScroll, pageUsesColumnFlow, scrollById, strokeBelongsToScrollBand } from '../utils/scrolls';
import {
  applyDisplacements,
  applyStrokeDisplacements,
  isFlowItem,
  insertBlockAt,
  planHeightChange,
  planMoveBlock,
  removeBlockGap,
  type PageLike,
} from './reflow';
import type {
  AppendBlockResult,
  CreateDiagramResult,
  BackgroundResult,
  BlockSummary,
  BridgeCommandName,
  BridgeErrorCode,
  CheckUpdateResult,
  CreatePageResult,
  CreateScrollResult,
  CreateSectionResult,
  DeleteDiagramResult,
  DeleteResult,
  DiagramDetail,
  DiagramSourceFormat,
  DiagramSummary,
  FitDiagramResult,
  GetBlockResult,
  ImageSummary,
  InsertBlockResult,
  InsertImageResult,
  ListPagesResult,
  ListScrollsResult,
  MarkdownTruncation,
  SourceOmitted,
  SourceTruncation,
  MoveBlockResult,
  MovePageResult,
  MoveScrollResult,
  PageContent,
  ReadImageResult,
  RenameNotebookResult,
  RenamePageResult,
  RenameScrollResult,
  ResizeScrollResult,
  RunUpdateResult,
  SaveNotebookResult,
  ScrollSummary,
  UpdateBlockResult,
} from './protocol';
import { READ_DIAGRAM_DEFAULT_MEMBER_LIMIT, READ_PAGE_RESPONSE_BUDGET } from './protocol';
import { APP_VERSION } from '../version';
import { checkForUpdate, performUpdate } from '../utils/updateChecker';
import { isFSASupported } from '../utils/fileSystemAccess';
import { getCurrentHandle } from '../utils/fileHandleStore';
import {
  dataUriDecodedBytes,
  dataUriImageFormat,
  embedImage,
  imageNodeFromEmbed,
  type ImageEmbed,
} from '../utils/imageEmbed';
import { imageMiniTogglePatch } from '../utils/imageMini';

export class BridgeCommandError extends Error {
  code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'BridgeCommandError';
  }
}

// ── State helpers ───────────────────────────────────────────

/** Push live canvas/draw state back into the workspace (and mark it dirty). */
function flush(): void {
  const ws = useWorkspaceStore.getState();
  ws.savePageNodes(useCanvasStore.getState().nodes);
  ws.savePageStrokes(useDrawStore.getState().strokes);
}

function locatePage(pageId: string) {
  const { workspace } = useWorkspaceStore.getState();
  for (const section of workspace.sections) {
    const page = section.pages.find((p) => p.id === pageId);
    if (page) return { section, page };
  }
  return null;
}

/** Resolve an optional pageId to a concrete page, defaulting to the active one. */
function resolvePage(pageId?: string) {
  if (!pageId) {
    const ws = useWorkspaceStore.getState();
    const located = locatePage(ws.activePageId);
    if (!located) {
      throw new BridgeCommandError('INTERNAL', 'No active page in this notebook');
    }
    return located;
  }
  const located = locatePage(pageId);
  if (!located) {
    throw new BridgeCommandError('NOT_FOUND', `No page with id "${pageId}"`);
  }
  return located;
}

/**
 * Save the current page, switch, then load the target page's content.
 * Mirrors the navigation sequence used by the hierarchy panel and search.
 */
function navigateToPage(sectionId: string, pageId: string): void {
  const current = useWorkspaceStore.getState();
  if (current.activeSectionId === sectionId && current.activePageId === pageId) return;

  flush();
  useWorkspaceStore.getState().setActivePage(sectionId, pageId);

  // Re-read AFTER the flush so we load post-save content, not a stale snapshot.
  const ws = useWorkspaceStore.getState();
  const section = ws.workspace.sections.find((s) => s.id === sectionId);
  const page = section?.pages.find((p) => p.id === pageId);
  useCanvasStore.getState().loadPageNodes(page?.nodes ?? []);
  useDrawStore.getState().loadPageStrokes(page?.strokes ?? []);
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BridgeCommandError('BAD_PARAMS', `"${key}" must be a non-empty string`);
  }
  return value;
}

/**
 * Resolve where a write lands, preferring an explicit scroll over a raw column.
 *
 * `scrollId` is the supported way to target a band: it survives reordering, and
 * it fails loudly when the agent is holding a stale id. `column` predates
 * scrolls and stays working, but it is positional — an agent using it can
 * silently write into a scroll that moved under it.
 */
function resolveColumn(
  params: Record<string, unknown>,
  page: import('../types/data').Page,
): number {
  const scrollId = optionalString(params, 'scrollId');
  if (scrollId) {
    const scroll = scrollById(page.scrolls, scrollId);
    if (!scroll) {
      const known = (page.scrolls ?? [])
        .map((s) => `"${s.id}"${s.title ? ` (${s.title})` : ''}`)
        .join(', ');
      throw new BridgeCommandError(
        'NOT_FOUND',
        `No scroll with id "${scrollId}" on page "${page.title}". ` +
          (known ? `Known scrolls: ${known}.` : 'This page has no scrolls.') +
          ' Call list_scrolls to refresh.',
      );
    }
    return scroll.column;
  }
  return optionalColumn(params);
}

/** Scroll id covering a column band, if the page has a record for it. */
function scrollIdForColumn(
  page: import('../types/data').Page,
  column: number,
): string | undefined {
  return page.scrolls?.find((s) => s.column === column)?.id;
}

function summariseScrolls(page: import('../types/data').Page): ScrollSummary[] {
  return [...(page.scrolls ?? [])]
    .sort((a, b) => a.column - b.column)
    .map((scroll) => ({
      scrollId: scroll.id,
      title: scroll.title,
      column: scroll.column,
      width: columnWidth(scroll.column, page.scrolls),
      blockCount: page.nodes.filter(
        (n) =>
          isContentBlock(n, diagramFrameIds(page.nodes)) &&
          columnOf(n, page.scrolls) === scroll.column,
      ).length,
    }));
}

function findNodeInNotebook(id: string) {
  const { workspace } = useWorkspaceStore.getState();
  for (const section of workspace.sections) {
    for (const page of section.pages) {
      const node = page.nodes.find((n) => n.id === id);
      if (node) return { section, page, node };
    }
  }
  return null;
}

function diagramTitleOf(node: CanvasNode): string {
  const data = node.data as DiagramNodeData;
  return typeof data?.title === 'string' ? data.title : '';
}

/** A node that belongs to a diagram frame (not the frame itself). */
function owningDiagramFrame(nodes: CanvasNode[], node: CanvasNode): CanvasNode | null {
  if (!node.groupId || node.groupId === node.id) return null;
  return nodes.find((n) => n.id === node.groupId && n.type === 'diagram') ?? null;
}

function refuseDiagramMember(
  node: CanvasNode,
  frame: CanvasNode,
  action: 'delete' | 'update' | 'move',
): never {
  const title = diagramTitleOf(frame) || frame.id;
  const redraw = 'redraw the diagram source';
  if (action === 'delete') {
    throw new BridgeCommandError(
      'UNSUPPORTED',
      `"${node.id}" is a member of diagram "${title}" (${frame.id}). ` +
        `Use delete_diagram to remove the whole diagram, or ${redraw}. ` +
        'Individual members cannot be deleted over the bridge.',
    );
  }
  if (action === 'move') {
    throw new BridgeCommandError(
      'UNSUPPORTED',
      `"${node.id}" is a member of diagram "${title}" (${frame.id}). ` +
        'Diagram members stay with the frame and cannot be moved with move_block.',
    );
  }
  throw new BridgeCommandError(
    'UNSUPPORTED',
    `"${node.id}" is a member of diagram "${title}" (${frame.id}). ` +
      `Update the diagram by ${redraw}; individual members cannot be edited over the bridge.`,
  );
}

/** Frames, members, shapes, images — anything that is not a free-standing text block. */
function refuseNonContentBlock(node: CanvasNode, nodes: CanvasNode[], verb: 'insert' | 'move'): never {
  const owner = owningDiagramFrame(nodes, node);
  if (owner) refuseDiagramMember(node, owner, 'move');
  if (node.type === 'diagram') {
    throw new BridgeCommandError(
      'UNSUPPORTED',
      `"${node.id}" is a diagram frame, not a markdown block. ` +
        (verb === 'move'
          ? 'Use move_block on the frame id to reorder it in the scroll.'
          : 'Pass the frame id as after to insert below the diagram.'),
    );
  }
  throw new BridgeCommandError(
    'UNSUPPORTED',
    `"${node.id}" is a ${node.type} node, not a content block. ` +
      `Only free-standing text blocks and diagram frames can be ${verb === 'move' ? 'moved' : 'used as an insert anchor'} over the bridge.`,
  );
}

function summariseDiagram(
  nodes: CanvasNode[],
  frame: CanvasNode,
  withSource: boolean,
): DiagramSummary {
  const source = diagramSourceOf(frame);
  return {
    id: frame.id,
    title: diagramTitleOf(frame),
    format: sniffFormat(source),
    ...(isSnapshotDiagram(frame) ? { renderMode: 'snapshot' as const } : {}),
    memberCount: diagramMembers(nodes, frame.id).length,
    bounds: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
    ...(withSource ? { source } : {}),
  };
}

function summariseImage(
  page: import('../types/data').Page,
  node: CanvasNode,
): ImageSummary {
  const data = node.data as ImageNodeData;
  const src = typeof data.src === 'string' ? data.src : '';
  const column = columnOf(node, page.scrolls);
  return {
    id: node.id,
    alt: typeof data.alt === 'string' ? data.alt : '',
    x: node.x,
    y: node.y,
    w: node.width,
    h: node.height,
    naturalWidth: data.naturalWidth,
    naturalHeight: data.naturalHeight,
    bytes: dataUriDecodedBytes(src),
    mini: !!data.mini,
    scrollId: scrollIdForColumn(page, column),
  };
}

const INCLUDE_FIELDS = ['blocks', 'diagrams', 'images', 'strokes-summary'] as const;
type IncludeField = (typeof INCLUDE_FIELDS)[number];
const DEFAULT_INCLUDE: IncludeField[] = ['blocks', 'diagrams', 'images'];

function isIncludeField(item: unknown): item is IncludeField {
  return typeof item === 'string' && (INCLUDE_FIELDS as readonly string[]).includes(item);
}

function parseInclude(params: Record<string, unknown>): Set<IncludeField> {
  const raw = params.include;
  if (raw === undefined || raw === null) return new Set(DEFAULT_INCLUDE);
  if (!Array.isArray(raw)) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      '"include" must be an array of "blocks", "diagrams", "images", and/or "strokes-summary"',
    );
  }
  const set = new Set<IncludeField>();
  for (const item of raw) {
    if (!isIncludeField(item)) {
      throw new BridgeCommandError(
        'BAD_PARAMS',
        `"${String(item)}" is not an include field. Valid values: ${INCLUDE_FIELDS.join(', ')}.`,
      );
    }
    set.add(item);
  }
  return set;
}

function optionalPositiveInt(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new BridgeCommandError('BAD_PARAMS', `"${key}" must be a positive integer`);
  }
  return value;
}

function optionalBool(params: Record<string, unknown>, key: string): boolean {
  const value = params[key];
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') {
    throw new BridgeCommandError('BAD_PARAMS', `"${key}" must be a boolean when provided`);
  }
  return value;
}

function windowByCursor<T>(
  items: T[],
  idOf: (item: T) => string,
  cursor: string | undefined,
  limit: number | undefined,
  missing: (cursor: string) => string,
): { items: T[]; more: boolean } {
  let start = 0;
  if (cursor) {
    const idx = items.findIndex((item) => idOf(item) === cursor);
    if (idx < 0) {
      throw new BridgeCommandError('BAD_PARAMS', missing(cursor));
    }
    start = idx + 1;
  }
  const sliced = limit === undefined ? items.slice(start) : items.slice(start, start + limit);
  return { items: sliced, more: start + sliced.length < items.length };
}

function windowBlocks(
  blocks: BlockSummary[],
  cursor: string | undefined,
  limit: number | undefined,
): { blocks: BlockSummary[]; more: boolean } {
  const windowed = windowByCursor(
    blocks,
    (b) => b.blockId,
    cursor,
    limit,
    (c) =>
      `cursor "${c}" is not a block on this page (after filters). ` +
      'Pass the last blockId from the previous read_page.',
  );
  return { blocks: windowed.items, more: windowed.more };
}

function serializedLength(value: unknown): number {
  return JSON.stringify(value).length;
}

function assertWithinBudget(payload: unknown, tool: string): void {
  const length = serializedLength(payload);
  if (length > READ_PAGE_RESPONSE_BUDGET) {
    throw new BridgeCommandError(
      'INTERNAL',
      `${tool} budget invariant violated: serialized length ${length} exceeds ${READ_PAGE_RESPONSE_BUDGET}`,
    );
  }
}

const SOURCE_OMITTED_NOTICE = 'use read_diagram';

function omitDiagramSources(diagrams: DiagramSummary[]): DiagramSummary[] {
  return diagrams.map((d) => {
    if (typeof d.source !== 'string') return d;
    const omitted: SourceOmitted = { length: d.source.length, notice: SOURCE_OMITTED_NOTICE };
    const rest: DiagramSummary = { ...d };
    delete rest.source;
    return { ...rest, sourceOmitted: omitted };
  });
}

/**
 * Cut a string inside `payload` so the serialized payload fits `budget`.
 * One implementation for oversized block markdown (read_page + get_block)
 * and for a diagram source that alone blows the cap. Measures the whole
 * payload, not the field in isolation — the envelope counts.
 */
function fitStringIntoPayload<T>(
  payload: T,
  read: (p: T) => string,
  write: (p: T, value: string, meta: { fullLength: number; notice: string }) => T,
  noticeFor: (fullLength: number) => string,
  budget: number,
): T {
  const raw = read(payload);
  if (typeof raw !== 'string') return payload;
  if (serializedLength(payload) <= budget) return payload;

  const fullLength = raw.length;
  const meta = { fullLength, notice: noticeFor(fullLength) };

  let lo = 0;
  let hi = raw.length;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const trial = write(payload, raw.slice(0, mid), meta);
    if (serializedLength(trial) <= budget) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return write(payload, raw.slice(0, best), meta);
}

function markdownNotice(fullLength: number, budget: number): string {
  return `Block markdown is ${fullLength} characters; truncated to fit the ${budget}-character budget.`;
}

function sourceNotice(fullLength: number, budget: number): string {
  return (
    `Source is ${fullLength} characters; truncated to fit the ${budget}-character budget. ` +
    'Export as .drawio for the whole file.'
  );
}

function fitBlockMarkdownInPage(
  page: PageContent,
  blockIndex: number,
  budget = READ_PAGE_RESPONSE_BUDGET,
): PageContent {
  return fitStringIntoPayload(
    page,
    (p) => p.blocks[blockIndex]?.markdown ?? '',
    (p, markdown, markdownTruncated: MarkdownTruncation) => {
      const blocks = p.blocks.slice();
      const current = blocks[blockIndex];
      if (!current) return p;
      blocks[blockIndex] = { ...current, markdown, markdownTruncated };
      return { ...p, blocks };
    },
    (n) => markdownNotice(n, budget),
    budget,
  );
}

function fitSourceToBudget<T extends { source: string }>(
  payload: T,
  budget = READ_PAGE_RESPONSE_BUDGET,
): T {
  return fitStringIntoPayload(
    payload,
    (p) => p.source,
    (p, source, sourceTruncated: SourceTruncation) => ({ ...p, source, sourceTruncated }),
    (n) => sourceNotice(n, budget),
    budget,
  );
}

function applyResponseBudget(result: PageContent, moreAfterWindow: boolean): PageContent {
  const blockNotice =
    `Response exceeded the ${READ_PAGE_RESPONSE_BUDGET}-character budget. ` +
    'Blocks after this one were omitted. Pass cursor with this block id to continue, ' +
    'or get_block for a single block.';
  const diagramNotice =
    `Response exceeded the ${READ_PAGE_RESPONSE_BUDGET}-character budget. ` +
    'Diagrams after this one were omitted.';
  const imageNotice =
    `Response exceeded the ${READ_PAGE_RESPONSE_BUDGET}-character budget. ` +
    'Images after this one were omitted. Use read_image on images[].id to inspect one.';

  const pack = (
    blocks: BlockSummary[],
    diagrams: DiagramSummary[],
    images: ImageSummary[],
    more: boolean,
    truncatedAt?: string,
    diagramsTruncatedAt?: string,
    imagesTruncatedAt?: string,
  ): PageContent => {
    const last = blocks[blocks.length - 1];
    return {
      ...result,
      blocks,
      diagrams,
      images,
      ...(more && last ? { nextCursor: last.blockId } : {}),
      ...(truncatedAt ? { truncated: { at: truncatedAt, notice: blockNotice } } : {}),
      ...(diagramsTruncatedAt
        ? { diagramsTruncated: { at: diagramsTruncatedAt, notice: diagramNotice } }
        : {}),
      ...(imagesTruncatedAt
        ? { imagesTruncated: { at: imagesTruncatedAt, notice: imageNotice } }
        : {}),
    };
  };

  let blocks = result.blocks;
  let diagrams = result.diagrams;
  let images = result.images;
  let more = moreAfterWindow;
  let truncatedAt: string | undefined;
  let diagramsTruncatedAt: string | undefined;
  let imagesTruncatedAt: string | undefined;

  let out = pack(blocks, diagrams, images, more);

  // 1. Trim blocks at a block boundary, always keeping one when any exist.
  if (serializedLength(out) > READ_PAGE_RESPONSE_BUDGET && blocks.length > 0) {
    const kept: BlockSummary[] = [];
    for (const block of blocks) {
      const trial = pack([...kept, block], diagrams, images, true, block.blockId);
      if (serializedLength(trial) > READ_PAGE_RESPONSE_BUDGET && kept.length > 0) break;
      kept.push(block);
    }
    if (kept.length === 0) kept.push(blocks[0]);
    const last = kept[kept.length - 1];
    more = moreAfterWindow || kept.length < blocks.length;
    truncatedAt = last.blockId;
    blocks = kept;
    out = pack(blocks, diagrams, images, more, truncatedAt);
  }

  // 2. Drop per-diagram source fields (replaced with sourceOmitted).
  if (serializedLength(out) > READ_PAGE_RESPONSE_BUDGET) {
    diagrams = omitDiagramSources(diagrams);
    out = pack(blocks, diagrams, images, more, truncatedAt);
  }

  // 3. Trim diagrams[] at an entry boundary.
  if (serializedLength(out) > READ_PAGE_RESPONSE_BUDGET && diagrams.length > 0) {
    const kept: DiagramSummary[] = [];
    for (const diagram of diagrams) {
      const trial = pack(blocks, [...kept, diagram], images, more, truncatedAt, diagram.id);
      if (serializedLength(trial) > READ_PAGE_RESPONSE_BUDGET && kept.length > 0) break;
      kept.push(diagram);
    }
    const dropped = kept.length < diagrams.length;
    diagrams = kept;
    const last = kept[kept.length - 1];
    diagramsTruncatedAt = dropped && last ? last.id : undefined;
    out = pack(blocks, diagrams, images, more, truncatedAt, diagramsTruncatedAt);
  }

  // 4. Trim images[] at an entry boundary (sits with diagrams in the ladder).
  if (serializedLength(out) > READ_PAGE_RESPONSE_BUDGET && images.length > 0) {
    const kept: ImageSummary[] = [];
    for (const image of images) {
      const trial = pack(
        blocks,
        diagrams,
        [...kept, image],
        more,
        truncatedAt,
        diagramsTruncatedAt,
        image.id,
      );
      if (serializedLength(trial) > READ_PAGE_RESPONSE_BUDGET && kept.length > 0) break;
      kept.push(image);
    }
    const dropped = kept.length < images.length;
    images = kept;
    const last = kept[kept.length - 1];
    imagesTruncatedAt = dropped && last ? last.id : undefined;
    out = pack(blocks, diagrams, images, more, truncatedAt, diagramsTruncatedAt, imagesTruncatedAt);
  }

  // 5. A single block larger than the budget: keep it, cut its markdown
  // against the full page payload (envelope + diagrams + images + scrolls).
  if (serializedLength(out) > READ_PAGE_RESPONSE_BUDGET && out.blocks.length > 0) {
    for (let i = 0; i < out.blocks.length; i++) {
      if (serializedLength(out) <= READ_PAGE_RESPONSE_BUDGET) break;
      out = fitBlockMarkdownInPage(out, i);
    }
  }

  assertWithinBudget(out, 'read_page');
  return out;
}

function applyDiagramBudget(
  result: DiagramDetail,
  moreAfterWindow: boolean,
): DiagramDetail {
  const notice =
    `Response exceeded the ${READ_PAGE_RESPONSE_BUDGET}-character budget. ` +
    'Members after this one were omitted. Pass member_cursor with this member id to continue.';

  const pack = (
    members: DiagramDetail['members'],
    more: boolean,
    truncatedAt?: string,
    extra?: Partial<DiagramDetail>,
  ): DiagramDetail => {
    const last = members[members.length - 1];
    return {
      ...result,
      ...extra,
      members,
      ...(more && last ? { nextCursor: last.id } : { nextCursor: undefined }),
      ...(truncatedAt ? { truncated: { at: truncatedAt, notice } } : { truncated: undefined }),
    };
  };

  let members = result.members;
  let more = moreAfterWindow;
  let truncatedAt: string | undefined;
  let out = pack(members, more);

  if (serializedLength(out) > READ_PAGE_RESPONSE_BUDGET && members.length > 0) {
    const kept: DiagramDetail['members'] = [];
    for (const member of members) {
      const trial = pack([...kept, member], true, member.id);
      // Do not force-keep a first member that itself overflows — source
      // may be the whole problem, and the next stage handles that.
      if (serializedLength(trial) > READ_PAGE_RESPONSE_BUDGET) break;
      kept.push(member);
    }
    const last = kept[kept.length - 1];
    more = moreAfterWindow || kept.length < members.length;
    truncatedAt = last?.id;
    members = kept;
    out = pack(members, more, truncatedAt);
  }

  // Source alone still over (even with zero members): cut the source.
  if (serializedLength(out) > READ_PAGE_RESPONSE_BUDGET) {
    const emptied = pack([], moreAfterWindow || result.members.length > 0);
    const fitted = fitSourceToBudget(emptied);
    out = fitted;
  }

  // Drop leftover `nextCursor: undefined` / `truncated: undefined` so they
  // do not serialize as explicit nulls and inflate the payload.
  if (out.nextCursor === undefined) delete (out as { nextCursor?: string }).nextCursor;
  if (out.truncated === undefined) delete (out as { truncated?: PageContent['truncated'] }).truncated;

  assertWithinBudget(out, 'read_diagram');
  return out;
}

/**
 * A4 column index to write into. 0 is the leftmost page guide; 1 is the guide
 * immediately to its right, and so on.
 */
function optionalColumn(params: Record<string, unknown>): number {
  const value = params.column;
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      '"column" must be a non-negative integer (0 = leftmost page guide)',
    );
  }
  return value;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new BridgeCommandError('BAD_PARAMS', `"${key}" must be a string when provided`);
  }
  return value;
}

function locateScroll(scrollId: string) {
  const { workspace } = useWorkspaceStore.getState();
  for (const section of workspace.sections) {
    for (const page of section.pages) {
      const scroll = scrollById(page.scrolls, scrollId);
      if (scroll) return { section, page, scroll };
    }
  }
  return null;
}

function missingScrollMessage(scrollId: string): string {
  const { workspace } = useWorkspaceStore.getState();
  const known = workspace.sections
    .flatMap((s) => s.pages)
    .flatMap((p) => p.scrolls ?? [])
    .map((s) => `"${s.id}"${s.title ? ` (${s.title})` : ''}`)
    .join(', ');
  return (
    `No scroll with id "${scrollId}" in this notebook. ` +
    (known ? `Known scrolls: ${known}.` : 'This notebook has no scrolls.') +
    ' Call list_scrolls to refresh.'
  );
}

/**
 * Exactly one of `after` (id, preferred) or `index`.
 *
 * Ids survive reordering; an index is a snapshot of reading order and goes
 * stale the moment anything above it moves — the same reason resolveColumn
 * prefers scrollId over a raw column integer.
 */
function parseBlockAnchor(
  params: Record<string, unknown>,
  verb: 'insert_block' | 'move_block' | 'insert_image',
): { after: string } | { index: number } {
  const hasAfter = params.after !== undefined && params.after !== null;
  const hasIndex = params.index !== undefined && params.index !== null;
  if (hasAfter && hasIndex) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      'Pass after (a block id) or index, not both. Prefer after: ids survive reordering, indices do not.',
    );
  }
  if (!hasAfter && !hasIndex) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      `${verb} needs exactly one of after (block id, preferred) or index.`,
    );
  }
  if (hasAfter) {
    if (typeof params.after !== 'string' || params.after.length === 0) {
      throw new BridgeCommandError('BAD_PARAMS', '"after" must be a non-empty block id');
    }
    return { after: params.after };
  }
  if (typeof params.index !== 'number' || !Number.isInteger(params.index) || params.index < 0) {
    throw new BridgeCommandError('BAD_PARAMS', '"index" must be a non-negative integer');
  }
  return { index: params.index };
}

function livePageLike(page: { scrolls?: ScrollRecord[]; settings?: Partial<WorkspaceSettings> }): PageLike {
  const ws = useWorkspaceStore.getState();
  const active = ws.getActivePage() ?? page;
  const settings = resolvePageSettings(active as import('../types/data').Page, ws.workspace);
  return {
    nodes: useCanvasStore.getState().nodes,
    scrolls: active.scrolls,
    strokes: useDrawStore.getState().strokes,
    columnFlow: pageUsesColumnFlow(settings.backgroundMode, active.scrolls),
  };
}

function applyFlowInOneUndo(nextNodes: CanvasNode[], nextStrokes: Stroke[]): void {
  useHistoryStore.getState().batchStart();
  useHistoryStore.getState().record();
  useCanvasStore.setState({ nodes: nextNodes });
  useDrawStore.setState({ strokes: nextStrokes });
  useWorkspaceStore.getState().markDirty();
  useHistoryStore.getState().batchEnd();
}

function toBlockSummary(
  node: CanvasNode,
  page: { scrolls?: import('../types/data').ScrollRecord[] },
): BlockSummary {
  const column = columnOf(node, page.scrolls);
  return {
    blockId: node.id,
    markdown: (node.data as TextNodeData).text,
    column,
    scrollId: scrollIdForColumn(page as import('../types/data').Page, column),
  };
}

function throwReflow(err: { code: 'NOT_FOUND' | 'BAD_PARAMS' | 'UNSUPPORTED'; message: string }): never {
  throw new BridgeCommandError(err.code, err.message);
}

// ── Commands ────────────────────────────────────────────────

function listPages(): ListPagesResult {
  flush();
  const { workspace, activePageId } = useWorkspaceStore.getState();
  const pages = workspace.sections.flatMap((section) =>
    section.pages.map((page) => ({
      sectionId: section.id,
      sectionTitle: section.title,
      pageId: page.id,
      title: page.title,
      blockCount: page.nodes.filter((n) => isContentBlock(n, diagramFrameIds(page.nodes))).length,
      isActive: page.id === activePageId,
    })),
  );
  return { notebook: workspace.filename, pages };
}

function readPage(params: Record<string, unknown>): PageContent {
  flush();
  const { section, page } = resolvePage(optionalString(params, 'pageId'));
  const include = parseInclude(params);
  const withSource = optionalBool(params, 'include_diagram_source');
  const limit = optionalPositiveInt(params, 'limit');
  const cursor = optionalString(params, 'cursor');
  const scrollId = optionalString(params, 'scrollId');

  if (scrollId) {
    const scroll = scrollById(page.scrolls, scrollId);
    if (!scroll) {
      const known = (page.scrolls ?? [])
        .map((s) => `"${s.id}"${s.title ? ` (${s.title})` : ''}`)
        .join(', ');
      throw new BridgeCommandError(
        'NOT_FOUND',
        `No scroll with id "${scrollId}" on page "${page.title}". ` +
          (known ? `Known scrolls: ${known}.` : 'This page has no scrolls.') +
          ' Call list_scrolls to refresh.',
      );
    }
  }

  const toBlock = (node: CanvasNode): BlockSummary => {
    const column = columnOf(node, page.scrolls);
    return {
      blockId: node.id,
      markdown: (node.data as TextNodeData).text,
      column,
      scrollId: scrollIdForColumn(page, column),
    };
  };

  let blocks = include.has('blocks') ? orderedTextNodes(page.nodes).map(toBlock) : [];
  if (scrollId) blocks = blocks.filter((b) => b.scrollId === scrollId);

  const windowed = windowBlocks(blocks, cursor, limit);

  let diagrams: DiagramSummary[] = [];
  if (include.has('diagrams')) {
    diagrams = orderedDiagramFrames(page.nodes)
      .filter((frame) => {
        if (!scrollId) return true;
        return scrollIdForColumn(page, columnOf(frame, page.scrolls)) === scrollId;
      })
      .map((frame) => summariseDiagram(page.nodes, frame, withSource));
  }

  let images: ImageSummary[] = [];
  if (include.has('images')) {
    images = orderedImageNodes(page.nodes)
      .filter((node) => {
        if (!scrollId) return true;
        return scrollIdForColumn(page, columnOf(node, page.scrolls)) === scrollId;
      })
      .map((node) => summariseImage(page, node));
  }

  const result: PageContent = {
    sectionId: section.id,
    pageId: page.id,
    title: page.title,
    blocks: windowed.blocks,
    diagrams,
    images,
    scrolls: summariseScrolls(page),
  };

  if (include.has('strokes-summary')) {
    const strokes = page.strokes ?? [];
    result.strokesSummary = {
      count: strokes.length,
      grouped: strokes.filter((s) => !!s.groupId).length,
    };
  }

  return applyResponseBudget(result, windowed.more);
}

function createSection(params: Record<string, unknown>): CreateSectionResult {
  flush();
  const title = requireString(params, 'title');
  useWorkspaceStore.getState().addSection(title);

  // addSection returns void — the new section is appended last.
  const { workspace } = useWorkspaceStore.getState();
  const section = workspace.sections[workspace.sections.length - 1];
  return { sectionId: section.id, title: section.title, pageId: section.pages[0].id };
}

async function createPage(params: Record<string, unknown>): Promise<CreatePageResult> {
  flush();
  const title = requireString(params, 'title');
  const withHeading = params.withHeading !== false;
  const column = optionalColumn(params);

  const sectionId = optionalString(params, 'sectionId')
    ?? useWorkspaceStore.getState().activeSectionId;
  const exists = useWorkspaceStore
    .getState()
    .workspace.sections.some((s) => s.id === sectionId);
  if (!exists) {
    throw new BridgeCommandError('NOT_FOUND', `No section with id "${sectionId}"`);
  }

  useWorkspaceStore.getState().addPage(sectionId, title);

  // addPage returns void — the new page is appended last in its section.
  const section = useWorkspaceStore
    .getState()
    .workspace.sections.find((s) => s.id === sectionId)!;
  const page = section.pages[section.pages.length - 1];

  navigateToPage(sectionId, page.id);

  let headingBlockId: string | undefined;
  if (withHeading) {
    // Put the title on the canvas too, not just in the sidebar, so the page
    // reads as a titled note.
    const node = createBlockNode(`# ${title}`, useCanvasStore.getState().nodes, column, page.scrolls);
    useCanvasStore.getState().addNode(node);
    headingBlockId = node.id;
  }
  flush();

  return { sectionId, pageId: page.id, title, headingBlockId };
}

async function appendBlock(params: Record<string, unknown>): Promise<AppendBlockResult> {
  flush();
  const markdown = requireString(params, 'markdown');
  const { section, page } = resolvePage(optionalString(params, 'pageId'));
  const column = resolveColumn(params, page);

  navigateToPage(section.id, page.id);

  const node = createBlockNode(markdown, useCanvasStore.getState().nodes, column, page.scrolls);
  useCanvasStore.getState().addNode(node);
  flush();

  return {
    sectionId: section.id,
    pageId: page.id,
    blockId: node.id,
    column,
    scrollId: scrollIdForColumn(page, column),
  };
}

async function insertBlock(params: Record<string, unknown>): Promise<InsertBlockResult> {
  flush();
  const markdown = requireString(params, 'markdown');
  const scrollId = requireString(params, 'scrollId');
  const anchor = parseBlockAnchor(params, 'insert_block');

  const located = locateScroll(scrollId);
  if (!located) {
    throw new BridgeCommandError('NOT_FOUND', missingScrollMessage(scrollId));
  }
  const { section, page, scroll } = located;

  if ('after' in anchor) {
    const found = findNodeInNotebook(anchor.after);
    if (!found) {
      throw new BridgeCommandError('NOT_FOUND', `No block with id "${anchor.after}"`);
    }
    const liveCheck = livePageLike(page);
    if (
      found.page.id !== page.id ||
      !isFlowItem(found.node, diagramFrameIds(found.page.nodes), !!liveCheck.columnFlow) ||
      columnOf(found.node, found.page.scrolls) !== scroll.column
    ) {
      const col = columnOf(found.node, found.page.scrolls);
      const owner = scrollIdForColumn(found.page, col);
      throw new BridgeCommandError(
        'BAD_PARAMS',
        `"after" block "${anchor.after}" is not in scroll "${scrollId}" ` +
          `(it sits in ${owner ? `scroll "${owner}"` : `column ${col}`}). ` +
          'Pass a block from that scroll, or use index.',
      );
    }
  }

  navigateToPage(section.id, page.id);

  const live = livePageLike(page);
  const node = createBlockNode(markdown, live.nodes as CanvasNode[], scroll.column, live.scrolls);
  const plan = insertBlockAt(
    live,
    scrollId,
    'after' in anchor ? anchor.after : anchor.index,
    node,
    liveCeiling(),
  );
  if (!plan.ok) throwReflow(plan);

  node.x = plan.x;
  node.y = plan.y;
  const nextNodes = [...applyDisplacements(live.nodes, plan.displaced), node];
  applyFlowInOneUndo(nextNodes, applyStrokeDisplacements(live.strokes ?? [], plan.displaced));
  flush();

  return {
    ...toBlockSummary(node, { scrolls: live.scrolls as import('../types/data').ScrollRecord[] }),
    displacedCount: plan.displaced.length,
  };
}

const DATA_IMAGE_URI = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

function presentParam(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/** App-side source: a data URI. `path` is MCP-server-only. */
function parseImageDataParam(params: Record<string, unknown>): string {
  const hasData = presentParam(params.data);
  const hasPath = presentParam(params.path);
  if (hasData && hasPath) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      'Pass data (a base64 data URI) or path, not both. path is resolved by the MCP server.',
    );
  }
  if (!hasData && !hasPath) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      'insert_image needs exactly one of data (a base64 data URI) or path (a local file the MCP server reads).',
    );
  }
  if (hasPath) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      'path is resolved by the MCP server; pass data (a data:image/...;base64, URI).',
    );
  }
  if (typeof params.data !== 'string') {
    throw new BridgeCommandError('BAD_PARAMS', '"data" must be a data:image/...;base64, URI');
  }
  if (!DATA_IMAGE_URI.test(params.data)) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      '"data" must be a data:image/...;base64, URI',
    );
  }
  return params.data;
}

function dataUriToBlob(data: string): Blob {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]*)$/.exec(data);
  if (!match) {
    throw new BridgeCommandError('BAD_PARAMS', '"data" must be a data:image/...;base64, URI');
  }
  let binary: string;
  try {
    binary = atob(match[2]);
  } catch {
    throw new BridgeCommandError('BAD_PARAMS', 'Could not decode image data URI (invalid base64)');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

async function embedFromDataUri(data: string): Promise<ImageEmbed> {
  let blob: Blob;
  try {
    blob = dataUriToBlob(data);
  } catch (err) {
    if (err instanceof BridgeCommandError) throw err;
    throw new BridgeCommandError(
      'BAD_PARAMS',
      err instanceof Error ? err.message : 'Could not decode image data URI',
    );
  }
  try {
    return await embedImage(blob);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Could not decode image';
    throw new BridgeCommandError('BAD_PARAMS', reason);
  }
}

async function insertImage(params: Record<string, unknown>): Promise<InsertImageResult> {
  flush();
  const data = parseImageDataParam(params);
  const scrollId = requireString(params, 'scrollId');
  const anchor = parseBlockAnchor(params, 'insert_image');
  const alt = optionalString(params, 'alt') || 'image';
  const mini = optionalBool(params, 'mini');

  const located = locateScroll(scrollId);
  if (!located) {
    throw new BridgeCommandError('NOT_FOUND', missingScrollMessage(scrollId));
  }
  const { section, page, scroll } = located;

  if ('after' in anchor) {
    const found = findNodeInNotebook(anchor.after);
    if (!found) {
      throw new BridgeCommandError('NOT_FOUND', `No block with id "${anchor.after}"`);
    }
    const liveCheck = livePageLike(page);
    if (
      found.page.id !== page.id ||
      !isFlowItem(found.node, diagramFrameIds(found.page.nodes), !!liveCheck.columnFlow) ||
      columnOf(found.node, found.page.scrolls) !== scroll.column
    ) {
      const col = columnOf(found.node, found.page.scrolls);
      const owner = scrollIdForColumn(found.page, col);
      throw new BridgeCommandError(
        'BAD_PARAMS',
        `"after" block "${anchor.after}" is not in scroll "${scrollId}" ` +
          `(it sits in ${owner ? `scroll "${owner}"` : `column ${col}`}). ` +
          'Pass a block from that scroll, or use index.',
      );
    }
  }

  // Embed before any store write so a decode failure adds nothing and has no undo.
  const embed = await embedFromDataUri(data);

  navigateToPage(section.id, page.id);

  const live = livePageLike(page);
  const node = imageNodeFromEmbed(embed, { x: 0, y: 0, alt });
  if (mini) {
    const patch = imageMiniTogglePatch(node);
    if (patch) {
      if (patch.width !== undefined) node.width = patch.width;
      if (patch.height !== undefined) node.height = patch.height;
      if (patch.data) node.data = patch.data;
    }
  }

  const plan = insertBlockAt(
    live,
    scrollId,
    'after' in anchor ? anchor.after : anchor.index,
    node,
    liveCeiling(),
  );
  if (!plan.ok) throwReflow(plan);

  node.x = plan.x;
  node.y = plan.y;
  const nextNodes = [...applyDisplacements(live.nodes, plan.displaced), node];
  applyFlowInOneUndo(nextNodes, applyStrokeDisplacements(live.strokes ?? [], plan.displaced));
  flush();

  const image = node.data as ImageNodeData;
  return {
    id: node.id,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    mini: !!image.mini,
    displacedCount: plan.displaced.length,
  };
}

/**
 * Internal: return the data URI so the MCP server can write a local file.
 * The agent never sees this payload — the server strips `src` after decode.
 * This frame is allowed to exceed READ_PAGE_RESPONSE_BUDGET (no ws frame cap
 * below the `ws` 100 MiB default; images are already long-edge capped).
 */
function readImage(params: Record<string, unknown>): ReadImageResult {
  flush();
  const id = requireString(params, 'id');
  const found = findNodeInNotebook(id);
  if (!found) {
    throw new BridgeCommandError('NOT_FOUND', `No image with id "${id}"`);
  }
  if (found.node.type !== 'image') {
    throw new BridgeCommandError(
      'UNSUPPORTED',
      `"${id}" is a ${found.node.type} node, not an image.`,
    );
  }
  const data = found.node.data as ImageNodeData;
  const src = typeof data.src === 'string' ? data.src : '';
  if (!src.startsWith('data:image/')) {
    throw new BridgeCommandError(
      'PRECONDITION',
      `"${id}" has no embedded image payload.`,
    );
  }
  return {
    id: found.node.id,
    src,
    format: dataUriImageFormat(src),
    bytes: dataUriDecodedBytes(src),
    naturalWidth: data.naturalWidth,
    naturalHeight: data.naturalHeight,
    alt: typeof data.alt === 'string' ? data.alt : '',
  };
}

async function moveBlock(params: Record<string, unknown>): Promise<MoveBlockResult> {
  flush();
  const blockId = requireString(params, 'blockId');
  const destScrollId = optionalString(params, 'scrollId');
  const anchor = parseBlockAnchor(params, 'move_block');

  const found = findNodeInNotebook(blockId);
  if (!found) {
    throw new BridgeCommandError('NOT_FOUND', `No block with id "${blockId}"`);
  }
  const preview = livePageLike(found.page);
  const owner = owningDiagramFrame(found.page.nodes, found.node);
  if (owner) refuseDiagramMember(found.node, owner, 'move');
  if (found.node.type !== 'text' && found.node.type !== 'diagram') {
    refuseNonContentBlock(found.node, found.page.nodes, 'move');
  }
  if (!isFlowItem(found.node, diagramFrameIds(found.page.nodes), !!preview.columnFlow)) {
    refuseNonContentBlock(found.node, found.page.nodes, 'move');
  }

  if (destScrollId) {
    const dest = locateScroll(destScrollId);
    if (!dest) {
      throw new BridgeCommandError('NOT_FOUND', missingScrollMessage(destScrollId));
    }
    if (dest.page.id !== found.page.id) {
      throw new BridgeCommandError(
        'BAD_PARAMS',
        `Scroll "${destScrollId}" is not on the same page as block "${blockId}". ` +
          'move_block stays on one page; pass a scroll from list_scrolls for that page.',
      );
    }
  }

  navigateToPage(found.section.id, found.page.id);

  const live = livePageLike(found.page);
  const dest = {
    scrollId: destScrollId,
    ...('after' in anchor ? { after: anchor.after } : { index: anchor.index }),
  };
  const plan = planMoveBlock(live, blockId, dest, liveCeiling());
  if (!plan.ok) throwReflow(plan);

  applyFlowInOneUndo(plan.nextNodes, plan.nextStrokes);
  flush();

  const moved = useCanvasStore.getState().nodes.find((n) => n.id === blockId)!;
  return {
    ...toBlockSummary(moved, { scrolls: live.scrolls as import('../types/data').ScrollRecord[] }),
    displacedCount: plan.displaced.length,
  };
}

// ── Scrolls ─────────────────────────────────────────────────

function listScrolls(params: Record<string, unknown>): ListScrollsResult {
  flush();
  const { section, page } = resolvePage(optionalString(params, 'pageId'));
  return {
    sectionId: section.id,
    pageId: page.id,
    pageTitle: page.title,
    scrolls: summariseScrolls(page),
  };
}

function createScrollCmd(params: Record<string, unknown>): CreateScrollResult {
  flush();
  const title = requireString(params, 'title');
  const { section, page } = resolvePage(optionalString(params, 'pageId'));

  if (useWorkspaceStore.getState().activePageId === page.id) useHistoryStore.getState().record();
  const record = useWorkspaceStore.getState().createScroll(page.id, title);
  if (!record) {
    throw new BridgeCommandError('INTERNAL', `Could not create a scroll on page "${page.id}"`);
  }

  return {
    sectionId: section.id,
    pageId: page.id,
    scrollId: record.id,
    title: record.title,
    column: record.column,
  };
}

function renameScrollCmd(params: Record<string, unknown>): RenameScrollResult {
  flush();
  const scrollId = requireString(params, 'scrollId');
  // Empty is valid: it untitleds the scroll (header goes, ceiling disarms).
  const rawTitle = optionalString(params, 'title');
  if (rawTitle === undefined) {
    throw new BridgeCommandError('BAD_PARAMS', '"title" must be a string');
  }
  const title = rawTitle.trim();

  const { workspace } = useWorkspaceStore.getState();
  for (const section of workspace.sections) {
    for (const page of section.pages) {
      const scroll = scrollById(page.scrolls, scrollId);
      if (!scroll) continue;
      if (useWorkspaceStore.getState().activePageId === page.id) useHistoryStore.getState().record();
      useWorkspaceStore.getState().renameScroll(page.id, scrollId, title);
      return { scrollId, title, previousTitle: scroll.title };
    }
  }

  throw new BridgeCommandError(
    'NOT_FOUND',
    `No scroll with id "${scrollId}" in this notebook. Call list_scrolls to refresh.`,
  );
}

function parseMoveScrollSpec(
  params: Record<string, unknown>,
): { direction: 'left' | 'right' } | { toColumn: number } {
  const hasDirection = params.direction !== undefined && params.direction !== null;
  const hasColumn = params.toColumn !== undefined && params.toColumn !== null;
  if (hasDirection && hasColumn) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      'Pass direction ("left" | "right") or toColumn, not both.',
    );
  }
  if (hasColumn) {
    const value = params.toColumn;
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new BridgeCommandError('BAD_PARAMS', '"toColumn" must be an integer');
    }
    return { toColumn: value };
  }
  if (hasDirection) {
    const value = params.direction;
    if (value !== 'left' && value !== 'right') {
      throw new BridgeCommandError(
        'BAD_PARAMS',
        '"direction" must be "left" or "right"',
      );
    }
    return { direction: value };
  }
  throw new BridgeCommandError(
    'BAD_PARAMS',
    'move_scroll needs direction ("left" | "right") or toColumn.',
  );
}

async function moveScrollCmd(params: Record<string, unknown>): Promise<MoveScrollResult> {
  flush();
  const scrollId = requireString(params, 'scrollId');
  const spec = parseMoveScrollSpec(params);

  const { workspace } = useWorkspaceStore.getState();
  for (const section of workspace.sections) {
    for (const page of section.pages) {
      const scroll = scrollById(page.scrolls, scrollId);
      if (!scroll) continue;

      const { moveScroll } = await import('../utils/scrollOps');
      const result = moveScroll(page.id, scrollId, spec);
      if (!result.ok) {
        throw new BridgeCommandError(result.code, result.message);
      }
      return {
        scrollId: result.scrollId,
        title: result.title,
        fromColumn: result.fromColumn,
        toColumn: result.toColumn,
      };
    }
  }

  throw new BridgeCommandError(
    'NOT_FOUND',
    `No scroll with id "${scrollId}" in this notebook. Call list_scrolls to refresh.`,
  );
}

async function resizeScrollCmd(params: Record<string, unknown>): Promise<ResizeScrollResult> {
  flush();
  const scrollId = requireString(params, 'scrollId');
  const requestedWidth = params.width;
  if (typeof requestedWidth !== 'number' || !Number.isFinite(requestedWidth)) {
    throw new BridgeCommandError('BAD_PARAMS', '"width" must be a finite number');
  }

  const { workspace } = useWorkspaceStore.getState();
  for (const section of workspace.sections) {
    for (const page of section.pages) {
      const scroll = scrollById(page.scrolls, scrollId);
      if (!scroll) continue;

      navigateToPage(section.id, page.id);
      const { resizeScroll } = await import('../utils/scrollOps');
      const result = resizeScroll(page.id, scrollId, requestedWidth);
      const activePage = useWorkspaceStore.getState().getActivePage();
      const liveScroll = activePage?.scrolls?.find((item) => item.id === scrollId);
      if (!activePage || !liveScroll) {
        throw new BridgeCommandError('INTERNAL', `Could not resize scroll "${scrollId}"`);
      }
      return {
        scrollId,
        title: liveScroll.title,
        requestedWidth,
        width: result?.width ?? columnWidth(liveScroll.column, activePage.scrolls),
        delta: result?.delta ?? 0,
      };
    }
  }

  throw new BridgeCommandError(
    'NOT_FOUND',
    `No scroll with id "${scrollId}" in this notebook. Call list_scrolls to refresh.`,
  );
}

async function updateBlock(params: Record<string, unknown>): Promise<UpdateBlockResult> {
  flush();
  const blockId = requireString(params, 'blockId');
  const markdown = requireString(params, 'markdown');

  const found = findNodeInNotebook(blockId);
  if (!found) {
    throw new BridgeCommandError('NOT_FOUND', `No block with id "${blockId}"`);
  }
  const owner = owningDiagramFrame(found.page.nodes, found.node);
  if (owner) refuseDiagramMember(found.node, owner, 'update');
  if (found.node.type !== 'text') {
    throw new BridgeCommandError(
      'UNSUPPORTED',
      `Block "${blockId}" is a ${found.node.type} node; only text blocks are editable over the bridge`,
    );
  }

  navigateToPage(found.section.id, found.page.id);

  const previous = found.node.data as TextNodeData;
  const updated: TextNodeData = { ...previous, text: markdown };
  const newHeight = blockHeight(markdown, found.node.width || A4_WIDTH, updated);
  const live = livePageLike(found.page);
  const plan = planHeightChange(live, blockId, newHeight);
  if (!plan.ok) throwReflow(plan);

  const nextNodes = plan.nextNodes.map((n) =>
    n.id === blockId ? { ...n, data: updated, height: newHeight } : n,
  );
  applyFlowInOneUndo(nextNodes, plan.nextStrokes);
  flush();

  return { blockId, displacedCount: plan.displaced.length };
}

// ── Deletes ─────────────────────────────────────────────────

/**
 * Every delete verb demands `confirm: true`.
 *
 * The bridge has no undo an agent can reach, so a mistaken delete is final for
 * anything not yet saved elsewhere. The flag makes destruction an explicit act
 * rather than something a model can do by getting one argument wrong — the same
 * guard `run_update` uses.
 */
function requireConfirm(params: Record<string, unknown>, what: string): void {
  if (params.confirm !== true) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      `Deleting ${what} cannot be undone from the bridge. Pass confirm:true once the user has agreed.`,
    );
  }
}

function deletePageCmd(params: Record<string, unknown>): DeleteResult {
  flush();
  requireConfirm(params, 'a page');
  const { section, page } = resolvePage(optionalString(params, 'pageId'));

  // The store silently refuses to empty a section; say why rather than
  // reporting a success that did not happen.
  if (section.pages.length <= 1) {
    throw new BridgeCommandError(
      'PRECONDITION',
      `"${page.title}" is the only page in "${section.title}". Every section must keep at least ` +
        'one page — create another there first, or delete the section instead.',
    );
  }

  const wasActive = useWorkspaceStore.getState().activePageId === page.id;
  useWorkspaceStore.getState().deletePage(section.id, page.id);

  // deletePage moves activePageId but cannot touch the canvas store, so the
  // deleted page's blocks would otherwise stay on screen and be flushed back
  // onto whichever page became active.
  if (wasActive) {
    const ws = useWorkspaceStore.getState();
    const nowActive = ws.workspace.sections
      .find((s) => s.id === ws.activeSectionId)
      ?.pages.find((p) => p.id === ws.activePageId);
    useCanvasStore.getState().loadPageNodes(nowActive?.nodes ?? []);
    useDrawStore.getState().loadPageStrokes(nowActive?.strokes ?? []);
  }

  return { deleted: 'page', id: page.id, title: page.title };
}

function deleteSectionCmd(params: Record<string, unknown>): DeleteResult {
  flush();
  requireConfirm(params, 'a section and every page in it');
  const sectionId = requireString(params, 'sectionId');

  const ws = useWorkspaceStore.getState();
  const section = ws.workspace.sections.find((s) => s.id === sectionId);
  if (!section) {
    throw new BridgeCommandError('NOT_FOUND', `No section with id "${sectionId}"`);
  }
  if (ws.workspace.sections.length <= 1) {
    throw new BridgeCommandError(
      'PRECONDITION',
      `"${section.title}" is the only section in this notebook, and a notebook must keep at least one.`,
    );
  }

  const hadActive = section.pages.some((p) => p.id === ws.activePageId);
  useWorkspaceStore.getState().deleteSection(sectionId);

  if (hadActive) {
    const next = useWorkspaceStore.getState();
    const page = next.workspace.sections
      .find((s) => s.id === next.activeSectionId)
      ?.pages.find((p) => p.id === next.activePageId);
    useCanvasStore.getState().loadPageNodes(page?.nodes ?? []);
    useDrawStore.getState().loadPageStrokes(page?.strokes ?? []);
  }

  return { deleted: 'section', id: sectionId, title: section.title };
}

/**
 * `content: delete|keep` is required when the band holds anything. There is
 * no default — keep used to be implicit, and a flip would silently destroy
 * callers that never passed the flag. `withBlocks` is the old name.
 */
function resolveScrollContent(params: Record<string, unknown>): {
  deleteContent: boolean;
  usedLegacyAlias: boolean;
} {
  const usedLegacyAlias = params.withBlocks === true || params.withBlocks === false;
  const content = params.content;
  if (content !== undefined && content !== null) {
    if (content !== 'delete' && content !== 'keep') {
      throw new BridgeCommandError(
        'BAD_PARAMS',
        '"content" must be "delete" or "keep"',
      );
    }
    return { deleteContent: content === 'delete', usedLegacyAlias };
  }
  if (params.withBlocks === true) return { deleteContent: true, usedLegacyAlias: true };
  if (params.withBlocks === false) return { deleteContent: false, usedLegacyAlias: true };
  return { deleteContent: false, usedLegacyAlias: false };
}

function hasScrollContentChoice(params: Record<string, unknown>): boolean {
  if (params.content !== undefined && params.content !== null) return true;
  return params.withBlocks === true || params.withBlocks === false;
}

function bandContentAtStake(
  scroll: ScrollRecord,
  scrolls: ScrollRecord[],
  nodes: CanvasNode[],
  strokes: Stroke[],
): { nodes: number; groupMembers: number; strokes: number } {
  const bandNodes = nodes.filter((n) => contentBelongsToScroll(n, scroll, scrolls, nodes));
  return {
    nodes: bandNodes.length,
    groupMembers: bandNodes.filter((n) => n.groupId && n.id !== n.groupId).length,
    strokes: strokes.filter((s) => strokeBelongsToScrollBand(s, scroll, scrolls, nodes)).length,
  };
}

function missingScrollContentMessage(counts: {
  nodes: number;
  groupMembers: number;
  strokes: number;
}): string {
  const nodePart =
    `${counts.nodes} node${counts.nodes === 1 ? '' : 's'}` +
    (counts.groupMembers > 0
      ? ` (${counts.groupMembers} group member${counts.groupMembers === 1 ? '' : 's'})`
      : '');
  const strokePart = `${counts.strokes} stroke${counts.strokes === 1 ? '' : 's'}`;
  return (
    `"content" is required: this scroll holds ${nodePart} and ${strokePart}. ` +
    'Pass content:"delete" to remove them with the band, or content:"keep" to close the gap and leave them where they are. ' +
    'There is no default (the old default was keep).'
  );
}

async function deleteScrollCmd(params: Record<string, unknown>): Promise<DeleteResult> {
  flush();
  const scrollId = requireString(params, 'scrollId');

  const { workspace } = useWorkspaceStore.getState();
  for (const section of workspace.sections) {
    for (const page of section.pages) {
      const scroll = scrollById(page.scrolls, scrollId);
      if (!scroll) continue;

      if ((page.scrolls ?? []).length <= 1) {
        throw new BridgeCommandError(
          'PRECONDITION',
          `"${scroll.title || scrollId}" is the only scroll on "${page.title}". ` +
            'A plain page is one untitled scroll — untitle it instead of deleting the last one.',
        );
      }

      const scrolls = page.scrolls ?? [];
      const atStake = bandContentAtStake(scroll, scrolls, page.nodes, page.strokes ?? []);
      const bandHasContent = atStake.nodes > 0 || atStake.strokes > 0;
      if (bandHasContent && !hasScrollContentChoice(params)) {
        throw new BridgeCommandError('BAD_PARAMS', missingScrollContentMessage(atStake));
      }

      const { deleteContent, usedLegacyAlias } = resolveScrollContent(params);
      requireConfirm(params, deleteContent ? 'a scroll and its content' : 'a scroll');

      const blocksRemoved = deleteContent ? atStake.nodes : 0;

      const { deleteScroll } = await import('../utils/scrollOps');
      deleteScroll(page.id, scrollId, deleteContent);

      return {
        deleted: 'scroll',
        id: scrollId,
        title: scroll.title,
        blocksRemoved,
        ...(usedLegacyAlias
          ? {
              notice:
                'withBlocks is deprecated; use content:"delete" or content:"keep".',
            }
          : {}),
      };
    }
  }

  throw new BridgeCommandError(
    'NOT_FOUND',
    `No scroll with id "${scrollId}" in this notebook. Call list_scrolls to refresh.`,
  );
}

function deleteDiagramCmd(params: Record<string, unknown>): DeleteDiagramResult {
  flush();
  requireConfirm(params, 'a diagram and everything inside it');
  const diagramId = requireString(params, 'diagramId');

  const { workspace } = useWorkspaceStore.getState();
  for (const section of workspace.sections) {
    for (const page of section.pages) {
      const node = page.nodes.find((n) => n.id === diagramId);
      if (!node) continue;

      if (node.type !== 'diagram') {
        throw new BridgeCommandError(
          'UNSUPPORTED',
          `"${diagramId}" is a ${node.type} node, not a diagram. Use delete_block to remove it.`,
        );
      }

      navigateToPage(section.id, page.id);
      const live = livePageLike(page);
      const members = diagramMembers(useCanvasStore.getState().nodes, diagramId);
      const groupStrokes = useDrawStore.getState().strokes.filter((s) => s.groupId === diagramId);
      const closed = removeBlockGap(live, diagramId);
      useHistoryStore.getState().batchStart();
      useHistoryStore.getState().record();
      if (closed.ok) {
        useCanvasStore.setState({ nodes: applyDisplacements(live.nodes, closed.displaced) });
        useDrawStore.setState({
          strokes: applyStrokeDisplacements(live.strokes ?? [], closed.displaced),
        });
        useWorkspaceStore.getState().markDirty();
      }
      useCanvasStore.getState().deleteNode(diagramId);
      useHistoryStore.getState().batchEnd();
      flush();

      return { deletedMembers: members.length, deletedStrokes: groupStrokes.length };
    }
  }

  throw new BridgeCommandError('NOT_FOUND', `No diagram with id "${diagramId}"`);
}

function deleteBlockCmd(params: Record<string, unknown>): DeleteResult {
  flush();
  requireConfirm(params, 'a block');
  const blockId = requireString(params, 'blockId');

  const found = findNodeInNotebook(blockId);
  if (!found) {
    throw new BridgeCommandError('NOT_FOUND', `No block with id "${blockId}"`);
  }
  const owner = owningDiagramFrame(found.page.nodes, found.node);
  if (owner) refuseDiagramMember(found.node, owner, 'delete');

  navigateToPage(found.section.id, found.page.id);
  const live = livePageLike(found.page);
  if (live.columnFlow && isFlowItem(found.node, diagramFrameIds(found.page.nodes), true)) {
    const closed = removeBlockGap(live, blockId);
    if (closed.ok) {
      useHistoryStore.getState().batchStart();
      useHistoryStore.getState().record();
      useCanvasStore.setState({ nodes: applyDisplacements(live.nodes, closed.displaced) });
      useDrawStore.setState({
        strokes: applyStrokeDisplacements(live.strokes ?? [], closed.displaced),
      });
      useWorkspaceStore.getState().markDirty();
      useCanvasStore.getState().deleteNode(blockId);
      useHistoryStore.getState().batchEnd();
      flush();
      return { deleted: 'block', id: blockId };
    }
  }
  useCanvasStore.getState().deleteNode(blockId);
  flush();

  return { deleted: 'block', id: blockId };
}

function getBlockCmd(params: Record<string, unknown>): GetBlockResult {
  flush();
  const blockId = requireString(params, 'blockId');
  const found = findNodeInNotebook(blockId);
  if (!found || !isContentBlock(found.node, diagramFrameIds(found.page.nodes))) {
    throw new BridgeCommandError('NOT_FOUND', `No block with id "${blockId}"`);
  }
  const fullMarkdown = (found.node.data as TextNodeData).text;

  // Substring paging: the budget truncates a CALL, never strands content. A
  // block larger than the whole budget is read in slices via offset, so the
  // tail of a giant block stays reachable through the bridge.
  const offsetRaw = params.offset;
  const offset =
    offsetRaw === undefined ? 0 : typeof offsetRaw === 'number' && Number.isInteger(offsetRaw) && offsetRaw >= 0
      ? offsetRaw
      : (() => {
          throw new BridgeCommandError('BAD_PARAMS', '"offset" must be a non-negative integer');
        })();
  if (offset > fullMarkdown.length) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      `"offset" ${offset} is past the end of the block (length ${fullMarkdown.length})`,
    );
  }

  const column = columnOf(found.node, found.page.scrolls);
  const base = {
    blockId: found.node.id,
    column,
    scrollId: scrollIdForColumn(found.page, column),
    sectionId: found.section.id,
    pageId: found.page.id,
    ...(offset > 0 ? { offset } : {}),
  };

  // The truncation fields (nextOffset, fullLength) must be INSIDE the payload
  // when it is measured — appending them after a fit put the response 19
  // characters over budget, which the invariant assertion caught in T162.
  // Serialized length ≠ slice length (escapes), so converge iteratively.
  let candidate: GetBlockResult = { ...base, markdown: fullMarkdown.slice(offset) };
  if (serializedLength(candidate) > READ_PAGE_RESPONSE_BUDGET) {
    let sliceLen = fullMarkdown.length - offset;
    for (let i = 0; i < 20; i++) {
      candidate = {
        ...base,
        markdown: fullMarkdown.slice(offset, offset + sliceLen),
        markdownTruncated: {
          fullLength: fullMarkdown.length,
          notice: markdownNotice(fullMarkdown.length, READ_PAGE_RESPONSE_BUDGET),
        },
        nextOffset: offset + sliceLen,
      };
      const over = serializedLength(candidate) - READ_PAGE_RESPONSE_BUDGET;
      if (over <= 0) break;
      // Worst case every trimmed char was an escape (2 serialized chars), so
      // each round removes at least over/2 — geometric, 20 rounds is ample.
      sliceLen = Math.max(0, sliceLen - over);
    }
  }
  assertWithinBudget(candidate, 'get_block');
  return candidate;
}

function readDiagramCmd(params: Record<string, unknown>): DiagramDetail {
  flush();
  const diagramId = requireString(params, 'diagramId');
  const found = findNodeInNotebook(diagramId);
  if (!found) {
    throw new BridgeCommandError('NOT_FOUND', `No diagram with id "${diagramId}"`);
  }
  if (found.node.type !== 'diagram') {
    throw new BridgeCommandError(
      'UNSUPPORTED',
      `"${diagramId}" is a ${found.node.type} node, not a diagram.`,
    );
  }

  const memberLimit = optionalPositiveInt(params, 'member_limit') ?? READ_DIAGRAM_DEFAULT_MEMBER_LIMIT;
  const memberCursor = optionalString(params, 'member_cursor');

  const allMembers = diagramMembers(found.page.nodes, diagramId).map((m) => ({
    id: m.id,
    type: m.type,
    x: m.x,
    y: m.y,
    w: m.width,
    h: m.height,
    ...(m.type === 'text' ? { label: (m.data as TextNodeData).text } : {}),
  }));
  const windowed = windowByCursor(
    allMembers,
    (m) => m.id,
    memberCursor,
    memberLimit,
    (c) =>
      `member_cursor "${c}" is not a member of this diagram. ` +
      'Pass the last member id from the previous read_diagram.',
  );

  const source = diagramSourceOf(found.node);
  const result: DiagramDetail = {
    id: found.node.id,
    title: diagramTitleOf(found.node),
    format: sniffFormat(source),
    source,
    bounds: {
      x: found.node.x,
      y: found.node.y,
      width: found.node.width,
      height: found.node.height,
    },
    ...(isSnapshotDiagram(found.node) ? { renderMode: 'snapshot' as const } : {}),
    memberCount: allMembers.length,
    members: windowed.items,
  };
  return applyDiagramBudget(result, windowed.more);
}

function fitDiagramCmd(params: Record<string, unknown>): FitDiagramResult {
  flush();
  const diagramId = requireString(params, 'diagramId');
  const found = findNodeInNotebook(diagramId);
  if (!found) {
    throw new BridgeCommandError('NOT_FOUND', `No diagram with id "${diagramId}"`);
  }
  if (found.node.type !== 'diagram') {
    throw new BridgeCommandError(
      'UNSUPPORTED',
      `"${diagramId}" is a ${found.node.type} node, not a diagram.`,
    );
  }

  navigateToPage(found.section.id, found.page.id);
  const outcome = fitExistingDiagram(diagramId);
  if (!outcome.ok) {
    throw new BridgeCommandError(outcome.code, outcome.message);
  }
  flush();
  return {
    diagramId,
    scale: outcome.scale,
    width: outcome.width,
    height: outcome.height,
    ...(outcome.warning ? { warning: outcome.warning } : {}),
  };
}

// ── Canvas look ─────────────────────────────────────────────

const GUIDE_STYLES: BackgroundMode[] = ['pages', 'scroll', 'grid', 'none'];

/**
 * Agent-facing colour names ↔ stored `CanvasBgColor`.
 *
 * The hex values are accepted too: an agent that has read the notebook file
 * will have seen `"#f5f5f5"`, and rejecting what we ourselves persisted would
 * be a needless trap.
 */
const COLOR_BY_NAME: Record<string, CanvasBgColor> = {
  white: '#ffffff',
  'light-gray': '#f5f5f5',
  gray: '#e5e5e5',
  paper: 'paper',
};

const NAME_BY_COLOR: Record<CanvasBgColor, string> = {
  '#ffffff': 'white',
  '#f5f5f5': 'light-gray',
  '#e5e5e5': 'gray',
  paper: 'paper',
};

/** The look a page is actually drawn with — its override over the default. */
function currentSettings(pageId?: string): WorkspaceSettings {
  const { workspace } = useWorkspaceStore.getState();
  const page = pageId
    ? workspace.sections.flatMap((s) => s.pages).find((p) => p.id === pageId)
    : useWorkspaceStore.getState().getActivePage();
  return resolvePageSettings(page, workspace);
}

function describeBackground(settings: WorkspaceSettings) {
  return { guideStyle: settings.backgroundMode, color: NAME_BY_COLOR[settings.bgColor] };
}

const BACKGROUND_SCOPES = ['notebook', 'page'];

function readScope(params: Record<string, unknown>): 'notebook' | 'page' {
  const scope = optionalString(params, 'scope');
  if (scope === undefined) return 'notebook';
  if (!BACKGROUND_SCOPES.includes(scope)) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      `"${scope}" is not a scope. Valid values: ${BACKGROUND_SCOPES.join(', ')}.`,
    );
  }
  return scope as 'notebook' | 'page';
}

/**
 * Reports the EFFECTIVE look of a page plus where each value came from.
 *
 * Resolving rather than reading the notebook default straight off is what makes
 * the answer match the screen; `notebookDefault` and `source` are additive, so
 * an agent that only reads `guideStyle`/`color` is unaffected.
 */
function getBackground(params: Record<string, unknown>): BackgroundResult {
  const { workspace } = useWorkspaceStore.getState();
  const { page } = resolvePage(optionalString(params, 'pageId'));
  const resolved = resolvePageSettings(page, workspace);

  return {
    ...describeBackground(resolved),
    source: { guideStyle: resolved.source.backgroundMode, color: resolved.source.bgColor },
    notebookDefault: describeBackground(notebookSettings(workspace)),
    pageId: page.id,
  };
}

function setBackground(params: Record<string, unknown>): BackgroundResult {
  flush();
  // Notebook by default. `set_background` shipped meaning notebook-wide, and
  // quietly re-pointing it at the current page would change what every agent
  // already written against it does.
  const scope = readScope(params);
  const { section, page } = resolvePage(optionalString(params, 'pageId'));
  const previous = describeBackground(currentSettings(page.id));
  const updates: Partial<WorkspaceSettings> = {};

  const guideStyle = optionalString(params, 'guideStyle');
  if (guideStyle !== undefined) {
    if (!GUIDE_STYLES.includes(guideStyle as BackgroundMode)) {
      throw new BridgeCommandError(
        'BAD_PARAMS',
        `"${guideStyle}" is not a guide style. Valid values: ${GUIDE_STYLES.join(', ')}.`,
      );
    }
    updates.backgroundMode = guideStyle as BackgroundMode;
  }

  const color = optionalString(params, 'color');
  if (color !== undefined) {
    const resolved =
      COLOR_BY_NAME[color] ??
      (color in NAME_BY_COLOR ? (color as CanvasBgColor) : undefined);
    if (!resolved) {
      throw new BridgeCommandError(
        'BAD_PARAMS',
        `"${color}" is not a background colour. Valid values: ` +
          `${Object.keys(COLOR_BY_NAME).join(', ')}.`,
      );
    }
    updates.bgColor = resolved;
  }

  // Both optional individually, but a call that changes nothing is a mistake
  // worth surfacing rather than a successful no-op.
  if (Object.keys(updates).length === 0) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      'Pass at least one of "guideStyle" or "color".',
    );
  }

  // Either action marks the notebook dirty, so the normal auto-save pipeline
  // persists this exactly like a change made from the settings panel.
  if (scope === 'page') {
    useWorkspaceStore.getState().updatePageSettings(updates, {
      sectionId: section.id,
      pageId: page.id,
    });
  } else {
    useWorkspaceStore.getState().updateSettings(updates);
  }

  const { workspace } = useWorkspaceStore.getState();
  const after = resolvePageSettings(
    workspace.sections.flatMap((s) => s.pages).find((p) => p.id === page.id),
    workspace,
  );

  return {
    ...describeBackground(after),
    source: { guideStyle: after.source.backgroundMode, color: after.source.bgColor },
    notebookDefault: describeBackground(notebookSettings(workspace)),
    pageId: page.id,
    scope,
    previous,
  };
}

// ── Notebook management ─────────────────────────────────────

function renamePage(params: Record<string, unknown>): RenamePageResult {
  flush();
  const title = requireString(params, 'title');
  const { section, page } = resolvePage(optionalString(params, 'pageId'));
  const previousTitle = page.title;
  const updateHeading = params.updateHeading !== false;

  useWorkspaceStore.getState().renamePage(section.id, page.id, title);

  // The sidebar title and the canvas H1 are separate pieces of state, so a
  // rename would leave them disagreeing. Only rewrite a heading that still
  // matches the old title — a hand-edited one is the user's, not ours.
  let headingBlockId: string | undefined;
  if (updateHeading) {
    const heading = orderedTextNodes(page.nodes)[0];
    const headingText = heading && (heading.data as TextNodeData).text.trim();
    if (heading && headingText === `# ${previousTitle}`) {
      navigateToPage(section.id, page.id);
      const previous = heading.data as TextNodeData;
      const updated: TextNodeData = { ...previous, text: `# ${title}` };
      useCanvasStore.getState().updateNode(heading.id, {
        data: updated,
        height: blockHeight(updated.text, heading.width || A4_WIDTH, updated),
      });
      headingBlockId = heading.id;
    }
  }
  flush();

  return { sectionId: section.id, pageId: page.id, title, previousTitle, headingBlockId };
}

function movePage(params: Record<string, unknown>): MovePageResult {
  flush();
  const toSectionId = requireString(params, 'toSectionId');
  const { section: from, page } = resolvePage(optionalString(params, 'pageId'));

  const ws = useWorkspaceStore.getState();
  const target = ws.workspace.sections.find((s) => s.id === toSectionId);
  if (!target) {
    throw new BridgeCommandError('NOT_FOUND', `No section with id "${toSectionId}"`);
  }
  if (from.id === toSectionId) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      `Page "${page.id}" is already in section "${toSectionId}"`,
    );
  }
  // The store refuses to empty a section, so say why rather than no-op silently.
  if (from.pages.length <= 1) {
    throw new BridgeCommandError(
      'PRECONDITION',
      `"${from.title}" would be left with no pages. Every section must keep at least one — ` +
        'create another page there first, or move a different page.',
    );
  }

  const rawIndex = params.toIndex;
  if (rawIndex !== undefined && rawIndex !== null) {
    if (typeof rawIndex !== 'number' || !Number.isInteger(rawIndex) || rawIndex < 0) {
      throw new BridgeCommandError('BAD_PARAMS', '"toIndex" must be a non-negative integer');
    }
  }
  const index = Math.min(
    typeof rawIndex === 'number' ? rawIndex : target.pages.length,
    target.pages.length,
  );

  useWorkspaceStore.getState().movePageToSection(page.id, from.id, toSectionId, index);
  flush();

  return {
    pageId: page.id,
    title: page.title,
    fromSectionId: from.id,
    toSectionId,
    index,
  };
}

async function renameNotebook(
  params: Record<string, unknown>,
): Promise<RenameNotebookResult> {
  flush();
  const filename = requireString(params, 'filename');
  const previousFilename = useWorkspaceStore.getState().workspace.filename;

  useWorkspaceStore.getState().updateWorkspace({ filename });
  useWorkspaceStore.getState().markDirty();

  // Renaming inside the app does not rename the file on disk — the FSA handle
  // keeps whatever name it was opened under. Report it so the agent can say so.
  let boundFilename: string | undefined;
  if (isFSASupported()) {
    const handle = await getCurrentHandle();
    boundFilename = handle?.name;
  }

  return { filename, previousFilename, boundFilename };
}

async function saveNotebookCmd(): Promise<SaveNotebookResult> {
  flush();
  const { saveNotebook } = await import('../utils/saveNotebook');
  const outcome = await saveNotebook(false, { existingFileOnly: true });

  if (!outcome.ok) {
    if (outcome.reason === 'busy') {
      throw new BridgeCommandError('PRECONDITION', 'A save is already in progress');
    }
    if (outcome.reason === 'no-bound-file') {
      throw new BridgeCommandError(
        'PRECONDITION',
        'This notebook is not bound to a file on disk, so there is nothing to overwrite. ' +
          'The Save As picker needs a user gesture the bridge cannot provide — ask the user ' +
          'to save once from the app, then this command will work.',
      );
    }
    throw new BridgeCommandError('INTERNAL', `Save failed (${outcome.reason})`);
  }

  return {
    filename: useWorkspaceStore.getState().workspace.filename,
    savedTo: outcome.savedTo,
    saveRevision: outcome.revision,
  };
}

// ── App updates ─────────────────────────────────────────────

async function checkUpdate(): Promise<CheckUpdateResult> {
  const info = await checkForUpdate(APP_VERSION, { force: true });

  // checkForUpdate returns null for offline / CORS / rate-limit. That is not
  // the same as "up to date", and conflating them would have the agent report
  // a current version it never actually verified.
  if (info === null) {
    return {
      currentVersion: APP_VERSION,
      available: false,
      checked: false,
      message:
        'Could not reach the GitHub releases API (offline, CORS-blocked, or rate limited). ' +
        'Update status is unknown.',
    };
  }

  if (!info.available) {
    const latest = info.latestVersion ?? APP_VERSION;
    return {
      currentVersion: APP_VERSION,
      available: false,
      checked: true,
      latestVersion: latest,
      message:
        latest === APP_VERSION
          ? `PowerScroll ${APP_VERSION} is the latest release.`
          : `Nothing to install — running ${APP_VERSION}, ahead of the latest release ${latest}.`,
    };
  }

  return {
    currentVersion: APP_VERSION,
    available: true,
    checked: true,
    latestVersion: info.latestVersion,
    releaseUrl: info.releaseUrl,
    message: `PowerScroll ${info.latestVersion} is available (running ${APP_VERSION}).`,
  };
}

async function runUpdate(params: Record<string, unknown>): Promise<RunUpdateResult> {
  if (params.confirm !== true) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      'run_update rewrites the notebook file on disk and reloads the app. ' +
        'Pass confirm:true once the user has agreed.',
    );
  }

  const info = await checkForUpdate(APP_VERSION, { force: true });
  if (info === null) {
    throw new BridgeCommandError(
      'PRECONDITION',
      'Could not reach the GitHub releases API, so there is no update to install.',
    );
  }
  if (!info.available || !info.latestVersion) {
    throw new BridgeCommandError(
      'PRECONDITION',
      `Already on the latest release (${APP_VERSION}).`,
    );
  }
  if (!info.downloadUrl) {
    throw new BridgeCommandError(
      'PRECONDITION',
      `Release ${info.latestVersion} has no PowerScroll.html compatibility asset to install.`,
    );
  }

  // Persist first: performUpdate injects the in-memory workspace into the new
  // template, so anything unflushed would be silently dropped by the swap.
  flush();
  const workspace = useWorkspaceStore.getState().workspace;

  // The live-swap path reloads the page. Reloading synchronously would tear the
  // socket down before the response frame is flushed, so the agent would see a
  // timeout on a successful update. Defer it just past the ack.
  const result = await performUpdate(
    info.downloadUrl,
    workspace,
    APP_VERSION,
    info.latestVersion,
    { reload: () => setTimeout(() => window.location.reload(), 500) },
  );

  if (!result.ok) {
    throw new BridgeCommandError(
      'INTERNAL',
      'Update failed — could not download or write the new version. See the app console.',
    );
  }

  return {
    fromVersion: APP_VERSION,
    toVersion: info.latestVersion,
    mode: result.mode,
    reloading: result.mode === 'live-swap',
  };
}

// ── Dispatch ────────────────────────────────────────────────

type Handler = (params: Record<string, unknown>) => unknown | Promise<unknown>;


const DIAGRAM_FORMATS: DiagramSourceFormat[] = ['plantuml', 'mermaid', 'svg', 'drawio'];

/**
 * Draws a diagram onto the page as a native diagram node.
 *
 * The agent supplies semantics only — entities and relationships — and the app
 * computes every coordinate from real text metrics. What lands is ordinary
 * shape and text nodes inside a frame, so the user can drag any part of it
 * afterwards exactly like something they drew by hand.
 *
 * `format` names the language. It is optional so the pre-Mermaid callers keep
 * working by sniffing, but an agent that states it gets told when its source is
 * in the other language instead of watching it half-render.
 *
 * Diagnostics come back with the write rather than needing a second call, so a
 * clean diagram costs one round trip. A source that parses to nothing is a
 * PRECONDITION error, not a silently empty frame.
 */
async function createDiagram(params: Record<string, unknown>): Promise<CreateDiagramResult> {
  flush();
  const source = requireString(params, 'source');
  const title = optionalString(params, 'title') ?? 'Diagram';
  const declared = optionalString(params, 'format');
  if (declared !== undefined && !DIAGRAM_FORMATS.includes(declared as DiagramSourceFormat)) {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      `"${declared}" is not a diagram format. Valid values: ${DIAGRAM_FORMATS.join(', ')}.`,
    );
  }
  const format = declared as DiagramSourceFormat | undefined;
  const renderParam = optionalString(params, 'render');
  if (renderParam !== undefined && renderParam !== 'snapshot' && renderParam !== 'nodes') {
    throw new BridgeCommandError(
      'BAD_PARAMS',
      `"${renderParam}" is not a render mode. Valid values: snapshot, nodes.`,
    );
  }
  const sniffed = sniffFormat(source);
  // Stored source is always readable XML: inflate before build and before
  // writing data.source, so the redraw dialog never shows a base64 blob.
  const text =
    format === 'drawio' || sniffed === 'drawio' ? await normalizeDrawioSource(source) : source;
  const { section, page } = resolvePage(optionalString(params, 'pageId'));
  const column = resolveColumn(params, page);

  // Snapshot is the drawio default (v0.64); `render:'nodes'` is the explicit
  // escape back to transpiled members. The render happens BEFORE the placement
  // coordinates are read — it awaits the viewer, and a Y computed ahead of
  // that await could go stale against a concurrent edit.
  const wantsSnapshot =
    sniffFormat(text) === 'drawio' &&
    (format === undefined || format === 'drawio') &&
    renderParam !== 'nodes';
  let snapshotFailure: string | null = null;
  let snapshot = null as Awaited<ReturnType<typeof renderDrawioSnapshot>> | null;
  if (wantsSnapshot) {
    snapshot = await renderDrawioSnapshot(text);
    if (!snapshot.ok) snapshotFailure = snapshot.reason;
  }

  navigateToPage(section.id, page.id);

  // Placed below whatever is already in that column, like an appended block.
  const nodes = useCanvasStore.getState().nodes;
  const x = columnX(column, page.scrolls);
  const y = nextBlockY(nodes, column, page.scrolls);

  const placed =
    snapshot?.ok === true
      ? placeDiagramSnapshotOnCanvas({ x, y, source: text, title, snapshot: snapshot.snapshot })
      : placeDiagramOnCanvas({ x, y, source: text, title, format });
  if (!placed.placed) {
    throw new BridgeCommandError(
      'PRECONDITION',
      `Nothing in that source could be drawn. ${placed.diagnostics.map((d) => d.message).join(' ')}`.trim(),
    );
  }
  flush();

  const warnings = placed.warning ? [placed.warning] : [];
  if (snapshotFailure) {
    warnings.push(
      `draw.io renderer unavailable (${snapshotFailure}) — rendered with the built-in transpiler ` +
        "instead (renderMode 'nodes'). The user can install the extension in Settings → Extensions.",
    );
  }

  return {
    sectionId: section.id,
    pageId: page.id,
    diagramId: placed.frameId,
    title,
    format: format ?? sniffFormat(text),
    column,
    renderMode: placed.renderMode,
    elementCount: placed.elementCount,
    width: placed.width,
    height: placed.height,
    diagnostics: placed.diagnostics,
    warnings,
  };
}

const HANDLERS: Record<BridgeCommandName, Handler> = {
  list_pages: listPages,
  read_page: readPage,
  read_diagram: readDiagramCmd,
  read_image: readImage,
  create_section: createSection,
  create_page: createPage,
  append_block: appendBlock,
  insert_block: insertBlock,
  insert_image: insertImage,
  move_block: moveBlock,
  create_diagram: createDiagram,
  fit_diagram: fitDiagramCmd,
  get_block: getBlockCmd,
  update_block: updateBlock,
  rename_page: renamePage,
  move_page: movePage,
  list_scrolls: listScrolls,
  create_scroll: createScrollCmd,
  rename_scroll: renameScrollCmd,
  move_scroll: moveScrollCmd,
  resize_scroll: resizeScrollCmd,
  delete_page: deletePageCmd,
  delete_section: deleteSectionCmd,
  delete_scroll: deleteScrollCmd,
  delete_block: deleteBlockCmd,
  delete_diagram: deleteDiagramCmd,
  get_background: getBackground,
  set_background: setBackground,
  rename_notebook: renameNotebook,
  save_notebook: saveNotebookCmd,
  check_update: checkUpdate,
  run_update: runUpdate,
};

export async function runBridgeCommand(
  cmd: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const handler = HANDLERS[cmd as BridgeCommandName];
  if (!handler) {
    throw new BridgeCommandError('UNSUPPORTED', `Unknown command "${cmd}"`);
  }
  return await handler(params ?? {});
}
