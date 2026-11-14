/**
 * View culling — only what is near the screen is drawn (v0.93).
 *
 * A page holds every scroll the user ever wrote on it, but the screen shows a
 * few blocks of one or two of them. Mounting everything made every pan move a
 * thousand DOM overlays and every store change re-render a thousand blocks.
 *
 * The rule: content is mounted when its box touches the RENDERED rect — the
 * view grown by a margin on every side. The rendered rect only moves when the
 * view gets within a guard distance of its edge, so a pan re-renders once per
 * stretch of travel rather than once per wheel tick.
 *
 * Culling never changes the document: positions, heights, selection, search and
 * agent reads all work from the stores, which always hold the whole page.
 */

import type { CanvasNode, Stroke } from '../types/data';

export interface CullRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Margin kept mounted around the view, as a fraction of the view's size. */
const MARGIN = 0.75;
/** The view may come this close to the rendered edge before it is redrawn. */
const GUARD = 0.25;
/** Margins never shrink below this many canvas units, however far zoomed in. */
const MIN_MARGIN = 400;

/** The part of the canvas the screen shows, in canvas units. */
export function viewRect(
  viewport: { x: number; y: number; scale: number },
  width: number,
  height: number,
): CullRect {
  const scale = viewport.scale || 1;
  return {
    x0: -viewport.x / scale,
    y0: -viewport.y / scale,
    x1: (width - viewport.x) / scale,
    y1: (height - viewport.y) / scale,
  };
}

function grow(rect: CullRect, fraction: number, floor: number): CullRect {
  const mx = Math.max(floor, (rect.x1 - rect.x0) * fraction);
  const my = Math.max(floor, (rect.y1 - rect.y0) * fraction);
  return { x0: rect.x0 - mx, y0: rect.y0 - my, x1: rect.x1 + mx, y1: rect.y1 + my };
}

function contains(outer: CullRect, inner: CullRect): boolean {
  return inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1;
}

/**
 * The rect to render for a view. Returns `current` itself (same reference)
 * while the view is still comfortably inside it, so callers can skip work.
 */
export function nextCullRect(current: CullRect | null, view: CullRect): CullRect {
  if (current && contains(current, grow(view, GUARD, MIN_MARGIN * GUARD))) return current;
  return grow(view, MARGIN, MIN_MARGIN);
}

/** Slack around a node's stored box: selection chrome, shadows, captions, rotation. */
const NODE_PAD = 80;

export function nodeInRect(node: CanvasNode, rect: CullRect): boolean {
  // Lines and arrows store a direction in width/height, so either may be negative.
  const w = node.width || 0;
  const h = node.height || 0;
  let x0 = Math.min(node.x, node.x + w);
  let x1 = Math.max(node.x, node.x + w);
  let y0 = Math.min(node.y, node.y + h);
  let y1 = Math.max(node.y, node.y + h);
  // A rotated box can reach as far as its diagonal from its origin.
  const rotation = (node.data as { rotation?: number } | undefined)?.rotation;
  if (rotation) {
    const reach = Math.hypot(w, h);
    x0 = node.x - reach;
    x1 = node.x + reach;
    y0 = node.y - reach;
    y1 = node.y + reach;
  }
  return x1 + NODE_PAD >= rect.x0 && x0 - NODE_PAD <= rect.x1 && y1 + NODE_PAD >= rect.y0 && y0 - NODE_PAD <= rect.y1;
}

const strokeBoxes = new WeakMap<Stroke, CullRect>();

function strokeBox(stroke: Stroke): CullRect {
  let box = strokeBoxes.get(stroke);
  if (box) return box;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const pts = stroke.points;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    if (pts[i] < x0) x0 = pts[i];
    if (pts[i] > x1) x1 = pts[i];
    if (pts[i + 1] < y0) y0 = pts[i + 1];
    if (pts[i + 1] > y1) y1 = pts[i + 1];
  }
  const pad = stroke.strokeWidth + 8;
  box = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  strokeBoxes.set(stroke, box);
  return box;
}

export function strokeInRect(stroke: Stroke, rect: CullRect): boolean {
  const box = strokeBox(stroke);
  return box.x1 >= rect.x0 && box.x0 <= rect.x1 && box.y1 >= rect.y0 && box.y0 <= rect.y1;
}

// ── Pins: blocks that must stay mounted wherever the view goes ──────────────
// A block being edited or dragged owns live state (an open editor, a Konva
// drag) that unmounting would destroy.

const pins = new Map<string, number>();

export function pinNode(id: string): void {
  pins.set(id, (pins.get(id) ?? 0) + 1);
}

export function unpinNode(id: string): void {
  const n = (pins.get(id) ?? 0) - 1;
  if (n > 0) pins.set(id, n);
  else pins.delete(id);
}

// ── Text heights ────────────────────────────────────────────────────────────
// A text block's height is whatever its rendered markdown measures, and the
// column below it is packed from that. A block may only be skipped once its
// height is known for the text and width it has NOW; otherwise it is mounted
// off screen until it has measured itself, exactly as before.

interface Measured {
  data: unknown;
  width: number;
}

const measured = new Map<string, Measured>();
const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifySoon(): void {
  if (notifyTimer !== null) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const listener of listeners) listener();
  }, 80);
}

/** Called by a text block once it has measured its rendered height. */
export function markTextMeasured(node: CanvasNode): void {
  const entry = measured.get(node.id);
  if (entry && entry.data === node.data && entry.width === node.width) return;
  measured.set(node.id, { data: node.data, width: node.width });
  notifySoon();
}

/**
 * A page arriving from a file carries the heights its blocks measured when it
 * was saved; trust them rather than mounting the whole page to ask again. A
 * block whose stored height turns out stale corrects itself when it comes
 * into view.
 */
export function trustLoadedHeights(nodes: readonly CanvasNode[]): void {
  measured.clear();
  for (const node of nodes) {
    if (node.type === 'text' && node.height > 0) {
      measured.set(node.id, { data: node.data, width: node.width });
    }
  }
}

export function onTextMeasured(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** May this node be left unmounted while it is out of view? */
export function canSkip(node: CanvasNode): boolean {
  if (pins.has(node.id)) return false;
  if (node.type !== 'text') return true;
  const entry = measured.get(node.id);
  return !!entry && entry.data === node.data && entry.width === node.width;
}
