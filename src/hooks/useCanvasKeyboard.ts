import { useEffect } from 'react';
import { useCanvasStore } from '../stores/useCanvasStore';
import { useToolStore } from '../stores/useToolStore';
import { useDrawStore } from '../stores/useDrawStore';
import { useGroupStore } from '../stores/useGroupStore';
import { groupSelection, ungroupSelection } from '../utils/groupOps';
import { getGroupMembers } from '../utils/groups';
import { redoActive, undoActive } from '../utils/undoOps';

/**
 * Hook for all keyboard event handlers on the canvas.
 * Handles: Delete, Escape, T, D, S, E, L shortcuts,
 * Ctrl+Z (undo), Ctrl+Shift+Z/Ctrl+Y (redo),
 * Ctrl+C (copy), Ctrl+V (paste), Ctrl+A (select all).
 */
export function useCanvasKeyboard(
  clearSelection: () => void,
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Delete / Backspace: delete selected nodes
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const store = useCanvasStore.getState();
        if (store.selectedNodeIds.length > 0) {
          e.preventDefault();
          store.deleteSelectedNodes();
        }
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

      // V: select tool
      if (e.key === 'v' || e.key === 'V') {
        if (!e.ctrlKey && !e.metaKey) {
          useToolStore.getState().setTool('select');
        }
      }

      // T: toggle text tool
      if (e.key === 't' || e.key === 'T') {
        const toolStore = useToolStore.getState();
        toolStore.setTool(toolStore.activeTool === 'text' ? 'select' : 'text');
      }

      // D: toggle draw tool
      if (e.key === 'd' || e.key === 'D') {
        const toolStore = useToolStore.getState();
        toolStore.setTool(toolStore.activeTool === 'draw' ? 'select' : 'draw');
      }

      // S: toggle shape tool
      if (e.key === 's' || e.key === 'S') {
        if (!e.ctrlKey && !e.metaKey) {
          const toolStore = useToolStore.getState();
          toolStore.setTool(toolStore.activeTool === 'shape' ? 'select' : 'shape');
        }
      }

      // E: toggle eraser mode in draw tool
      if (e.key === 'e' || e.key === 'E') {
        const toolStore = useToolStore.getState();
        if (toolStore.activeTool === 'draw') {
          toolStore.setDrawOptions({ isErasing: !toolStore.drawOptions.isErasing });
        } else {
          toolStore.setTool('draw');
          toolStore.setDrawOptions({ isErasing: true });
        }
      }

      // L: toggle lasso
      if (e.key === 'l' || e.key === 'L') {
        const toolStore = useToolStore.getState();
        toolStore.setTool(toolStore.activeTool === 'lasso' ? 'select' : 'lasso');
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection]);
}
