import { useState, useCallback, useEffect, useRef } from 'react';
import type Konva from 'konva';
import { useCanvasStore } from '../stores/useCanvasStore';
import { useToolStore } from '../stores/useToolStore';
import { undoBatchEnd, undoBatchStart, useDrawStore } from '../stores/useDrawStore';
import { generateId } from '../utils/ids';
import { clampCanvasY, clampStageY, liveCeiling } from '../utils/scrollCeiling';
import type { ShapeNodeData, Stroke } from '../types/data';
import { bindingCandidate, closestPointOnOutline, fixedPointFor } from '../utils/arrowBinding';
import {
  STROKE_ERASER_SCREEN_RADIUS,
  boundsFromFlatPoints,
  boundsIntersect,
  expandBounds,
  segmentBounds,
  segmentSegmentDistance,
  type Bounds,
} from '../utils/eraserGeometry';

export interface ShapePreview {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Stylus eraser end: bit 32 of PointerEvent.buttons (S Pen, Surface pen). */
const ERASER_BUTTON = 32;

/** Set when a marquee commits so the trailing Stage click does not clear it. */
let skipNextBackgroundClick = false;

export function consumeMarqueeClickGuard(): boolean {
  if (!skipNextBackgroundClick) return false;
  skipNextBackgroundClick = false;
  return true;
}

/**
 * Touch is distrusted for this long after the last pen contact — a palm
 * stays on the glass after the pen lifts, and must not pan, pinch or draw.
 */
const PALM_COOLDOWN_MS = 500;

/**
 * Hook for all shape creation logic: draw tool (pen + eraser), shape tool
 * (click+drag), and lasso selection — driven by POINTER events (v0.42), so
 * mouse, stylus and finger all reach the tools through one pipeline.
 * Pen contacts record per-point pressure; fingers draw or pan depending on
 * the touch-draw mode; a stylus held on its eraser end erases.
 */
export function useShapeCreation(
  stageRef: React.RefObject<Konva.Stage | null>,
) {
  // Drawing state. The REFS are authoritative — a pointerup arriving in the
  // same frame as the last pointermove must commit every point, and state
  // read through a callback closure is one render behind by construction.
  // The state mirrors the refs purely so the in-progress ink paints.
  const [inProgressPoints, setInProgressPoints] = useState<number[] | null>(null);
  const [inProgressPressures, setInProgressPressures] = useState<number[] | null>(null);
  const pointsRef = useRef<number[] | null>(null);
  const pressuresRef = useRef<number[] | null>(null);
  const [eraserPos, setEraserPos] = useState<{ x: number; y: number; radius: number } | null>(null);
  const [penCursorPos, setPenCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [lassoRect, setLassoRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const isDrawing = useRef(false);
  const lassoStart = useRef<{ x: number; y: number } | null>(null);
  const erasePreviousPoint = useRef<{ x: number; y: number } | null>(null);
  const eraseBatchOpen = useRef(false);
  const strokeBounds = useRef(new Map<string, Bounds>());
  const strokeBoundsSource = useRef(new Map<string, Stroke>());

  // One pointer owns the gesture. `erase` is latched at contact so flipping
  // the stylus mid-stroke doesn't switch tools halfway through a line.
  const activePointer = useRef<{
    id: number;
    type: string;
    mode: 'draw' | 'erase' | 'shape' | 'lasso' | 'pan';
  } | null>(null);
  const panLast = useRef<{ x: number; y: number } | null>(null);
  /** Wall-clock of the last pen contact — palms linger after the pen lifts. */
  const lastPenActivity = useRef(0);

  // Shape creation state
  const [shapePreview, setShapePreview] = useState<ShapePreview | null>(null);
  const [bindingHintId, setBindingHintId] = useState<string | null>(null);
  const shapeStart = useRef<{ x: number; y: number } | null>(null);

  const getCanvasPoint = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const pos = stage.getPointerPosition();
    if (!pos) return { x: 0, y: 0 };
    return {
      x: (pos.x - stage.x()) / stage.scaleX(),
      y: clampCanvasY((pos.y - stage.y()) / stage.scaleY(), liveCeiling()),
    };
  }, [stageRef]);

  /** Client (viewport) coords → canvas coords, for coalesced pen samples. */
  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const rect = stage.container().getBoundingClientRect();
    return {
      x: (clientX - rect.left - stage.x()) / stage.scaleX(),
      y: clampCanvasY((clientY - rect.top - stage.y()) / stage.scaleY(), liveCeiling()),
    };
  }, [stageRef]);

  /** Stroke eraser: marks full strokes hit by the swept eraser capsule. */
  const eraseStrokeAlong = useCallback((start: { x: number; y: number }, end: { x: number; y: number }, restore: boolean) => {
    const strokes = useDrawStore.getState().strokes;
    const scale = useCanvasStore.getState().viewport.scale;
    const eraserBounds = segmentBounds(start, end);
    const hitIds: string[] = [];
    for (const stroke of strokes) {
      let bounds = strokeBounds.current.get(stroke.id);
      if (strokeBoundsSource.current.get(stroke.id) !== stroke || !bounds) {
        bounds = boundsFromFlatPoints(stroke.points);
        strokeBounds.current.set(stroke.id, bounds);
        strokeBoundsSource.current.set(stroke.id, stroke);
      }
      const tolerance = Math.max(
        2.25,
        STROKE_ERASER_SCREEN_RADIUS / scale + stroke.strokeWidth / 2,
      );
      if (!boundsIntersect(expandBounds(bounds, tolerance), eraserBounds)) continue;

      const points = stroke.points;
      if (points.length === 2) {
        if (segmentSegmentDistance(start, end, { x: points[0], y: points[1] }, { x: points[0], y: points[1] }) <= tolerance) {
          hitIds.push(stroke.id);
        }
        continue;
      }
      for (let i = 0; i + 3 < points.length; i += 2) {
        if (segmentSegmentDistance(
          start,
          end,
          { x: points[i], y: points[i + 1] },
          { x: points[i + 2], y: points[i + 3] },
        ) <= tolerance) {
          hitIds.push(stroke.id);
          break;
        }
      }
    }
    const draw = useDrawStore.getState();
    if (restore) draw.unmarkPendingErase(hitIds);
    else draw.markPendingErase(hitIds);
  }, []);

  /**
   * Zone eraser: precise pixel-level erasing using circle-segment intersection.
   * Only the visual pixels under the eraser circle are removed.
   * Strokes are split at exact intersection points with the eraser boundary.
   * A pressure stroke's pressures are carried through the split (interpolated
   * at the cut), so the surviving pieces keep their varying width.
   */
  const eraseZoneAt = useCallback((ex: number, ey: number, radius: number) => {
    const store = useDrawStore.getState();
    const strokes = store.strokes;
    const r2 = radius * radius;
    const toDelete: string[] = [];
    const toAdd: Stroke[] = [];

    // Lerp helper
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    // Find t values where segment P1->P2 intersects circle (ex,ey,r)
    // Returns sorted t values in [0,1] where the segment crosses the boundary
    function circleSegmentIntersections(
      x1: number, y1: number, x2: number, y2: number,
    ): number[] {
      const dx = x2 - x1, dy = y2 - y1;
      const fx = x1 - ex, fy = y1 - ey;
      const a = dx * dx + dy * dy;
      if (a < 1e-10) return []; // degenerate segment
      const b = 2 * (fx * dx + fy * dy);
      const c = fx * fx + fy * fy - r2;
      const disc = b * b - 4 * a * c;
      if (disc < 0) return [];
      const sqrtDisc = Math.sqrt(disc);
      const t1 = (-b - sqrtDisc) / (2 * a);
      const t2 = (-b + sqrtDisc) / (2 * a);
      const results: number[] = [];
      if (t1 > 1e-6 && t1 < 1 - 1e-6) results.push(t1);
      if (t2 > 1e-6 && t2 < 1 - 1e-6) results.push(t2);
      return results.sort((a, b) => a - b);
    }

    // Is a point inside the eraser circle?
    function isInside(px: number, py: number) {
      const dx = px - ex, dy = py - ey;
      return dx * dx + dy * dy <= r2;
    }

    for (const stroke of strokes) {
      const pts = stroke.points;
      if (pts.length < 4) continue;
      const prs =
        stroke.pressures && stroke.pressures.length * 2 === pts.length
          ? stroke.pressures
          : null;

      // Quick bounding-box reject: skip strokes far from eraser
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        if (pts[i] < minX) minX = pts[i];
        if (pts[i] > maxX) maxX = pts[i];
        if (pts[i + 1] < minY) minY = pts[i + 1];
        if (pts[i + 1] > maxY) maxY = pts[i + 1];
      }
      if (ex + radius < minX || ex - radius > maxX ||
          ey + radius < minY || ey - radius > maxY) continue;

      // Walk through segments, building "outside" runs
      // For each segment P1->P2, classify the segment parts as inside/outside
      const outsideRuns: { pts: number[]; prs: number[] | null }[] = [];
      let runPts: number[] = [];
      let runPrs: number[] = [];
      let modified = false;

      const flushRun = () => {
        if (runPts.length >= 4) outsideRuns.push({ pts: runPts, prs: prs ? runPrs : null });
        runPts = [];
        runPrs = [];
      };
      const pushPt = (x: number, y: number, p: number) => {
        runPts.push(x, y);
        if (prs) runPrs.push(p);
      };

      for (let i = 0; i < pts.length - 2; i += 2) {
        const x1 = pts[i], y1 = pts[i + 1];
        const x2 = pts[i + 2], y2 = pts[i + 3];
        const pr1 = prs ? prs[i / 2] : 0;
        const pr2 = prs ? prs[i / 2 + 1] : 0;
        const p1in = isInside(x1, y1);
        const p2in = isInside(x2, y2);

        const crossings = circleSegmentIntersections(x1, y1, x2, y2);

        if (!p1in && !p2in && crossings.length === 0) {
          // Entire segment outside — add both endpoints
          if (runPts.length === 0) pushPt(x1, y1, pr1);
          pushPt(x2, y2, pr2);
        } else if (p1in && p2in && crossings.length === 0) {
          // Entire segment inside — flush current run
          modified = true;
          flushRun();
        } else {
          // Segment crosses the boundary
          modified = true;

          // Build sub-segments with their inside/outside classification
          const tValues = [0, ...crossings, 1];
          for (let j = 0; j < tValues.length - 1; j++) {
            const ta = tValues[j], tb = tValues[j + 1];
            const midT = (ta + tb) / 2;
            const midX = lerp(x1, x2, midT);
            const midY = lerp(y1, y2, midT);
            const midInside = isInside(midX, midY);

            if (!midInside) {
              // This sub-segment is outside
              const ax = lerp(x1, x2, ta), ay = lerp(y1, y2, ta);
              const bx = lerp(x1, x2, tb), by = lerp(y1, y2, tb);
              if (runPts.length === 0) pushPt(ax, ay, lerp(pr1, pr2, ta));
              pushPt(bx, by, lerp(pr1, pr2, tb));
            } else {
              // This sub-segment is inside — flush
              flushRun();
            }
          }
        }
      }
      // Flush last run
      flushRun();

      if (!modified) continue;

      toDelete.push(stroke.id);
      for (const run of outsideRuns) {
        toAdd.push({
          id: generateId(),
          points: run.pts,
          color: stroke.color,
          strokeWidth: stroke.strokeWidth,
          ...(stroke.groupId !== undefined ? { groupId: stroke.groupId } : {}),
          ...(run.prs ? { pressures: run.prs } : {}),
          ...(stroke.opacity !== undefined ? { opacity: stroke.opacity } : {}),
        });
      }
    }

    if (toDelete.length > 0) {
      store.deleteStrokes(toDelete);
      for (const s of toAdd) {
        useDrawStore.getState().addStroke(s);
      }
    }
  }, []);

  /** Cover the entire path, even when pointer events arrive far apart. */
  const eraseZoneAlong = useCallback((start: { x: number; y: number }, end: { x: number; y: number }, radius: number) => {
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const samples = Math.max(1, Math.ceil(distance / radius));
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      eraseZoneAt(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t, radius);
    }
  }, [eraseZoneAt]);

  const finishErase = useCallback((commit: boolean) => {
    const draw = useDrawStore.getState();
    if (commit) {
      const pending = draw.pendingEraseIds;
      if (pending.length > 0) draw.deleteStrokes(pending);
    }
    draw.clearPendingErase();
    if (eraseBatchOpen.current) {
      undoBatchEnd();
      eraseBatchOpen.current = false;
    }
    erasePreviousPoint.current = null;
  }, []);

  /**
   * Discard whatever gesture is in progress WITHOUT committing it. Called on
   * pointercancel, and by the pinch handler when a second finger lands —
   * the half-drawn stroke belongs to a zoom, not to the page.
   */
  const cancelInProgress = useCallback(() => {
    if (activePointer.current?.mode === 'erase') finishErase(false);
    activePointer.current = null;
    isDrawing.current = false;
    panLast.current = null;
    pointsRef.current = null;
    pressuresRef.current = null;
    setInProgressPoints(null);
    setInProgressPressures(null);
    shapeStart.current = null;
    setShapePreview(null);
    lassoStart.current = null;
    setLassoRect(null);
    setEraserPos(null);
    setPenCursorPos(null);
  }, [finishErase]);

  // Escape abandons a pending stroke erase, matching pointercancel rather
  // than committing the preview as a pointerup would.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activePointer.current?.mode === 'erase') {
        event.preventDefault();
        cancelInProgress();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelInProgress]);

  /**
   * True while a pen gesture should suppress touch: a pen stroke is active,
   * or one ended a moment ago and the palm is still on the glass.
   */
  const isPenGestureActive = useCallback(() => {
    if (activePointer.current?.type === 'pen') return true;
    return Date.now() - lastPenActivity.current < PALM_COOLDOWN_MS;
  }, []);

  /** Does a single finger draw right now, per the touch-draw mode? */
  const touchDraws = () => {
    const { drawOptions } = useToolStore.getState();
    if (drawOptions.touchDraw === 'always') return true;
    if (drawOptions.touchDraw === 'never') return false;
    return !useToolStore.getState().penDetected;
  };

  const applyPanClient = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage || !panLast.current) return;
    const dx = clientX - panLast.current.x;
    const dy = clientY - panLast.current.y;
    panLast.current = { x: clientX, y: clientY };
    stage.position({ x: stage.x() + dx, y: stage.y() + dy });
    const y = clampStageY(stage, liveCeiling());
    if (y !== stage.y()) stage.position({ x: stage.x(), y });
    useCanvasStore.getState().setViewport({ x: stage.x(), y: stage.y() });
  }, [stageRef]);

  /**
   * Capture-phase pan: Space+drag, middle-button, and the hand tool.
   * Runs on the canvas container so it wins over node dragging.
   * Returns true when the gesture was claimed.
   */
  const handlePanCapture = useCallback((evt: PointerEvent) => {
    if (activePointer.current !== null) return false;
    const tool = useToolStore.getState().activeTool;
    const middle = evt.button === 1 || (evt.buttons & 4) !== 0;
    const space = useToolStore.getState().spaceHeld;
    const hand = tool === 'hand';
    if (!middle && !space && !hand) return false;
    if (!middle && evt.button !== 0) return false;

    evt.preventDefault();
    evt.stopPropagation();
    activePointer.current = { id: evt.pointerId, type: evt.pointerType || 'mouse', mode: 'pan' };
    panLast.current = { x: evt.clientX, y: evt.clientY };

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== evt.pointerId) return;
      applyPanClient(ev.clientX, ev.clientY);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== evt.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      activePointer.current = null;
      panLast.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return true;
  }, [stageRef, applyPanClient]);

  const commitLasso = (rect: { x: number; y: number; w: number; h: number }, switchToSelect: boolean) => {
    const allStrokes = useDrawStore.getState().strokes;
    const selectedStrokes = allStrokes.filter((s) => {
      for (let i = 0; i < s.points.length; i += 2) {
        if (s.points[i] >= rect.x && s.points[i] <= rect.x + rect.w &&
            s.points[i + 1] >= rect.y && s.points[i + 1] <= rect.y + rect.h) {
          return true;
        }
      }
      return false;
    });
    useDrawStore.getState().selectStrokes(selectedStrokes.map((s) => s.id));

    const allNodes = useCanvasStore.getState().nodes;
    const selectedNodeIds = allNodes.filter((n) => {
      const nx1 = Math.min(n.x, n.x + n.width);
      const ny1 = Math.min(n.y, n.y + n.height);
      const nx2 = Math.max(n.x, n.x + n.width);
      const ny2 = Math.max(n.y, n.y + n.height);
      return !(nx2 < rect.x || nx1 > rect.x + rect.w ||
               ny2 < rect.y || ny1 > rect.y + rect.h);
    }).map((n) => n.id);

    useCanvasStore.setState({ selectedNodeIds });
    skipNextBackgroundClick = true;

    if (switchToSelect && (selectedNodeIds.length > 0 || selectedStrokes.length > 0)) {
      useToolStore.getState().setTool('select');
    }
  };

  const handleDrawPointerDown = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    const evt = e.evt;
    const tool = useToolStore.getState().activeTool;

    if (evt.pointerType === 'pen') {
      lastPenActivity.current = Date.now();
      // First pen contact of the session: in auto mode, fingers switch from
      // drawing to panning from here on (REQ-DRAW-012).
      if (!useToolStore.getState().penDetected) {
        useToolStore.getState().setPenDetected(true);
      }
    }

    // Palm rejection (REQ-DRAW-013): while the pen writes — or just wrote —
    // touch contacts are noise, not intent.
    if (evt.pointerType === 'touch' && isPenGestureActive()) return;

    // One pointer owns the gesture. A second finger landing on top of a
    // touch gesture hands over to pinch-zoom (the touch handlers see it too).
    if (activePointer.current !== null) {
      if (evt.pointerType === 'touch' && activePointer.current.type === 'touch') {
        cancelInProgress();
      }
      return;
    }

    const onStage = e.target === stageRef.current;
    const creationTool = tool === 'draw' || tool === 'shape' || tool === 'lasso';

    // Touch drag on empty background pans (select and other non-creation tools).
    // Creation tools keep their own gestures; draw-mode finger pan is below.
    if (evt.pointerType === 'touch' && onStage && !creationTool) {
      activePointer.current = { id: evt.pointerId, type: 'touch', mode: 'pan' };
      panLast.current = { x: evt.clientX, y: evt.clientY };
      return;
    }

    // For shape tool: allow clicks on background elements (PageGuides, Stage)
    // For draw/erase/lasso/select-marquee: only trigger on Stage itself
    if (tool !== 'shape' && !onStage) return;
    // For shape tool: don't start if clicking on an interactive node
    if (tool === 'shape') {
      let target: Konva.Node | null = e.target;
      while (target && target !== stageRef.current) {
        const rect = (target as any).findOne?.('Rect');
        if (rect?.id?.() && useCanvasStore.getState().nodes.find(n => n.id === rect.id())) {
          return; // Clicked on an existing node — don't start shape
        }
        target = target.parent;
      }
    }

    // A finger that doesn't draw pans instead — in draw mode the stage isn't
    // draggable, so the pan is driven here (REQ-DRAW-012).
    if (tool === 'draw' && evt.pointerType === 'touch' && !touchDraws()) {
      activePointer.current = { id: evt.pointerId, type: 'touch', mode: 'pan' };
      panLast.current = { x: evt.clientX, y: evt.clientY };
      return;
    }

    // Keep receiving moves when the pointer leaves the canvas mid-gesture.
    // Touch pointers are implicitly captured already; this is for pen/mouse.
    try {
      (evt.target as Element)?.setPointerCapture?.(evt.pointerId);
    } catch {
      // jsdom / detached target — capture is an enhancement, not a need
    }

    const pt = getCanvasPoint();

    if (tool === 'draw') {
      const drawOpts = useToolStore.getState().drawOptions;
      // The stylus eraser end erases without a toolbar round-trip
      // (REQ-DRAW-014); latched for this contact.
      const eraserHeld = evt.pointerType === 'pen' && (evt.buttons & ERASER_BUTTON) !== 0;
      if (drawOpts.isErasing || eraserHeld) {
        // Eraser mode
        isDrawing.current = true;
        activePointer.current = { id: evt.pointerId, type: evt.pointerType, mode: 'erase' };
        erasePreviousPoint.current = pt;
        undoBatchStart();
        eraseBatchOpen.current = true;
        if (drawOpts.eraserMode === 'stroke') {
          eraseStrokeAlong(pt, pt, false);
          setEraserPos({ ...pt, radius: STROKE_ERASER_SCREEN_RADIUS / useCanvasStore.getState().viewport.scale });
        } else {
          const radius = drawOpts.eraserSize / 2;
          setEraserPos({ ...pt, radius });
          eraseZoneAt(pt.x, pt.y, radius);
        }
      } else {
        // Pen mode
        isDrawing.current = true;
        activePointer.current = { id: evt.pointerId, type: evt.pointerType, mode: 'draw' };
        pointsRef.current = [pt.x, pt.y];
        // Pressure is only meaningful from a stylus: a mouse reports a flat
        // 0.5 and most touchscreens a flat 1.0 (REQ-DRAW-011).
        pressuresRef.current =
          evt.pointerType === 'pen' ? [evt.pressure > 0 ? evt.pressure : 0.3] : null;
        setInProgressPoints([...pointsRef.current]);
        setInProgressPressures(pressuresRef.current ? [...pressuresRef.current] : null);
      }
    } else if (tool === 'shape') {
      activePointer.current = { id: evt.pointerId, type: evt.pointerType, mode: 'shape' };
      shapeStart.current = pt;
      setShapePreview({ x: pt.x, y: pt.y, w: 0, h: 0 });
    } else if (tool === 'lasso' || (tool === 'select' && evt.pointerType !== 'touch')) {
      activePointer.current = { id: evt.pointerId, type: evt.pointerType, mode: 'lasso' };
      lassoStart.current = pt;
      setLassoRect({ x: pt.x, y: pt.y, w: 0, h: 0 });
    }
  }, [getCanvasPoint, stageRef, cancelInProgress, isPenGestureActive, eraseStrokeAlong, eraseZoneAt]);

  const handleDrawPointerMove = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    const evt = e.evt;
    const tool = useToolStore.getState().activeTool;

    if (evt.pointerType === 'pen') lastPenActivity.current = Date.now();

    // Only the owning pointer moves the gesture; a resting palm's moves and
    // a second finger's moves are ignored here.
    if (activePointer.current && evt.pointerId !== activePointer.current.id) return;

    // Touch that isn't drawing never paints hover cursors.
    if (!activePointer.current && evt.pointerType === 'touch') return;

    // Finger pan (draw mode, non-drawing finger) and select-tool touch pan
    if (activePointer.current?.mode === 'pan') {
      applyPanClient(evt.clientX, evt.clientY);
      return;
    }

    const pt = getCanvasPoint();
    const erasing =
      activePointer.current?.mode === 'erase' ||
      (!activePointer.current && useToolStore.getState().drawOptions.isErasing);

    // Track cursor for draw tool
    if (tool === 'draw') {
      const drawOpts = useToolStore.getState().drawOptions;
      if (erasing) {
        // Eraser cursor
        setPenCursorPos(null);
        const radius = drawOpts.eraserMode === 'zone'
          ? drawOpts.eraserSize / 2
          : STROKE_ERASER_SCREEN_RADIUS / useCanvasStore.getState().viewport.scale;
        setEraserPos({ x: pt.x, y: pt.y, radius });

        if (isDrawing.current) {
          const previous = erasePreviousPoint.current ?? pt;
          if (drawOpts.eraserMode === 'stroke') {
            eraseStrokeAlong(previous, pt, evt.altKey);
          } else {
            // Zone eraser — constant size from settings
            const r = drawOpts.eraserSize / 2;
            setEraserPos({ x: pt.x, y: pt.y, radius: r });
            eraseZoneAlong(previous, pt, r);
          }
          erasePreviousPoint.current = pt;
        }
      } else {
        // Pen cursor
        setPenCursorPos({ x: pt.x, y: pt.y });
        setEraserPos(null);

        if (isDrawing.current && activePointer.current?.mode === 'draw' && pointsRef.current) {
          // A 120Hz+ stylus reports several samples per animation frame;
          // the coalesced list keeps the curve smooth at speed.
          const isPen = evt.pointerType === 'pen';
          const samples =
            isPen && typeof evt.getCoalescedEvents === 'function'
              ? evt.getCoalescedEvents()
              : [];
          if (samples.length > 0) {
            for (const s of samples) {
              const c = clientToCanvas(s.clientX, s.clientY);
              pointsRef.current.push(c.x, c.y);
              pressuresRef.current?.push(s.pressure > 0 ? s.pressure : 0.3);
            }
          } else {
            pointsRef.current.push(pt.x, pt.y);
            pressuresRef.current?.push(evt.pressure > 0 ? evt.pressure : 0.3);
          }
          setInProgressPoints([...pointsRef.current]);
          if (isPen && pressuresRef.current) {
            setInProgressPressures([...pressuresRef.current]);
          }
        }
      }
    } else {
      setPenCursorPos(null);
      setEraserPos(null);
    }

    if (tool === 'shape' && shapeStart.current) {
      const start = shapeStart.current;
      const shapeType = useToolStore.getState().shapeOptions.shapeType;
      let w = pt.x - start.x;
      let h = pt.y - start.y;
      // Shift constrains to square/circle
      if (evt.shiftKey && shapeType !== 'arrow' && shapeType !== 'line') {
        const size = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * size;
        h = Math.sign(h || 1) * size;
      }
      if (shapeType === 'arrow' || shapeType === 'line') {
        // Arrows/lines: store start point and signed delta
        setShapePreview({ x: start.x, y: start.y, w, h });
        const candidate = bindingCandidate(
          useCanvasStore.getState().nodes,
          pt,
          undefined,
          12 / useCanvasStore.getState().viewport.scale,
        );
        setBindingHintId(candidate?.id ?? null);
      } else {
        // Other shapes: normalize to positive width/height with top-left origin
        setShapePreview({
          x: w >= 0 ? start.x : start.x + w,
          y: h >= 0 ? start.y : start.y + h,
          w: Math.abs(w),
          h: Math.abs(h),
        });
      }
    }

    if (activePointer.current?.mode === 'lasso' && lassoStart.current) {
      const start = lassoStart.current;
      setLassoRect({
        x: Math.min(start.x, pt.x),
        y: Math.min(start.y, pt.y),
        w: Math.abs(pt.x - start.x),
        h: Math.abs(pt.y - start.y),
      });
    }
  }, [getCanvasPoint, clientToCanvas, stageRef, eraseStrokeAlong, eraseZoneAlong, applyPanClient]);

  const handleDrawPointerUp = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    const evt = e.evt;
    if (evt.pointerType === 'pen') lastPenActivity.current = Date.now();
    if (activePointer.current && evt.pointerId !== activePointer.current.id) return;

    // Finger pan ends: viewport is already written per-move, just release.
    if (activePointer.current?.mode === 'pan') {
      activePointer.current = null;
      panLast.current = null;
      return;
    }

    const tool = useToolStore.getState().activeTool;

    const drawOpts = useToolStore.getState().drawOptions;
    const wasErase = activePointer.current?.mode === 'erase';
    const points = pointsRef.current;
    if (wasErase) {
      finishErase(true);
    } else if (tool === 'draw' && isDrawing.current && points && points.length >= 4) {
      const pressures =
        pressuresRef.current && pressuresRef.current.length * 2 === points.length
          ? pressuresRef.current
          : null;
      useDrawStore.getState().addStroke({
        id: generateId(),
        points,
        color: drawOpts.color,
        strokeWidth: drawOpts.strokeWidth,
        ...(pressures ? { pressures } : {}),
        ...(drawOpts.opacity < 1 ? { opacity: drawOpts.opacity } : {}),
      });
    } else if (tool === 'shape' && shapePreview) {
      // Commit shape node — different min size for shapes vs arrows/lines
      const shapeOpts = useToolStore.getState().shapeOptions;
      const isLine = shapeOpts.shapeType === 'arrow' || shapeOpts.shapeType === 'line';
      const dragDist = Math.sqrt(shapePreview.w * shapePreview.w + shapePreview.h * shapePreview.h);
      const minSize = isLine ? 5 : (Math.abs(shapePreview.w) > 5 && Math.abs(shapePreview.h) > 5);

      if (isLine ? dragDist > 5 : minSize) {
        const nodes = useCanvasStore.getState().nodes;
        const startPoint = { x: shapePreview.x, y: shapePreview.y };
        const endPoint = { x: shapePreview.x + shapePreview.w, y: shapePreview.y + shapePreview.h };
        const startTarget = isLine ? bindingCandidate(nodes, startPoint, undefined, 12 / useCanvasStore.getState().viewport.scale) : null;
        const endTarget = isLine ? bindingCandidate(nodes, endPoint, undefined, 12 / useCanvasStore.getState().viewport.scale) : null;
        const snappedStart = startTarget ? closestPointOnOutline(startTarget, startPoint) : startPoint;
        const snappedEnd = endTarget ? closestPointOnOutline(endTarget, endPoint) : endPoint;
        const arrowData: Partial<ShapeNodeData> = isLine ? {
          startBinding: startTarget ? { elementId: startTarget.id, fixedPoint: fixedPointFor(startTarget, snappedStart) } : null,
          endBinding: endTarget ? { elementId: endTarget.id, fixedPoint: fixedPointFor(endTarget, snappedEnd) } : null,
        } : {};
        useCanvasStore.getState().addNode({
          id: generateId(),
          type: 'shape',
          x: isLine ? snappedStart.x : shapePreview.x,
          y: isLine ? snappedStart.y : shapePreview.y,
          width: isLine ? snappedEnd.x - snappedStart.x : shapePreview.w,
          height: isLine ? snappedEnd.y - snappedStart.y : shapePreview.h,
          layer: 3,
          data: {
            shapeType: shapeOpts.shapeType,
            fill: shapeOpts.fill,
            stroke: shapeOpts.stroke,
            strokeWidth: shapeOpts.strokeWidth,
            strokeDash: [...shapeOpts.strokeDash],
            ...(shapeOpts.opacity < 1 ? { opacity: shapeOpts.opacity } : {}),
            ...arrowData,
          },
        });
      }
    } else if (activePointer.current?.mode === 'lasso' && lassoRect && lassoRect.w > 5 && lassoRect.h > 5) {
      commitLasso(lassoRect, tool === 'lasso');
    }

    activePointer.current = null;
    panLast.current = null;
    isDrawing.current = false;
    pointsRef.current = null;
    pressuresRef.current = null;
    setInProgressPoints(null);
    setInProgressPressures(null);
    shapeStart.current = null;
    setShapePreview(null);
    setBindingHintId(null);
    lassoStart.current = null;
    setLassoRect(null);
    const opts = useToolStore.getState().drawOptions;
    if (!(tool === 'draw' && opts.isErasing)) setEraserPos(null);
    // A lifted finger leaves no hover: without this the pen dot sticks at
    // the lift point until the next mouse move.
    if (evt.pointerType === 'touch') setPenCursorPos(null);
  }, [lassoRect, shapePreview, finishErase]);

  /**
   * Discard the owning pointer's in-progress gesture.
   *
   * Konva remaps native `pointercancel` to a synthetic `pointerup` on a
   * captured shape, and swallows it entirely when hit-testing misses (empty
   * canvas). The Stage `onPointerCancel` therefore never runs. Callers must
   * attach this to a native listener (capture phase on the canvas container)
   * so a cancelled stylus does not leave `activePointer` stuck.
   *
   * A cancel for a pointer that does not own the gesture is ignored — a
   * second stylus cancelling must not wipe the first stroke.
   */
  const handleDrawPointerCancel = useCallback(
    (e?: { pointerId?: number; evt?: { pointerId?: number } }) => {
      const id = e?.evt?.pointerId ?? e?.pointerId;
      if (id != null && activePointer.current && id !== activePointer.current.id) return;
      cancelInProgress();
    },
    [cancelInProgress],
  );

  return {
    // State
    inProgressPoints,
    inProgressPressures,
    eraserPos,
    penCursorPos,
    lassoRect,
    shapePreview,
    bindingHintId,
    // Handlers
    handleDrawPointerDown,
    handleDrawPointerMove,
    handleDrawPointerUp,
    handleDrawPointerCancel,
    handlePanCapture,
    // Pinch/palm coordination
    cancelInProgress,
    isPenGestureActive,
  };
}
