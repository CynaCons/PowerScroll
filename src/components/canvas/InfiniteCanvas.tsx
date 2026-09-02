import { useRef, useState, useCallback, useEffect } from 'react';
import { Stage, Layer, Group as KonvaGroup, Rect as KonvaRect, Ellipse, Line as KonvaLine } from 'react-konva';
import type Konva from 'konva';
import { useCanvasStore, MIN_SCALE, MAX_SCALE } from '../../stores/useCanvasStore';
import { useToolStore } from '../../stores/useToolStore';
import { getToolConfig } from '../../utils/toolConfig';
import { sortNodesForPaint } from '../../utils/zOrder';
import { useDrawStore } from '../../stores/useDrawStore';
import { CanvasNode } from './CanvasNode';
import { SelectionTransformer } from './SelectionTransformer';
import { ContextMenu } from './ContextMenu';
import { SnapGuides, type SnapGuide } from './SnapGuides';
import { PageGuides } from './PageGuides';
import { ScrollHeaders } from './ScrollHeaders';
import { DrawingLayer } from './DrawingLayer';
import { TrashButton } from './TrashButton';
import { DiagramSourceDialog } from './DiagramSourceDialog';
import { ImageLightbox } from './ImageLightbox';
import { useShapeCreation } from '../../hooks/useShapeCreation';
import { useTextPlacement, consumeAutoEditNodeId } from '../../hooks/useTextPlacement';
import { useCanvasKeyboard } from '../../hooks/useCanvasKeyboard';
import { useContextMenu } from '../../hooks/useContextMenu';
import { useCanvasDragDrop } from '../../hooks/useCanvasDragDrop';
import { useGroupStore } from '../../stores/useGroupStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { clampStageY, liveCeiling } from '../../utils/scrollCeiling';
import type { BackgroundMode, CanvasBgColor, ScrollRecord } from '../../types/data';
import './InfiniteCanvas.css';

const ZOOM_FACTOR = 1.05;

/** Stable empty array — a fresh [] each render would loop the store subscription. */
const EMPTY_SCROLLS: ScrollRecord[] = [];

export type { CanvasBgColor };

interface InfiniteCanvasProps {
  backgroundMode?: BackgroundMode;
  bgColor?: CanvasBgColor;
}

export function InfiniteCanvas({ backgroundMode = 'pages', bgColor = '#ffffff' }: InfiniteCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [snapLines, setSnapLines] = useState<SnapGuide[]>([]);
  const [scrollResizePreview, setScrollResizePreview] = useState<{ scrollId: string; width: number } | null>(null);

  const drawStrokes = useDrawStore((s) => s.strokes);
  const selectedStrokeIds = useDrawStore((s) => s.selectedStrokeIds);
  const pendingEraseIds = useDrawStore((s) => s.pendingEraseIds);
  const editingGroupId = useGroupStore((s) => s.editingGroupId);

  const nodes = useCanvasStore((s) => s.nodes);
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const addNode = useCanvasStore((s) => s.addNode);
  const setViewport = useCanvasStore((s) => s.setViewport);

  const activeTool = useToolStore((s) => s.activeTool);

  // Scroll records live on the workspace page, not the canvas store — subscribe
  // so a rename or a new scroll repaints without waiting for a node change.
  const activePageId = useWorkspaceStore((s) => s.activePageId);
  const activeScrolls = useWorkspaceStore(
    (s) =>
      s.workspace.sections
        .find((sec) => sec.id === s.activeSectionId)
        ?.pages.find((p) => p.id === s.activePageId)?.scrolls ?? EMPTY_SCROLLS,
  );
  const previewScrolls = scrollResizePreview
    ? activeScrolls.map((scroll) => scroll.id === scrollResizePreview.scrollId
      ? { ...scroll, width: scrollResizePreview.width }
      : scroll)
    : activeScrolls;

  useEffect(() => setScrollResizePreview(null), [activePageId]);

  // ── Extracted hooks ─────────────────────────────────────────
  const {
    inProgressPoints,
    inProgressPressures,
    eraserPos,
    penCursorPos,
    lassoRect,
    shapePreview,
    handleDrawPointerDown,
    handleDrawPointerMove,
    handleDrawPointerUp,
    handleDrawPointerCancel,
    cancelInProgress,
    isPenGestureActive,
  } = useShapeCreation(stageRef);

  const { handleStageClick } = useTextPlacement(stageRef, addNode, selectNode, clearSelection);

  useCanvasKeyboard(clearSelection);

  const {
    contextMenu,
    handleContextMenu,
    closeContextMenu,
    handleLongPressPointerDown,
    handleLongPressPointerMove,
    handleLongPressPointerUp,
    handleLongPressPointerCancel,
  } = useContextMenu(stageRef);

  useCanvasDragDrop(containerRef, stageRef, dimensions);

  // ── Register stage ref for zoom-to-fit and the zoom bar ─────
  // Runs after commit, so the Stage already exists — registering
  // synchronously avoids a window where zoom actions find no stage
  // and fall back to origin-anchored scaling.
  useEffect(() => {
    if (stageRef.current) {
      useCanvasStore.getState().setStageRef(stageRef.current);
    }
  }, [dimensions]);

  // ── Resize observer ────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    setDimensions({
      width: container.clientWidth,
      height: container.clientHeight,
    });

    return () => observer.disconnect();
  }, []);

  // ── Wheel: scroll (pan) + Ctrl+wheel (zoom) ─────────────
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;

      // Ctrl/Meta + wheel = zoom
      if (e.evt.ctrlKey || e.evt.metaKey) {
        const oldScale = stage.scaleX();
        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const mousePointTo = {
          x: (pointer.x - stage.x()) / oldScale,
          y: (pointer.y - stage.y()) / oldScale,
        };

        const direction = e.evt.deltaY > 0 ? -1 : 1;
        const newScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, oldScale * ZOOM_FACTOR ** direction),
        );

        const newPos = {
          x: pointer.x - mousePointTo.x * newScale,
          y: pointer.y - mousePointTo.y * newScale,
        };

        stage.scale({ x: newScale, y: newScale });
        stage.position(newPos);
        const zoomY = clampStageY(stage, liveCeiling());
        if (zoomY !== newPos.y) stage.position({ x: newPos.x, y: zoomY });
        setViewport({ x: newPos.x, y: zoomY, scale: newScale });
        return;
      }

      // Shift + scroll = horizontal pan
      // Normal scroll = vertical pan
      // Two-finger swipe on trackpad sends deltaX/deltaY directly
      const dx = e.evt.shiftKey ? -e.evt.deltaY : -e.evt.deltaX;
      const dy = e.evt.shiftKey ? 0 : -e.evt.deltaY;

      const newPos = {
        x: stage.x() + dx,
        y: stage.y() + dy,
      };

      stage.position(newPos);
      const y = clampStageY(stage, liveCeiling());
      if (y !== newPos.y) stage.position({ x: newPos.x, y });
      setViewport({ x: newPos.x, y });
    },
    [setViewport],
  );

  // ── Pinch-to-zoom (touch) ─────────────────────────────────
  const lastPinchDist = useRef<number | null>(null);
  const lastPinchCenter = useRef<{ x: number; y: number } | null>(null);
  const isPinching = useRef(false);

  const handleTouchStart = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) => {
      // Palm rejection: while the pen writes, a second contact is a resting
      // hand, not a pinch (REQ-DRAW-013).
      if (isPenGestureActive()) return;
      if (e.evt.touches.length >= 2) {
        isPinching.current = true;
        // Each pinch initializes itself: trusting touchend to have reset
        // these leaves the previous gesture's finger distance behind when
        // an end event arrives malformed, and the next pinch then opens
        // with a violent phantom zoom.
        lastPinchDist.current = null;
        lastPinchCenter.current = null;
        stageRef.current?.stopDrag();
        // A stroke the first finger started belongs to the zoom gesture,
        // not the page — discard it before pinch takes over.
        cancelInProgress();
      }
    },
    [isPenGestureActive, cancelInProgress],
  );

  const handleTouchMove = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) => {
      if (isPenGestureActive()) return;
      const touches = e.evt.touches;
      if (touches.length !== 2) {
        lastPinchDist.current = null;
        lastPinchCenter.current = null;
        return;
      }

      e.evt.preventDefault();
      isPinching.current = true;
      const stage = stageRef.current;
      if (!stage) return;

      const t1 = { x: touches[0].clientX, y: touches[0].clientY };
      const t2 = { x: touches[1].clientX, y: touches[1].clientY };
      const dist = Math.sqrt((t2.x - t1.x) ** 2 + (t2.y - t1.y) ** 2);
      const center = { x: (t1.x + t2.x) / 2, y: (t1.y + t2.y) / 2 };

      if (lastPinchDist.current === null) {
        lastPinchDist.current = dist;
        lastPinchCenter.current = center;
        return;
      }

      const oldScale = stage.scaleX();
      const scaleFactor = dist / lastPinchDist.current;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldScale * scaleFactor));

      const stageBox = stage.container().getBoundingClientRect();
      const pointerOnStage = {
        x: center.x - stageBox.left,
        y: center.y - stageBox.top,
      };

      const mousePointTo = {
        x: (pointerOnStage.x - stage.x()) / oldScale,
        y: (pointerOnStage.y - stage.y()) / oldScale,
      };

      const newPos = {
        x: pointerOnStage.x - mousePointTo.x * newScale,
        y: pointerOnStage.y - mousePointTo.y * newScale,
      };

      // Two fingers moving together pan (REQ-CANVAS-027): the zoom math
      // above anchors the canvas under the centroid's CURRENT position, but
      // only translating by the centroid's motion makes an unchanged finger
      // distance drag the page.
      if (lastPinchCenter.current) {
        newPos.x += center.x - lastPinchCenter.current.x;
        newPos.y += center.y - lastPinchCenter.current.y;
      }

      stage.scale({ x: newScale, y: newScale });
      stage.position(newPos);
      const y = clampStageY(stage, liveCeiling());
      if (y !== newPos.y) {
        newPos.y = y;
        stage.position(newPos);
      }

      setViewport({ x: newPos.x, y: newPos.y, scale: newScale });

      lastPinchDist.current = dist;
      lastPinchCenter.current = center;
    },
    [setViewport],
  );

  const handleTouchEnd = useCallback(() => {
    lastPinchDist.current = null;
    lastPinchCenter.current = null;
    isPinching.current = false;
  }, []);

  // ── Drag end (pan) ────────────────────────────────────────
  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (e.target !== stageRef.current) return;
      const stage = stageRef.current;
      if (!stage) return;
      setViewport({ x: stage.x(), y: stage.y() });
    },
    [setViewport],
  );

  // Live clamp while the stage is being dragged. A post-hoc snap on
  // dragend would let the camera sail above the ceiling mid-gesture.
  const dragBoundFunc = useCallback((pos: { x: number; y: number }) => {
    const stage = stageRef.current;
    if (!stage) return pos;
    return {
      x: pos.x,
      y: clampStageY({ y: () => pos.y, scaleX: () => stage.scaleX() }, liveCeiling()),
    };
  }, []);

  // ── Node selection handler (passed to CanvasNode) ─────────
  const handleNodeSelect = useCallback(
    (id: string, additive: boolean) => {
      selectNode(id, additive);
    },
    [selectNode],
  );

  // ── Tool config ────────────────────────────────
  const toolConfig = getToolConfig(activeTool);
  const isDrawTool = !toolConfig.allowNodeSelection || activeTool === 'shape';
  const cursorClass = toolConfig.cursorClass;

  // Get current stage scale for text editor positioning
  const currentScale = stageRef.current?.scaleX() ?? 1;

  return (
    <div
      ref={containerRef}
      className={`infinite-canvas ${cursorClass} ${bgColor === 'paper' ? 'infinite-canvas--paper' : ''}`}
      style={{ backgroundColor: bgColor === 'paper' ? '#f5f0e8' : bgColor }}
      data-testid="canvas-container"
      // Capture-phase native cancel: Konva's Stage onPointerCancel never
      // sees the event (it remaps cancel → pointerup on a hit, swallows a
      // miss). Running before Konva means a later synthetic pointerup finds
      // activePointer already cleared and does not commit a half-stroke.
      onPointerCancelCapture={isDrawTool ? (e) => handleDrawPointerCancel(e) : undefined}
    >
      {dimensions.width > 0 && dimensions.height > 0 && (
        <Stage
          ref={stageRef}
          width={dimensions.width}
          height={dimensions.height}
          draggable={!isDrawTool}
          dragBoundFunc={dragBoundFunc}
          onWheel={handleWheel}
          onDragEnd={handleDragEnd}
          onClick={(e) => { closeContextMenu(); handleStageClick(e); }}
          onTap={handleStageClick}
          onContextMenu={handleContextMenu}
          // Draw/shape/lasso own touch for drawing/panning; every other tool
          // gets the long-press path instead (REQ-CANVAS-028) — it no-ops
          // for mouse and for anything but the select tool, so this never
          // collides with node dragging or the other tools' own handlers.
          onPointerDown={isDrawTool ? handleDrawPointerDown : handleLongPressPointerDown}
          onPointerMove={isDrawTool ? handleDrawPointerMove : handleLongPressPointerMove}
          onPointerUp={isDrawTool ? handleDrawPointerUp : handleLongPressPointerUp}
          onPointerCancel={isDrawTool ? handleDrawPointerCancel : handleLongPressPointerCancel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <Layer>
            <PageGuides mode={backgroundMode} nodes={nodes} scrolls={previewScrolls} />
          </Layer>
          <Layer>
            {/* Shape preview ghost while dragging — uses same coordinate system as ShapeNode */}
            {shapePreview && (Math.abs(shapePreview.w) > 2 || Math.abs(shapePreview.h) > 2) && (() => {
              const opts = useToolStore.getState().shapeOptions;
              const sp = shapePreview;
              const commonProps = {
                stroke: opts.stroke,
                strokeWidth: opts.strokeWidth,
                dash: opts.strokeDash.length > 0 ? opts.strokeDash : undefined,
                fill: opts.fill === 'transparent' ? 'rgba(37,99,235,0.05)' : opts.fill,
                opacity: 0.6,
                listening: false as const,
              };
              // Render at (sp.x, sp.y) with children at (0,0) — same as ShapeNode's Group pattern
              if (opts.shapeType === 'rect') return <KonvaRect x={sp.x} y={sp.y} width={sp.w} height={sp.h} {...commonProps} />;
              if (opts.shapeType === 'circle') return <Ellipse x={sp.x + sp.w / 2} y={sp.y + sp.h / 2} radiusX={Math.abs(sp.w) / 2} radiusY={Math.abs(sp.h) / 2} {...commonProps} />;
              if (opts.shapeType === 'triangle') return <KonvaLine points={[sp.x + sp.w / 2, sp.y, sp.x + sp.w, sp.y + sp.h, sp.x, sp.y + sp.h]} closed {...commonProps} />;
              // Arrow/line: start at (sp.x, sp.y), end at (sp.x+sp.w, sp.y+sp.h) — matches ShapeNode's [0,0,w,h] offset by Group position
              if (opts.shapeType === 'arrow') return <KonvaLine points={[sp.x, sp.y, sp.x + sp.w, sp.y + sp.h]} stroke={opts.stroke} strokeWidth={opts.strokeWidth} opacity={0.6} listening={false} />;
              if (opts.shapeType === 'line') return <KonvaLine points={[sp.x, sp.y, sp.x + sp.w, sp.y + sp.h]} stroke={opts.stroke} strokeWidth={opts.strokeWidth} lineCap="round" opacity={0.6} listening={false} />;
              return null;
            })()}

            {/* Paint order. Group-aware: a diagram's members sort inside its
                band, so the frame's layer moves the whole drawing at once. */}
            {sortNodesForPaint(nodes).map((node) => {
              const isAutoEdit = consumeAutoEditNodeId(node.id);
              const dimmed =
                !!editingGroupId && node.groupId !== editingGroupId;
              return (
                <KonvaGroup key={node.id} opacity={dimmed ? 0.35 : 1} listening={!dimmed}>
                  <CanvasNode
                    node={node}
                    isSelected={selectedNodeIds.includes(node.id)}
                    onSelect={handleNodeSelect}
                    stageScale={currentScale}
                    autoEdit={isAutoEdit}
                    onSnapChange={setSnapLines}
                  />
                </KonvaGroup>
              );
            })}
            <SnapGuides lines={snapLines} />
          </Layer>
          {/* Scroll titles sit ABOVE the nodes (v0.35): once a title pins to the
              top of the viewport, content scrolls underneath it, so drawing it
              in the guide layer would let blocks pass over the header. */}
          <Layer>
            <ScrollHeaders
              mode={backgroundMode}
              scrolls={activeScrolls}
              pageId={activePageId}
              onResizePreviewChange={setScrollResizePreview}
            />
          </Layer>
          {/* Drawings render above nodes (REQ-DRAW-009) so pen strokes
              annotate over images/text/shapes. listening={false} keeps
              node clicks/drags working through the stroke layer. */}
          <Layer listening={false} name="draw-layer">
            <DrawingLayer
              strokes={drawStrokes}
              selectedStrokeIds={selectedStrokeIds}
              pendingEraseIds={pendingEraseIds}
              inProgressPoints={inProgressPoints}
              inProgressPressures={inProgressPressures}
              inProgressColor={useToolStore.getState().drawOptions?.color ?? '#1a1a1a'}
              inProgressWidth={useToolStore.getState().drawOptions?.strokeWidth ?? 3}
              eraserPos={eraserPos}
              penCursorPos={penCursorPos}
              penColor={useToolStore.getState().drawOptions?.color ?? '#1a1a1a'}
              penWidth={useToolStore.getState().drawOptions?.strokeWidth ?? 3}
              lassoRect={lassoRect}
            />
          </Layer>
          {/* Selection handles live on the very top so resize/rotate
              handles remain visible and clickable above strokes. */}
          <Layer>
            <SelectionTransformer
              selectedNodeIds={selectedNodeIds}
              selectedStrokeIds={selectedStrokeIds}
              stageRef={stageRef}
            />
          </Layer>
        </Stage>
      )}
      {/* Floating trash button for selected nodes */}
      {selectedNodeIds.length > 0 && (
        <TrashButton />
      )}
      {/* PlantUML behind a diagram. DOM, outside the Stage on purpose. */}
      <DiagramSourceDialog />
      {/* Image lightbox. DOM overlay, sibling of the Stage (not Konva). */}
      <ImageLightbox />
      {/* Right-click context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeId={contextMenu.nodeId}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
