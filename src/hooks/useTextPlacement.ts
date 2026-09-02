import { useCallback } from 'react';
import type Konva from 'konva';
import { useCanvasStore, undoBatchStart, undoBatchEnd } from '../stores/useCanvasStore';
import { useToolStore } from '../stores/useToolStore';
import { generateId } from '../utils/ids';
import { DEFAULT_TEXT_WIDTH } from '../utils/pageLayout';
import { clampCanvasY, liveCeiling } from '../utils/scrollCeiling';
import { consumeMarqueeClickGuard } from './useShapeCreation';
import { applyDiagramScrollFit, rebuildDiagram, STARTER_DIAGRAM, FRAME_MIN_W, FRAME_MIN_H } from '../diagram/canvasOps';
import type { CanvasNode as CanvasNodeType } from '../types/data';

// Track the most recently placed node so it auto-enters edit mode
let autoEditNodeId: string | null = null;

/** Get the auto-edit node ID and clear it (one-shot read) */
export function consumeAutoEditNodeId(nodeId: string): boolean {
  if (autoEditNodeId === nodeId) {
    autoEditNodeId = null;
    return true;
  }
  return false;
}

/**
 * Hook for text tool click-to-place logic.
 * Returns a click handler that places a new text node when the text tool is active,
 * or clears selection otherwise. Implements one-shot behavior (reverts to select after placing).
 */
export function useTextPlacement(
  stageRef: React.RefObject<Konva.Stage | null>,
  addNode: (node: CanvasNodeType) => void,
  selectNode: (id: string, additive: boolean) => void,
  clearSelection: () => void,
) {
  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Allow clicks on the Stage itself AND on non-interactive background elements
      // (like PageGuide rects which have listening={false} or no node ID)
      const target = e.target;
      const isStage = target === stageRef.current;
      const isBackgroundElement = !isStage && !target.id();
      if (!isStage && !isBackgroundElement) return;

      const stage = stageRef.current;
      if (!stage) return;

      // Read tool state fresh (not from stale closure) to prevent accidental placement
      const currentTool = useToolStore.getState().activeTool;
      const currentTextOptions = useToolStore.getState().textOptions;

      if (currentTool === 'text') {
        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const scale = stage.scaleX();
        const stageX = (pointer.x - stage.x()) / scale;
        const stageY = clampCanvasY((pointer.y - stage.y()) / scale, liveCeiling());

        const newNode: CanvasNodeType = {
          id: generateId(),
          type: 'text',
          x: stageX,
          y: stageY,
          width: DEFAULT_TEXT_WIDTH,
          height: 30,
          layer: 4,
          data: {
            text: '',
            fontSize: currentTextOptions.fontSize,
            fontFamily: currentTextOptions.fontFamily,
            fontStyle: currentTextOptions.fontStyle,
            fill: currentTextOptions.fill,
          },
        };

        // Batch: addNode + first updateNode (blur commit) = single undo entry
        undoBatchStart(useCanvasStore.getState().nodes);
        useToolStore.getState().setTool('select');
        addNode(newNode);
        selectNode(newNode.id, false);
        autoEditNodeId = newNode.id;
      } else if (currentTool === 'gantt') {
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const scale = stage.scaleX();
        const stageX = (pointer.x - stage.x()) / scale;
        const stageY = clampCanvasY((pointer.y - stage.y()) / scale, liveCeiling());
        // Sample chart so the user sees a populated Gantt immediately.
        const sampleDoc = {
          schemaVersion: 1,
          title: 'New plan',
          calendar: { scale: 'week', fiscalYearStart: 1, workingDays: [1, 2, 3, 4, 5], holidays: [] },
          rows: [
            { id: 'row-1', label: 'Design', groupId: null },
            { id: 'row-2', label: 'Engineering', groupId: null },
            { id: 'row-3', label: 'Launch', groupId: null },
          ],
          tasks: [
            { id: 't-1', rowId: 'row-1', label: 'Wireframes', start: '2026-06-01', end: '2026-06-14', percentComplete: 60, color: '#7a82c9' },
            { id: 't-2', rowId: 'row-2', label: 'Build', start: '2026-06-15', end: '2026-07-12', percentComplete: 20, color: '#8aa68a' },
            { id: 't-3', rowId: 'row-3', label: 'Ship', start: '2026-07-13', end: '2026-07-19', color: '#c47a55' },
          ],
          milestones: [{ id: 'm-1', rowId: 'row-3', label: 'Public launch', date: '2026-07-19' }],
          brackets: [],
          dependencies: [],
          markers: [],
          style: { theme: 'dark', preset: 'default' },
        };
        const newNode: CanvasNodeType = {
          id: generateId(),
          type: 'gantt',
          x: stageX,
          y: stageY,
          width: 600,
          height: 300,
          layer: 3,
          data: { doc: sampleDoc, theme: 'dark' },
        };
        undoBatchStart(useCanvasStore.getState().nodes);
        useToolStore.getState().setTool('select');
        addNode(newNode);
        selectNode(newNode.id, false);
        // The batch MUST close here — an open batch swallows every later undo
        // snapshot, so one gantt placement used to break Ctrl+Z for the session.
        undoBatchEnd();
      } else if (currentTool === 'diagram') {
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const scale = stage.scaleX();
        const stageX = (pointer.x - stage.x()) / scale;
        const stageY = clampCanvasY((pointer.y - stage.y()) / scale, liveCeiling());

        // The frame is its own group, so its generated contents (which carry the
        // same groupId) drag along with it through the existing group machinery.
        const frameId = generateId();
        const frame: CanvasNodeType = {
          id: frameId,
          type: 'diagram',
          x: stageX,
          y: stageY,
          width: FRAME_MIN_W,
          height: FRAME_MIN_H,
          layer: 2,
          groupId: frameId,
          data: { source: STARTER_DIAGRAM, title: 'Composite structure' },
        };

        undoBatchStart(useCanvasStore.getState().nodes);
        useToolStore.getState().setTool('select');
        addNode(frame);

        // Draw it immediately, so placing the tool yields a real diagram rather
        // than an empty box the user has to go and fill in.
        const built = applyDiagramScrollFit(frame, rebuildDiagram(frame, STARTER_DIAGRAM));
        if (built.contents.length > 0) {
          for (const content of built.contents) useCanvasStore.getState().addNode(content);
          useCanvasStore.getState().updateNode(frameId, {
            width: built.frame.width,
            height: built.frame.height,
          });
        }
        selectNode(frameId, false);
        // Same as the gantt branch: an unclosed batch silently disables undo.
        undoBatchEnd();
      } else {
        if (consumeMarqueeClickGuard()) return;
        clearSelection();
      }
    },
    [stageRef, addNode, selectNode, clearSelection],
  );

  return { handleStageClick };
}
