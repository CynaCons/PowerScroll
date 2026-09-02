import { useEffect } from 'react';
import { useCanvasStore } from '../stores/useCanvasStore';
import { useToolStore } from '../stores/useToolStore';
import { useDrawStore } from '../stores/useDrawStore';
import { useGroupStore } from '../stores/useGroupStore';
import { useHistoryStore } from '../stores/useHistoryStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { groupSelection, ungroupSelection } from '../utils/groupOps';
import { getGroupMembers } from '../utils/groups';
import { redoActive, undoActive } from '../utils/undoOps';
import { recomputeBoundArrows } from '../utils/arrowBinding';

/** Holding an arrow key coalesces repeats into one undo entry. */
const NUDGE_COALESCE_MS = 300;
let lastNudgeAt = 0;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function nudgeSelection(dx: number, dy: number, recordHistory: boolean): boolean {
  const canvas = useCanvasStore.getState();
  const draw = useDrawStore.getState();
  const nodeIds = canvas.selectedNodeIds;
  const strokeIds = draw.selectedStrokeIds;
  if (nodeIds.length === 0 && strokeIds.length === 0) return false;

  if (recordHistory) useHistoryStore.getState().record();

  if (nodeIds.length > 0) {
    const selected = new Set(nodeIds);
    let nodes = canvas.nodes.map((node) =>
      selected.has(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node,
    );
    const followed = recomputeBoundArrows(nodes, selected);
    if (followed.length > 0) {
      const byId = new Map(followed.map((arrow) => [arrow.id, arrow]));
      nodes = nodes.map((node) => byId.get(node.id) ?? node);
    }
    useCanvasStore.setState({ nodes });
  }

  if (strokeIds.length > 0) {
    const idSet = new Set(strokeIds);
    useDrawStore.setState({
      strokes: draw.strokes.map((stroke) => {
        if (!idSet.has(stroke.id)) return stroke;
        const points = stroke.points.slice();
        for (let i = 0; i < points.length; i += 2) {
          points[i] += dx;
          points[i + 1] += dy;
        }
        return { ...stroke, points };
      }),
    });
  }

  useWorkspaceStore.getState().markDirty();
  return true;
}

/**
 * Hook for all keyboard event handlers on the canvas.
 * Handles: Delete, Escape, V/H/T/D/S/E/L shortcuts,
 * arrow-key nudge, Space (pan modifier),
 * Ctrl+Z (undo), Ctrl+Shift+Z/Ctrl+Y (redo),
 * Ctrl+C (copy), Ctrl+V (paste), Ctrl+A (select all).
 */
export function useCanvasKeyboard(
  clearSelection: () => void,
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) useToolStore.getState().setSpaceHeld(true);
        return;
      }

      // Delete / Backspace: delete selected nodes
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const store = useCanvasStore.getState();
        if (store.selectedNodeIds.length > 0) {
          e.preventDefault();
          store.deleteSelectedNodes();
        }
        return;
      }

      // Escape: exit isolation first, else return to select + clear
      if (e.key === 'Escape') {
        const groupUi = useGroupStore.getState();
        if (groupUi.editingGroupId) {
          e.preventDefault();
          const gid = groupUi.editingGroupId;
          groupUi.exitIsolation();
          const canvas = useCanvasStore.getState();
          const draw = useDrawStore.getState();
          const members = getGroupMembers(gid, canvas.nodes, draw.strokes);
          useCanvasStore.setState({ selectedNodeIds: members.nodeIds });
          draw.selectStrokes(members.strokeIds);
          return;
        }
        const toolStore = useToolStore.getState();
        if (toolStore.activeTool !== 'select') {
          toolStore.setTool('select');
        }
        clearSelection();
      }

      // Ctrl+G: group / Ctrl+Shift+G: ungroup
      if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) {
          ungroupSelection();
        } else {
          groupSelection();
        }
        return;
      }

      // Enter: enter isolation when a single group is selected
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        const canvas = useCanvasStore.getState();
        const draw = useDrawStore.getState();
        const first = canvas.nodes.find((n) => canvas.selectedNodeIds.includes(n.id));
        const gid = first?.groupId;
        if (gid && !useGroupStore.getState().editingGroupId) {
          e.preventDefault();
          useGroupStore.getState().enterIsolation(gid);
          // Keep first shape as the active isolated member
          if (first) {
            useCanvasStore.setState({ selectedNodeIds: [first.id] });
            draw.selectStrokes([]);
          }
        }
      }

      // Shift+1: zoom to fit / Shift+0: actual size
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === '!' || e.key === '1')) {
        e.preventDefault();
        useCanvasStore.getState().zoomToFit();
        return;
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === ')' || e.key === '0')) {
        e.preventDefault();
        useCanvasStore.getState().setZoom(1);
        return;
      }

      // Arrow keys nudge the selection (nodes + strokes). Shift = 10.
      if (
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')
        && !e.ctrlKey && !e.metaKey && !e.altKey
      ) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const now = Date.now();
        const coalesce = e.repeat && now - lastNudgeAt < NUDGE_COALESCE_MS;
        if (nudgeSelection(dx, dy, !coalesce)) {
          e.preventDefault();
          lastNudgeAt = now;
        }
        return;
      }

      // Letter shortcuts never fire with Ctrl/Meta (Ctrl+T/D/E/L must not switch tools).
      if (!e.ctrlKey && !e.metaKey) {
        const letter = e.key.length === 1 ? e.key.toLowerCase() : '';

        if (letter === 'v') {
          useToolStore.getState().setTool('select');
          return;
        }

        if (letter === 'h') {
          const toolStore = useToolStore.getState();
          toolStore.setTool(toolStore.activeTool === 'hand' ? 'select' : 'hand');
          return;
        }

        if (letter === 't') {
          const toolStore = useToolStore.getState();
          toolStore.setTool(toolStore.activeTool === 'text' ? 'select' : 'text');
          return;
        }

        if (letter === 'd') {
          const toolStore = useToolStore.getState();
          toolStore.setTool(toolStore.activeTool === 'draw' ? 'select' : 'draw');
          return;
        }

        if (letter === 's') {
          const toolStore = useToolStore.getState();
          toolStore.setTool(toolStore.activeTool === 'shape' ? 'select' : 'shape');
          return;
        }

        if (letter === 'e') {
          const toolStore = useToolStore.getState();
          if (toolStore.activeTool === 'draw') {
            toolStore.setDrawOptions({ isErasing: !toolStore.drawOptions.isErasing });
          } else {
            toolStore.setTool('draw');
            toolStore.setDrawOptions({ isErasing: true });
          }
          return;
        }

        if (letter === 'l') {
          const toolStore = useToolStore.getState();
          toolStore.setTool(toolStore.activeTool === 'lasso' ? 'select' : 'lasso');
          return;
        }
      }

      // Ctrl+C: copy
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        const store = useCanvasStore.getState();
        if (store.selectedNodeIds.length > 0) {
          e.preventDefault();
          store.copySelectedNodes();
        }
      }

      // Ctrl+V: paste internal nodes if clipboard non-empty,
      // otherwise let the browser paste event fire for external images
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (useCanvasStore.getState().hasClipboard()) {
          e.preventDefault();
          useCanvasStore.getState().pasteNodes();
        }
        // When internal clipboard is empty, don't preventDefault —
        // the browser paste event will fire and useCanvasDragDrop handles
        // images plus mxGraph/SVG source text
      }

      // Ctrl+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const store = useCanvasStore.getState();
        const allIds = store.nodes.map((n) => n.id);
        useCanvasStore.setState({ selectedNodeIds: allIds });
      }

      // Ctrl+Z: all canvas domains share one chronological history.
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoActive();
      }

      // Ctrl+Shift+Z / Ctrl+Y: redo
      if ((e.ctrlKey || e.metaKey) && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault();
        redoActive();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') useToolStore.getState().setSpaceHeld(false);
    };
    const handleBlur = () => useToolStore.getState().setSpaceHeld(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [clearSelection]);
}
