import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Stage, Layer, Group as KonvaGroup } from 'react-konva';
import type Konva from 'konva';
import { useCanvasStore, MIN_SCALE, MAX_SCALE } from '../../stores/useCanvasStore';
import { useToolStore } from '../../stores/useToolStore';
import { getToolConfig } from '../../utils/toolConfig';
import { createPenCursor } from '../../utils/penCursor';
import { sortNodesForPaint } from '../../utils/zOrder';
import { useDrawStore } from '../../stores/useDrawStore';
import { CanvasNode } from './CanvasNode';
import { SelectionTransformer } from './SelectionTransformer';
import { ContextMenu } from './ContextMenu';
import { SnapGuides, type SnapGuide } from './SnapGuides';
import { PageGuides } from './PageGuides';
import { ScrollHeaderCards } from './ScrollHeaderCards';
import { DrawingLayer } from './DrawingLayer';
import { TrashButton } from './TrashButton';
import { DiagramSourceDialog } from './DiagramSourceDialog';
import { ImageLightbox } from './ImageLightbox';
import { ShapePreview } from './ShapePreview';
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
  const viewportScale = useCanvasStore((s) => s.viewport.scale);

  const activeTool = useToolStore((s) => s.activeTool);
  const spaceHeld = useToolStore((s) => s.spaceHeld);
  const drawOptions = useToolStore((s) => s.drawOptions);

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
    lassoRect,
    handleDrawPointerDown,
    handleDrawPointerMove,
    handleDrawPointerUp,
    handleDrawPointerCancel,
    handlePanCapture,
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
  const cursorClass = spaceHeld || activeTool === 'hand'
    ? 'infinite-canvas--grab'
    : activeTool === 'draw' && drawOptions.isErasing
      ? 'infinite-canvas--none'
      : toolConfig.cursorClass;
  const penCursor = useMemo(
    () => createPenCursor(drawOptions.color, drawOptions.strokeWidth, viewportScale),
    [drawOptions.color, drawOptions.strokeWidth, viewportScale],
  );
  const cursor = activeTool === 'draw' && !drawOptions.isErasing && !spaceHeld
    ? penCursor
    : undefined;

  // Get current stage scale for text editor positioning
  const currentScale = stageRef.current?.scaleX() ?? 1;

  return (
    <div
      ref={containerRef}
      className={`infinite-canvas ${cursorClass} ${bgColor === 'paper' ? 'infinite-canvas--paper' : ''}`}
      style={{ backgroundColor: bgColor === 'paper' ? '#f5f0e8' : bgColor, cursor }}
      data-testid="canvas-container"
      // Capture-phase native cancel: Konva's Stage onPointerCancel never
      // sees the event (it remaps cancel → pointerup on a hit, swallows a
      // miss). Running before Konva means a later synthetic pointerup finds
      // activePointer already cleared and does not commit a half-stroke.
      onPointerCancelCapture={(e) => handleDrawPointerCancel(e)}
      onPointerDownCapture={(e) => handlePanCapture(e.nativeEvent)}
    >
      {dimensions.width > 0 && dimensions.height > 0 && (
        <Stage
          ref={stageRef}
          width={dimensions.width}
          height={dimensions.height}
          draggable={false}
          dragBoundFunc={dragBoundFunc}
          onWheel={handleWheel}
          onDragEnd={handleDragEnd}
          onClick={(e) => { closeContextMenu(); handleStageClick(e); }}
          onTap={handleStageClick}
          onContextMenu={handleContextMenu}
          // Select-tool marquee, draw/shape/lasso, and touch pan share the
          // creation pointer pipeline. Long-press still runs for select+touch
          // on a node (it no-ops for mouse and other tools).
          onPointerDown={(e) => {
            handleLongPressPointerDown(e);
            handleDrawPointerDown(e);
          }}
          onPointerMove={(e) => {
            handleLongPressPointerMove(e);
            handleDrawPointerMove(e);
          }}
          onPointerUp={(e) => {
            handleLongPressPointerUp(e);
            handleDrawPointerUp(e);
          }}
          onPointerCancel={(e) => {
            handleLongPressPointerCancel(e);
            handleDrawPointerCancel(e);
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <Layer>
            <PageGuides mode={backgroundMode} nodes={nodes} scrolls={previewScrolls} viewportScale={viewportScale} />
          </Layer>
          <Layer>
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
              inProgressColor={drawOptions.color}
              inProgressWidth={drawOptions.strokeWidth}
              eraserPos={eraserPos}
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
            <ShapePreview />
          </Layer>
        </Stage>
      )}
      <ScrollHeaderCards
        mode={backgroundMode}
        scrolls={activeScrolls}
        pageId={activePageId}
        bgColor={bgColor}
        onResizePreviewChange={setScrollResizePreview}
      />
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
