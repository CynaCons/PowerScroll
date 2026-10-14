/**
 * Page ceiling — a derived top of the workspace, stored nowhere (v0.50).
 *
 * On a page with at least one scroll the top is y=0 by convention. The camera
 * cannot pan above it, placement lands on it rather than being refused, and
 * scroll titles rest as one aligned row at it. Pages with no scroll records
 * keep a fully infinite canvas (`null` = no clamp anywhere).
 *
 * Legacy pages with content at negative y stay reachable: the clamp adapts to
 * `min(0, topmostContentY − PAD)` instead of stranding those blocks.
 */

import { useCanvasStore } from '../stores/useCanvasStore';
import { useDrawStore } from '../stores/useDrawStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

/** Gap kept above the topmost existing content so it is not flush with the edge. */
export const CEILING_PAD = 48;

/**
 * Screen pixels reserved above a titled scroll's ceiling. This is the header
 * card strip: 8px pin inset + 44px card + 6px body gap + 6px clearance.
 * Keeping it in screen space makes the first body line visible at every zoom.
 */
export const CEILING_HEADROOM = 64;

export function pageCeiling(
  nodes: ReadonlyArray<{ y: number }>,
  strokes: ReadonlyArray<{ points: readonly number[] }>,
  scrolls: ReadonlyArray<{ title?: string }> | null | undefined,
): number | null {
  // TITLED scrolls only: every page is born with one untitled scroll record
  // (an append target for agents — see createPage in utils/defaults.ts), so
  // gating on mere presence would bound every canvas in the app. Untitled
  // scrolls draw no header, and a ceiling with nothing to align is just a
  // wall — v0.50's gate was found wrong by T01/T71 the first full-suite run.
  if (!scrolls || !scrolls.some((s) => (s.title ?? '') !== '')) return null;

  let top = Infinity;
  for (const n of nodes) {
    if (n.y < top) top = n.y;
  }
  for (const s of strokes) {
    const pts = s.points;
    for (let i = 1; i < pts.length; i += 2) {
      if (pts[i] < top) top = pts[i];
    }
  }
  if (top === Infinity) return 0;
  return Math.min(0, top - CEILING_PAD);
}

/**
 * Max legal stage.y for a canvas-space ceiling with screen-space headroom:
 * `stage.y <= CEILING_HEADROOM - ceiling * scale`.
 *
 * The ceiling is canvas-space; the stage lives in screen space. One function
 * owns this conversion so the five camera paths cannot drift apart.
 */
export function clampStageY(
  stage: { y: () => number; scaleX: () => number },
  ceiling: number | null,
): number {
  if (ceiling === null) return stage.y();
  return Math.min(
    stage.y(),
    CEILING_HEADROOM - ceiling * stage.scaleX(),
  );
}

/** Canvas-space y: content aimed above the ceiling lands ON it. */
export function clampCanvasY(y: number, ceiling: number | null): number {
  if (ceiling === null) return y;
  return Math.max(y, ceiling);
}

/** Current page's derived ceiling, read live from the stores. */
export function liveCeiling(): number | null {
  return pageCeiling(
    useCanvasStore.getState().nodes,
    useDrawStore.getState().strokes,
    useWorkspaceStore.getState().getActivePage()?.scrolls,
  );
}
