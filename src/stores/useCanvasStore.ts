import { create } from 'zustand';
import type { CanvasNode, Stroke, Viewport } from '../types/data';
import { generateId } from '../utils/ids';
import { expandSelectionForGroup } from '../utils/groups';
import { clampStageY, pageCeiling } from '../utils/scrollCeiling';
import { syncImageMiniOnUpdate } from '../utils/imageMini';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useDrawStore } from './useDrawStore';
import { useGroupStore } from './useGroupStore';
import { useHistoryStore } from './useHistoryStore';

/** Viewport zoom bounds — shared by wheel zoom, pinch zoom and the zoom bar. */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5.0;

interface CanvasState {
  nodes: CanvasNode[];
  viewport: Viewport;
  selectedNodeIds: string[];

  /**
   * Image lightbox overlay (REQ-IMAGE-019/020). Ephemeral UI: not pushed to
   * undo history and not persisted with the notebook.
   */
  lightboxNodeId: string | null;
  openLightbox: (id: string) => void;
  closeLightbox: () => void;

  // Node CRUD (all push to undo history)
  addNode: (node: CanvasNode) => void;
  updateNode: (id: string, updates: Partial<CanvasNode>) => void;
  updateNodeSilent: (id: string, updates: Partial<CanvasNode>) => void; // no undo push (for layout sync)
  deleteNode: (id: string) => void;
  deleteSelectedNodes: () => void;

  // Bulk operations for page switching
  loadPageNodes: (nodes: CanvasNode[]) => void;
  getNodesSnapshot: () => CanvasNode[];

  // Selection
  selectNode: (id: string, additive: boolean) => void;
  clearSelection: () => void;

  // Viewport
  setViewport: (viewport: Partial<Viewport>) => void;
  _stageRef: { current: any | null };
  setStageRef: (stage: any) => void;
  zoomToFit: () => void;
  /** Zoom to an absolute scale, anchored on the centre of the visible canvas. */
  setZoom: (scale: number) => void;

  // Clipboard
  copySelectedNodes: () => void;
  pasteNodes: (offsetX?: number, offsetY?: number) => void;
  hasClipboard: () => boolean;
  /** @deprecated Use the shared history store. Kept for bridge compatibility. */
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

}

// Module-level state (persists across renders, not serialized)
let clipboard: CanvasNode[] = [];

let _konvaStageRef: any = null; // Konva.Stage reference for direct manipulation
/** Compatibility helpers for existing gesture call sites. Frames always include all stores. */
export function undoBatchStart(_nodes?: CanvasNode[]): void { useHistoryStore.getState().batchStart(); }
export function undoBatchEnd(): void { useHistoryStore.getState().batchEnd(); }

/**
 * Frame-deletion cascade (v0.53). Deleting a `type:'diagram'` node also
 * removes every node and stroke whose groupId is the frame id, as one undo
 * entry. Lives in the store primitive so the delete key, context menu, and
 * bridge delete_block inherit it — do not special-case those call sites.
 */
function collectDeletion(
  nodes: CanvasNode[],
  strokes: Stroke[],
  seedIds: readonly string[],
): { nodeIds: Set<string>; strokeIds: Set<string>; cascaded: boolean } {
  const nodeIds = new Set<string>();
  const strokeIds = new Set<string>();
  let cascaded = false;
  for (const id of seedIds) {
    nodeIds.add(id);
    const node = nodes.find((n) => n.id === id);
    if (node?.type !== 'diagram') continue;
    cascaded = true;
    for (const n of nodes) {
      if (n.groupId === id) nodeIds.add(n.id);
    }
    for (const s of strokes) {
      if (s.groupId === id) strokeIds.add(s.id);
    }
  }
  return { nodeIds, strokeIds, cascaded };
}

function applyNodeDeletion(
  get: () => CanvasState,
  set: (partial: Partial<CanvasState> | ((s: CanvasState) => Partial<CanvasState>)) => void,
  seedIds: readonly string[],
): void {
  const state = get();
  const strokes = useDrawStore.getState().strokes;
  const { nodeIds, strokeIds, cascaded } = collectDeletion(state.nodes, strokes, seedIds);

  useWorkspaceStore.getState().markDirty();

  if (cascaded) {
    useHistoryStore.getState().batchStart();
    useHistoryStore.getState().record();
    set({
      nodes: state.nodes.filter((n) => !nodeIds.has(n.id)),
      selectedNodeIds: state.selectedNodeIds.filter((id) => !nodeIds.has(id)),
    });
    const selectedStrokeIds = useDrawStore.getState().selectedStrokeIds;
    useDrawStore.setState({
      strokes: strokes.filter((s) => !strokeIds.has(s.id)),
      selectedStrokeIds: selectedStrokeIds.filter((id) => !strokeIds.has(id)),
    });
    undoBatchEnd();
    return;
  }

  set((s) => {
    useHistoryStore.getState().record();
    return {
      nodes: s.nodes.filter((n) => !nodeIds.has(n.id)),
      selectedNodeIds: s.selectedNodeIds.filter((id) => !nodeIds.has(id)),
    };
  });
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  viewport: { x: 0, y: 0, scale: 1 },
  selectedNodeIds: [],
  lightboxNodeId: null,

  openLightbox: (id) => set({ lightboxNodeId: id }),
  closeLightbox: () => set({ lightboxNodeId: null }),

  addNode: (node) =>
    set((state) => {
      useHistoryStore.getState().record();
      useWorkspaceStore.getState().markDirty();
      // Default layers: text=4 (above shapes), shapes/images=3
      const defaultLayer = node.type === 'text' ? 4 : 3;
      const withLayer = { ...node, layer: node.layer ?? defaultLayer };
      return { nodes: [...state.nodes, withLayer] };
    }),

  updateNode: (id, updates) =>
    set((state) => {
      useHistoryStore.getState().record();
      useWorkspaceStore.getState().markDirty();
      return {
        nodes: state.nodes.map((n) =>
          n.id === id ? syncImageMiniOnUpdate(n, updates) : n,
        ),
      };
    }),

  updateNodeSilent: (id, updates) =>
    set((state) => {
      useWorkspaceStore.getState().markDirty();
      return {
        nodes: state.nodes.map((n) =>
          n.id === id ? { ...n, ...updates } : n,
        ),
      };
    }),

  deleteNode: (id) => applyNodeDeletion(get, set, [id]),

  deleteSelectedNodes: () => applyNodeDeletion(get, set, get().selectedNodeIds),

  loadPageNodes: (nodes) => {
    // Reset shared history on page switch.
    useHistoryStore.getState().clear();
    set({ nodes, selectedNodeIds: [], lightboxNodeId: null });
  },

  getNodesSnapshot: () => get().nodes,

  selectNode: (id, additive) => {
    const editingGroupId = useGroupStore.getState().editingGroupId;
    const draw = useDrawStore.getState();

    // Isolation: only allow selecting members of the editing group (single)
    if (editingGroupId) {
      const node = get().nodes.find((n) => n.id === id);
      if (!node || node.groupId !== editingGroupId) return;
      set({ selectedNodeIds: [id] });
      draw.selectStrokes([]);
      return;
    }

    const state = get();
    const expanded = expandSelectionForGroup(
      id,
      state.nodes,
      draw.strokes,
      additive,
      state.selectedNodeIds,
      draw.selectedStrokeIds,
    );
    set({ selectedNodeIds: expanded.nodeIds });
    draw.selectStrokes(expanded.strokeIds);
  },

  clearSelection: () => {
    useGroupStore.getState().exitIsolation();
    useDrawStore.getState().clearStrokeSelection();
    set({ selectedNodeIds: [] });
  },

  setViewport: (viewport) => {
    set((state) => {
      const next = { ...state.viewport, ...viewport };
      // Backstop for every camera path, including zoom-to-fit / zoom presets
      // that never go through a gesture handler. Mid-gesture stage.position()
      // still needs its own clamp — this only sees the store write.
      const ceiling = pageCeiling(
        state.nodes,
        useDrawStore.getState().strokes,
        useWorkspaceStore.getState().getActivePage()?.scrolls,
      );
      const y = clampStageY({ y: () => next.y, scaleX: () => next.scale }, ceiling);
      return { viewport: { ...next, y } };
    });
    // Sync the Konva Stage if ref is available
    if (_konvaStageRef) {
      const v = get().viewport;
      _konvaStageRef.scale({ x: v.scale, y: v.scale });
      _konvaStageRef.position({ x: v.x, y: v.y });
      _konvaStageRef.batchDraw();
    }
  },

  _stageRef: { current: null }, // kept for interface compat

  setStageRef: (stage) => {
    _konvaStageRef = stage;
  },

  setZoom: (scale) => {
    const { viewport } = get();
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    if (clamped === viewport.scale) return;

    // Anchor on the centre of the visible canvas so the middle of the view
    // stays put — the same feel as cursor-anchored wheel zoom.
    const container = _konvaStageRef?.container();
    const cx = (container?.clientWidth ?? 0) / 2;
    const cy = (container?.clientHeight ?? 0) / 2;
    const k = clamped / viewport.scale;

    get().setViewport({
      x: cx - (cx - viewport.x) * k,
      y: cy - (cy - viewport.y) * k,
      scale: clamped,
    });
  },

  zoomToFit: () => {
    const nodes = get().nodes;
    if (nodes.length === 0) return;

    const stage = _konvaStageRef;
    if (!stage) return;
    const container = stage.container();
    const cw = container.clientWidth;
    const ch = container.clientHeight;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n.width || 200));
      maxY = Math.max(maxY, n.y + (n.height || 40));
    }

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    if (contentW <= 0 || contentH <= 0) return;

    const padding = 60;
    const scale = Math.min(
      (cw - padding * 2) / contentW,
      (ch - padding * 2) / contentH,
      2,
    );
    const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    get().setViewport({
      x: cw / 2 - centerX * clampedScale,
      y: ch / 2 - centerY * clampedScale,
      scale: clampedScale,
    });
  },

  copySelectedNodes: () => {
    const state = get();
    clipboard = state.nodes
      .filter((n) => state.selectedNodeIds.includes(n.id))
      .map((n) => ({ ...n, data: { ...n.data } }));
  },

  pasteNodes: (offsetX = 20, offsetY = 20) => {
    if (clipboard.length === 0) return;
    const newNodes = clipboard.map((n) => ({
      ...n,
      id: generateId(),
      x: n.x + offsetX,
      y: n.y + offsetY,
      data: { ...n.data },
    }));
    set((state) => {
      useHistoryStore.getState().record();
      return {
        nodes: [...state.nodes, ...newNodes],
        selectedNodeIds: newNodes.map((n) => n.id),
      };
    });
  },

  hasClipboard: () => clipboard.length > 0,

  undo: () => useHistoryStore.getState().undo(),
  redo: () => useHistoryStore.getState().redo(),
  canUndo: () => useHistoryStore.getState().canUndo,
  canRedo: () => useHistoryStore.getState().canRedo,

}));
