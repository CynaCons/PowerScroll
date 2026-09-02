import { create } from 'zustand';
import type { Stroke } from '../types/data';
import { useWorkspaceStore } from './useWorkspaceStore';

const MAX_HISTORY = 50;

interface DrawState {
  strokes: Stroke[];
  selectedStrokeIds: string[];
  /** Ephemeral stroke-eraser preview; intentionally not persisted or undoable. */
  pendingEraseIds: string[];

  addStroke: (stroke: Stroke) => void;
  deleteStroke: (id: string) => void;
  deleteStrokes: (ids: string[]) => void;
  moveStrokes: (ids: string[], dx: number, dy: number) => void;
  /** Move strokes to absolute positions from a start snapshot (no undo). */
  moveStrokesSilent: (
    ids: string[],
    dx: number,
    dy: number,
    startPoints: Map<string, number[]>,
  ) => void;
  /** Apply an affine canvas transform to ink without changing pressure or width. */
  transformStrokes: (ids: string[], matrix: StrokeTransformMatrix) => void;
  selectStrokes: (ids: string[]) => void;
  clearStrokeSelection: () => void;
  setStrokeGroupIds: (ids: string[], groupId: string | null) => void;
  markPendingErase: (ids: string[]) => void;
  unmarkPendingErase: (ids: string[]) => void;
  clearPendingErase: () => void;

  loadPageStrokes: (strokes: Stroke[]) => void;
  getStrokesSnapshot: () => Stroke[];

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

/** Konva-compatible affine matrix: [a, b, c, d, e, f]. */
export type StrokeTransformMatrix = [number, number, number, number, number, number];

let undoStack: Stroke[][] = [];
let redoStack: Stroke[][] = [];
let batchDepth = 0;
let batchSnapshot: Stroke[] | null = null;
let batchPushed = false;

function pushUndo(strokes: Stroke[]) {
  if (batchDepth > 0) {
    if (batchPushed) return;
    undoStack.push(deepCopy(batchSnapshot ?? strokes));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    batchPushed = true;
    return;
  }
  undoStack.push(deepCopy(strokes));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}

/** Start a draw-history batch. Its snapshot is only committed on mutation. */
export function undoBatchStart(): void {
  if (batchDepth === 0) {
    batchSnapshot = deepCopy(useDrawStore.getState().strokes);
    batchPushed = false;
  }
  batchDepth++;
}

/** End a draw-history batch started by a multi-mutation gesture. */
export function undoBatchEnd(): void {
  if (batchDepth === 0) return;
  batchDepth--;
  if (batchDepth === 0) {
    batchSnapshot = null;
    batchPushed = false;
  }
}

/** Export for multi-drag / group ops that batch canvas+stroke history. */
export function pushStrokeUndo(strokes: Stroke[]) {
  pushUndo(strokes);
}

/** Replace entire stroke list without undo (after pushStrokeUndo was called). */
export function replaceStrokesSilent(strokes: Stroke[]) {
  useDrawStore.setState({ strokes });
  useWorkspaceStore.getState().markDirty();
}

function deepCopy(strokes: Stroke[]): Stroke[] {
  return strokes.map((s) => ({
    ...s,
    points: [...s.points],
    ...(s.pressures ? { pressures: [...s.pressures] } : {}),
  }));
}

export const useDrawStore = create<DrawState>((set, get) => ({
  strokes: [],
  selectedStrokeIds: [],
  pendingEraseIds: [],

  addStroke: (stroke) => {
    set((state) => {
      pushUndo(state.strokes);
      useWorkspaceStore.getState().markDirty();
      return { strokes: [...state.strokes, stroke] };
    });
  },

  deleteStroke: (id) => {
    set((state) => {
      pushUndo(state.strokes);
      useWorkspaceStore.getState().markDirty();
      return {
        strokes: state.strokes.filter((s) => s.id !== id),
        selectedStrokeIds: state.selectedStrokeIds.filter((sid) => sid !== id),
        pendingEraseIds: state.pendingEraseIds.filter((sid) => sid !== id),
      };
    });
  },

  deleteStrokes: (ids) => {
    set((state) => {
      pushUndo(state.strokes);
      useWorkspaceStore.getState().markDirty();
      const idSet = new Set(ids);
      return {
        strokes: state.strokes.filter((s) => !idSet.has(s.id)),
        selectedStrokeIds: state.selectedStrokeIds.filter((sid) => !idSet.has(sid)),
        pendingEraseIds: state.pendingEraseIds.filter((sid) => !idSet.has(sid)),
      };
    });
  },

  moveStrokes: (ids, dx, dy) => {
    set((state) => {
      pushUndo(state.strokes);
      useWorkspaceStore.getState().markDirty();
      const idSet = new Set(ids);
      return {
        strokes: state.strokes.map((s) => {
          if (!idSet.has(s.id)) return s;
          const newPoints = [...s.points];
          for (let i = 0; i < newPoints.length; i += 2) {
            newPoints[i] += dx;
            newPoints[i + 1] += dy;
          }
          return { ...s, points: newPoints };
        }),
      };
    });
  },

  moveStrokesSilent: (ids, dx, dy, startPoints) => {
    set((state) => {
      useWorkspaceStore.getState().markDirty();
      const idSet = new Set(ids);
      return {
        strokes: state.strokes.map((s) => {
          if (!idSet.has(s.id)) return s;
          const base = startPoints.get(s.id) ?? s.points;
          const newPoints = [...base];
          for (let i = 0; i < newPoints.length; i += 2) {
            newPoints[i] += dx;
            newPoints[i + 1] += dy;
          }
          return { ...s, points: newPoints };
        }),
      };
    });
  },

  transformStrokes: (ids, [a, b, c, d, e, f]) => {
    set((state) => {
      const idSet = new Set(ids);
      useWorkspaceStore.getState().markDirty();
      return {
        strokes: state.strokes.map((stroke) => {
          if (!idSet.has(stroke.id)) return stroke;
          const points = [...stroke.points];
          for (let i = 0; i < points.length; i += 2) {
            const x = points[i];
            const y = points[i + 1];
            points[i] = a * x + c * y + e;
            points[i + 1] = b * x + d * y + f;
          }
          return { ...stroke, points };
        }),
      };
    });
  },

  selectStrokes: (ids) => set({ selectedStrokeIds: ids }),
  clearStrokeSelection: () => set({ selectedStrokeIds: [] }),

  markPendingErase: (ids) => set((state) => {
    const pending = new Set(state.pendingEraseIds);
    ids.forEach((id) => pending.add(id));
    return { pendingEraseIds: [...pending] };
  }),
  unmarkPendingErase: (ids) => set((state) => {
    const idsToRestore = new Set(ids);
    return { pendingEraseIds: state.pendingEraseIds.filter((id) => !idsToRestore.has(id)) };
  }),
  clearPendingErase: () => set({ pendingEraseIds: [] }),

  setStrokeGroupIds: (ids, groupId) => {
    set((state) => {
      pushUndo(state.strokes);
      useWorkspaceStore.getState().markDirty();
      const idSet = new Set(ids);
      return {
        strokes: state.strokes.map((s) =>
          idSet.has(s.id) ? { ...s, groupId } : s,
        ),
      };
    });
  },

  loadPageStrokes: (strokes) => {
    undoStack = [];
    redoStack = [];
    set({ strokes, selectedStrokeIds: [], pendingEraseIds: [] });
  },

  getStrokesSnapshot: () => get().strokes,

  undo: () => {
    const prev = undoStack.pop();
    if (!prev) return;
    set((state) => {
      redoStack.push(deepCopy(state.strokes));
      return { strokes: prev, pendingEraseIds: [] };
    });
  },

  redo: () => {
    const next = redoStack.pop();
    if (!next) return;
    set((state) => {
      undoStack.push(deepCopy(state.strokes));
      return { strokes: next, pendingEraseIds: [] };
    });
  },

  canUndo: () => undoStack.length > 0,
  canRedo: () => redoStack.length > 0,
}));
