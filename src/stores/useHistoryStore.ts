import { create } from 'zustand';
import type { CanvasNode, ScrollRecord, Stroke } from '../types/data';
import { useCanvasStore } from './useCanvasStore';
import { useDrawStore } from './useDrawStore';
import { useGroupStore } from './useGroupStore';
import { useWorkspaceStore } from './useWorkspaceStore';

export const MAX_HISTORY = 100;

export interface HistoryFrame {
  nodes: CanvasNode[];
  strokes: Stroke[];
  scrolls: ScrollRecord[];
}

interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  /** Changes whenever a stack changes; keeps controls subscribed without serializing frames. */
  revision: number;
  record: () => void;
  undo: () => void;
  redo: () => void;
  batchStart: () => void;
  batchEnd: () => void;
  clear: () => void;
}

let undoStack: HistoryFrame[] = [];
let redoStack: HistoryFrame[] = [];
let batchDepth = 0;
let batchFrame: HistoryFrame | null = null;
let batchRecorded = false;

function capture(): HistoryFrame {
  return {
    nodes: useCanvasStore.getState().nodes,
    strokes: useDrawStore.getState().strokes,
    scrolls: useWorkspaceStore.getState().getActivePage()?.scrolls ?? [],
  };
}

function selectionFor(frame: HistoryFrame) {
  const nodeIds = new Set(frame.nodes.map((node) => node.id));
  const strokeIds = new Set(frame.strokes.map((stroke) => stroke.id));
  const canvas = useCanvasStore.getState();
  const draw = useDrawStore.getState();
  const group = useGroupStore.getState();
  if (group.editingGroupId && !frame.nodes.some((node) => node.groupId === group.editingGroupId)) {
    group.exitIsolation();
  }
  return {
    selectedNodeIds: canvas.selectedNodeIds.filter((id) => nodeIds.has(id)),
    selectedStrokeIds: draw.selectedStrokeIds.filter((id) => strokeIds.has(id)),
    pendingEraseIds: draw.pendingEraseIds.filter((id) => strokeIds.has(id)),
  };
}

function restore(frame: HistoryFrame): void {
  const pageId = useWorkspaceStore.getState().activePageId;
  if (pageId) useWorkspaceStore.getState().replacePageScrolls(pageId, frame.scrolls);
  const selection = selectionFor(frame);
  useCanvasStore.setState({ nodes: frame.nodes, selectedNodeIds: selection.selectedNodeIds });
  useDrawStore.setState({
    strokes: frame.strokes,
    selectedStrokeIds: selection.selectedStrokeIds,
    pendingEraseIds: selection.pendingEraseIds,
  });
}

function sync(set: (partial: Pick<HistoryState, 'canUndo' | 'canRedo' | 'revision'>) => void): void {
  set({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, revision: Date.now() });
}

export const useHistoryStore = create<HistoryState>((set) => ({
  canUndo: false,
  canRedo: false,
  revision: 0,

  record: () => {
    if (batchDepth > 0 && batchRecorded) return;
    undoStack.push(batchDepth > 0 ? batchFrame! : capture());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    if (batchDepth > 0) batchRecorded = true;
    sync(set);
  },

  undo: () => {
    const previous = undoStack.pop();
    if (!previous) return;
    redoStack.push(capture());
    restore(previous);
    sync(set);
  },

  redo: () => {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(capture());
    restore(next);
    sync(set);
  },

  batchStart: () => {
    if (batchDepth === 0) {
      batchFrame = capture();
      batchRecorded = false;
    }
    batchDepth++;
  },

  batchEnd: () => {
    if (batchDepth === 0) return;
    batchDepth--;
    if (batchDepth === 0) {
      batchFrame = null;
      batchRecorded = false;
    }
  },

  clear: () => {
    undoStack = [];
    redoStack = [];
    batchDepth = 0;
    batchFrame = null;
    batchRecorded = false;
    sync(set);
  },
}));
