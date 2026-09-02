/**
 * Scroll operations coordinated across the workspace and canvas stores.
 *
 * The workspace store owns scroll records, but the ACTIVE page's blocks live in
 * the canvas store — the workspace copy is stale until something flushes. Any
 * scroll op that moves blocks (delete, reorder) therefore has to bracket the
 * store call: push canvas → workspace first, then pull the rewritten nodes back
 * canvas ← workspace. Skipping either half loses the edit at the next flush.
 *
 * Rename and create touch no geometry, so they need neither.
 */

import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useCanvasStore } from '../stores/useCanvasStore';
import { useDrawStore } from '../stores/useDrawStore';
import { useHistoryStore } from '../stores/useHistoryStore';
import type { CanvasNode, ScrollRecord, Stroke } from '../types/data';
import {
  A4_WIDTH,
  MAX_SCROLL_WIDTH,
  MIN_SCROLL_WIDTH,
  columnAt,
  columnLeft,
  columnWidth,
} from './pageLayout';
import { countBandContent } from './scrolls';
import { FIT_SCROLL_PAD } from '../diagram/fitToScroll';

/** Push live canvas/draw state into the workspace. */
function flush(): void {
  const ws = useWorkspaceStore.getState();
  ws.savePageNodes(useCanvasStore.getState().nodes);
  ws.savePageStrokes(useDrawStore.getState().strokes);
}

function findPage(pageId: string) {
  const { workspace } = useWorkspaceStore.getState();
  for (const section of workspace.sections) {
    const page = section.pages.find((p) => p.id === pageId);
    if (page) return page;
  }
  return undefined;
}

/**
 * Pull rewritten nodes/strokes back onto the live canvas without
 * `loadPageNodes` — that would wipe the undo stack we just pushed.
 */
function applyLiveGeometry(pageId: string): void {
  const ws = useWorkspaceStore.getState();
  if (ws.activePageId !== pageId) return;
  const page = ws.getActivePage();
  useCanvasStore.setState({
    nodes: page?.nodes ?? [],
    selectedNodeIds: [],
  });
  useDrawStore.setState({
    strokes: page?.strokes ?? [],
    selectedStrokeIds: [],
  });
}

export function createScroll(pageId: string, title: string): ScrollRecord | null {
  if (useWorkspaceStore.getState().activePageId === pageId) useHistoryStore.getState().record();
  return useWorkspaceStore.getState().createScroll(pageId, title);
}

export function renameScroll(pageId: string, scrollId: string, title: string): void {
  if (useWorkspaceStore.getState().activePageId === pageId) useHistoryStore.getState().record();
  useWorkspaceStore.getState().renameScroll(pageId, scrollId, title);
}

/** Live band occupancy for the delete UI. Uses the canvas if this page is open. */
export function liveScrollDeleteInfo(
  pageId: string,
  scrollId: string,
): { isLast: boolean; empty: boolean } | null {
  const page = findPage(pageId);
  const scroll = page?.scrolls?.find((s) => s.id === scrollId);
  if (!page || !scroll) return null;
  const isLast = (page.scrolls ?? []).length <= 1;
  const ws = useWorkspaceStore.getState();
  const live = ws.activePageId === pageId;
  const nodes = live ? useCanvasStore.getState().nodes : page.nodes;
  const strokes = live ? useDrawStore.getState().strokes : (page.strokes ?? []);
  const counts = countBandContent(scroll, page.scrolls ?? [], nodes, strokes);
  return { isLast, empty: counts.nodes === 0 && counts.strokes === 0 };
}

export function deleteScroll(pageId: string, scrollId: string, withBlocks: boolean): void {
  flush();
  const ws = useWorkspaceStore.getState();
  const page = ws.workspace.sections
    .flatMap((s) => s.pages)
    .find((p) => p.id === pageId);
  const target = page?.scrolls?.find((s) => s.id === scrollId);
  if (!page || !target) return;
  // Match the store guard: last scroll is an append-target invariant.
  if ((page.scrolls ?? []).length <= 1) return;

  const isActive = ws.activePageId === pageId;
  if (isActive) {
    // One undo restores the band, its nodes, and its ink. Must snapshot
    // before the store write, and must not go through loadPageNodes —
    // that clears history.
    useHistoryStore.getState().batchStart();
    useHistoryStore.getState().record();
  }

  ws.deleteScroll(pageId, scrollId, withBlocks);

  if (isActive) {
    const next = useWorkspaceStore.getState().getActivePage();
    useCanvasStore.setState({
      nodes: next?.nodes ?? [],
      selectedNodeIds: [],
    });
    useDrawStore.setState({
      strokes: next?.strokes ?? [],
      selectedStrokeIds: [],
    });
    useHistoryStore.getState().batchEnd();
  }
}

/**
 * Apply a column reorder with one undo entry on the active page.
 * Returns false when the scroll is missing or already at `toIndex`.
 */
function applyScrollReorder(pageId: string, scrollId: string, toIndex: number): boolean {
  flush();
  const ws = useWorkspaceStore.getState();
  const page = findPage(pageId);
  if (!page) return false;

  const ordered = [...(page.scrolls ?? [])].sort((a, b) => a.column - b.column);
  const from = ordered.findIndex((s) => s.id === scrollId);
  if (from < 0) return false;
  const clamped = Math.max(0, Math.min(toIndex, ordered.length - 1));
  if (clamped === from) return false;

  const isActive = ws.activePageId === pageId;
  if (isActive) {
    useHistoryStore.getState().batchStart();
    useHistoryStore.getState().record();
  }

  ws.reorderScroll(pageId, scrollId, clamped);

  if (isActive) {
    applyLiveGeometry(pageId);
    useHistoryStore.getState().batchEnd();
  }
  return true;
}

export function reorderScroll(pageId: string, scrollId: string, toIndex: number): void {
  applyScrollReorder(pageId, scrollId, toIndex);
}

export type MoveScrollSpec = { direction: 'left' | 'right' } | { toColumn: number };

export type MoveScrollOk = {
  ok: true;
  scrollId: string;
  title: string;
  fromColumn: number;
  toColumn: number;
};

export type MoveScrollErr = {
  ok: false;
  code: 'NOT_FOUND' | 'PRECONDITION';
  message: string;
};

/**
 * Move a scroll to a neighbour band or an absolute column.
 *
 * Members, grouped ink and per-scroll width travel with the band
 * (`compactColumns`). One undo restores nodes, strokes, order and widths.
 */
export function moveScroll(
  pageId: string,
  scrollId: string,
  spec: MoveScrollSpec,
): MoveScrollOk | MoveScrollErr {
  const page = findPage(pageId);
  const ordered = [...(page?.scrolls ?? [])].sort((a, b) => a.column - b.column);
  const from = ordered.findIndex((s) => s.id === scrollId);
  if (!page || from < 0) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `No scroll with id "${scrollId}" in this notebook. Call list_scrolls to refresh.`,
    };
  }

  const scroll = ordered[from];
  const label = scroll.title || scrollId;
  const last = ordered.length - 1;
  let to: number;
  if ('direction' in spec) {
    to = spec.direction === 'left' ? from - 1 : from + 1;
    if (to < 0) {
      return {
        ok: false,
        code: 'PRECONDITION',
        message: `"${label}" is already at the left edge.`,
      };
    }
    if (to > last) {
      return {
        ok: false,
        code: 'PRECONDITION',
        message: `"${label}" is already at the right edge.`,
      };
    }
  } else {
    to = spec.toColumn;
    if (to === from) {
      const edge = from === 0 ? 'left' : from === last ? 'right' : 'same';
      return {
        ok: false,
        code: 'PRECONDITION',
        message:
          edge === 'same'
            ? `"${label}" is already at column ${from}.`
            : `"${label}" is already at the ${edge} edge.`,
      };
    }
    if (to < 0) {
      return {
        ok: false,
        code: 'PRECONDITION',
        message: `"${label}" cannot move past the left edge (column 0).`,
      };
    }
    if (to > last) {
      return {
        ok: false,
        code: 'PRECONDITION',
        message: `"${label}" cannot move past the right edge (column ${last}).`,
      };
    }
  }

  applyScrollReorder(pageId, scrollId, to);
  return {
    ok: true,
    scrollId,
    title: scroll.title,
    fromColumn: from,
    toColumn: to,
  };
}

function nodeBelongsToScroll(
  node: CanvasNode,
  scroll: ScrollRecord,
  scrolls: ScrollRecord[],
  nodes: CanvasNode[],
): boolean {
  if (columnAt(node.x, scrolls) === scroll.column) return true;
  if (!node.groupId) return false;
  const frame = nodes.find((n) => n.id === node.groupId);
  return !!frame && columnAt(frame.x, scrolls) === scroll.column;
}

function strokeAnchorX(stroke: Stroke): number {
  return stroke.points[0] ?? 0;
}

function strokeBelongsToScroll(
  stroke: Stroke,
  scroll: ScrollRecord,
  scrolls: ScrollRecord[],
  nodes: CanvasNode[],
): boolean {
  if (stroke.groupId) {
    const frame = nodes.find((n) => n.id === stroke.groupId);
    if (frame && columnAt(frame.x, scrolls) === scroll.column) return true;
  }
  return columnAt(strokeAnchorX(stroke), scrolls) === scroll.column;
}

function isRightOfScroll(
  columnOfOrigin: number,
  belongsHere: boolean,
  scrollColumn: number,
): boolean {
  if (belongsHere) return false;
  return columnOfOrigin > scrollColumn;
}

export interface ResizeScrollResult {
  delta: number;
  width: number;
}

/**
 * Apply one scroll width and shift every band to its right by the same delta.
 * `undefined` is the intentional reset representation: default A4 width is
 * derived, not stored. The active-page restriction keeps the canvas/workspace
 * snapshots and the single undo entry coherent.
 */
export function applyBandWidth(
  pageId: string,
  scroll: ScrollRecord,
  width: number | undefined,
): ResizeScrollResult | null {
  flush();
  const ws = useWorkspaceStore.getState();
  if (ws.activePageId !== pageId) return null;
  const page = ws.getActivePage();
  const scrolls = page?.scrolls;
  const liveScroll = scrolls?.find((s) => s.id === scroll.id);
  if (!page || !scrolls || !liveScroll) return null;

  const requested = width === undefined ? A4_WIDTH : width;
  const effectiveWidth = Math.max(MIN_SCROLL_WIDTH, Math.min(MAX_SCROLL_WIDTH, requested));
  const storedWidth = width === undefined ? undefined : effectiveWidth;
  const currentWidth = columnWidth(liveScroll.column, scrolls);
  const delta = effectiveWidth - currentWidth;
  const storedChanged = liveScroll.width !== storedWidth;
  if (Math.abs(delta) <= 0.5 && !storedChanged) return null;

  const nodes = useCanvasStore.getState().nodes;
  const strokes = useDrawStore.getState().strokes;
  useHistoryStore.getState().batchStart();
  useHistoryStore.getState().record();

  const nextNodes = nodes.map((node) => {
    if (!isRightOfScroll(
      columnAt(node.x, scrolls),
      nodeBelongsToScroll(node, liveScroll, scrolls, nodes),
      liveScroll.column,
    )) return node;
    return { ...node, x: node.x + delta };
  });
  const nextStrokes = strokes.map((stroke) => {
    if (!isRightOfScroll(
      columnAt(strokeAnchorX(stroke), scrolls),
      strokeBelongsToScroll(stroke, liveScroll, scrolls, nodes),
      liveScroll.column,
    )) return stroke;
    return {
      ...stroke,
      points: stroke.points.map((value, index) => (index % 2 === 0 ? value + delta : value)),
    };
  });
  const nextScrolls = scrolls.map((item) => {
    if (item.id !== liveScroll.id) return item;
    if (storedWidth === undefined) {
      const { width: _removed, ...reset } = item;
      return reset;
    }
    return { ...item, width: storedWidth };
  });

  useCanvasStore.setState({ nodes: nextNodes });
  useDrawStore.setState({ strokes: nextStrokes });
  ws.replacePageScrolls(pageId, nextScrolls);
  useHistoryStore.getState().batchEnd();
  return { delta, width: effectiveWidth };
}

export function resizeScroll(
  pageId: string,
  scrollId: string,
  width: number | undefined,
): ResizeScrollResult | null {
  const page = findPage(pageId);
  const scroll = page?.scrolls?.find((item) => item.id === scrollId);
  return scroll ? applyBandWidth(pageId, scroll, width) : null;
}

/**
 * Widen this scroll to its widest member + padding and shift every scroll
 * to its right (and their members) by the delta. Explicit, never automatic.
 * One undo restores the band width and the shifted members.
 *
 * Runs against the active page — the header that offers the action is only
 * drawn there, and the canvas/draw stores are the live copies.
 */
export function fitScrollToContent(pageId: string, scrollId: string): { delta: number; width: number } | null {
  flush();
  const ws = useWorkspaceStore.getState();
  if (ws.activePageId !== pageId) return null;
  const page = ws.getActivePage();
  const scrolls = page?.scrolls;
  const scroll = scrolls?.find((s) => s.id === scrollId);
  if (!page || !scrolls || !scroll) return null;

  const nodes = useCanvasStore.getState().nodes;
  const strokes = useDrawStore.getState().strokes;

  const left = columnLeft(scroll.column, scrolls);
  const currentWidth = columnWidth(scroll.column, scrolls);

  let maxRight = left;
  for (const node of nodes) {
    if (!nodeBelongsToScroll(node, scroll, scrolls, nodes)) continue;
    maxRight = Math.max(maxRight, node.x + Math.abs(node.width || 0));
  }
  for (const stroke of strokes) {
    if (!strokeBelongsToScroll(stroke, scroll, scrolls, nodes)) continue;
    for (let i = 0; i < stroke.points.length; i += 2) {
      maxRight = Math.max(maxRight, stroke.points[i]);
    }
  }

  const needed = Math.max(currentWidth, maxRight - left + FIT_SCROLL_PAD);
  if (needed - currentWidth <= 0.5) return null;
  return applyBandWidth(pageId, scroll, needed);
}
