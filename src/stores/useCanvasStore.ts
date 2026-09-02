import { create } from 'zustand';
import type { ArrowBinding, CanvasNode, ShapeNodeData, Stroke, Viewport } from '../types/data';
import { generateId } from '../utils/ids';
import { expandSelectionForGroup } from '../utils/groups';
import { clampStageY, pageCeiling } from '../utils/scrollCeiling';
import { syncImageMiniOnUpdate } from '../utils/imageMini';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useDrawStore } from './useDrawStore';
import { useGroupStore } from './useGroupStore';
import { useHistoryStore } from './useHistoryStore';
import { isBindableNode, recomputeBoundArrows } from '../utils/arrowBinding';

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
  setArrowBinding: (id: string, endpoint: 'start' | 'end', binding: ArrowBinding | null) => void;
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

function isArrow(node: CanvasNode): boolean {
  const data = node.data as ShapeNodeData;
  return node.type === 'shape' && (data.shapeType === 'arrow' || data.shapeType === 'line');
}

/** Keep the reverse index small, correct, and derived solely from arrow data. */
function reconcileArrowReferences(nodes: CanvasNode[]): CanvasNode[] {
  const targetIds = new Set(nodes.filter(isBindableNode).map((node) => node.id));
  const references = new Map<string, string[]>();
  for (const arrow of nodes.filter(isArrow)) {
    const data = arrow.data as ShapeNodeData;
    for (const binding of [data.startBinding, data.endBinding]) {
      if (binding && targetIds.has(binding.elementId)) {
        const ids = references.get(binding.elementId) ?? [];
        if (!ids.includes(arrow.id)) ids.push(arrow.id);
        references.set(binding.elementId, ids);
      }
    }
  }
  return nodes.map((node) => {
    if (!isBindableNode(node)) return node;
    const ids = references.get(node.id) ?? [];
    const previous = node.boundElements ?? [];
    if (previous.length === ids.length && previous.every((entry) => ids.includes(entry.id))) return node;
    return { ...node, boundElements: ids.map((id) => ({ id, type: 'arrow' as const })) };
  });
}

function followUpdatedNode(nodes: CanvasNode[], id: string, updates: Partial<CanvasNode>): CanvasNode[] {
  const next = nodes.map((node) => node.id === id ? syncImageMiniOnUpdate(node, updates) : node);
  const changed = next.find((node) => node.id === id);
  if (!changed || !isBindableNode(changed)) return reconcileArrowReferences(next);
  const replacements = new Map(recomputeBoundArrows(next, [id]).map((arrow) => [arrow.id, arrow]));
  return reconcileArrowReferences(next.map((node) => replacements.get(node.id) ?? node));
}

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
      nodes: reconcileArrowReferences(state.nodes.filter((n) => !nodeIds.has(n.id)).map((node) => {
        if (!isArrow(node)) return node;
        const data = node.data as ShapeNodeData;
        const startBinding = data.startBinding && nodeIds.has(data.startBinding.elementId) ? null : data.startBinding;
        const endBinding = data.endBinding && nodeIds.has(data.endBinding.elementId) ? null : data.endBinding;
        return startBinding === data.startBinding && endBinding === data.endBinding ? node : { ...node, data: { ...data, startBinding, endBinding } };
      })),
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
      nodes: reconcileArrowReferences(s.nodes.filter((n) => !nodeIds.has(n.id)).map((node) => {
        if (!isArrow(node)) return node;
        const data = node.data as ShapeNodeData;
        const startBinding = data.startBinding && nodeIds.has(data.startBinding.elementId) ? null : data.startBinding;
        const endBinding = data.endBinding && nodeIds.has(data.endBinding.elementId) ? null : data.endBinding;
        return startBinding === data.startBinding && endBinding === data.endBinding ? node : { ...node, data: { ...data, startBinding, endBinding } };
      })),
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
      return { nodes: reconcileArrowReferences([...state.nodes, withLayer]) };
    }),

  updateNode: (id, updates) =>
    set((state) => {
      useHistoryStore.getState().record();
      useWorkspaceStore.getState().markDirty();
      return {
        nodes: followUpdatedNode(state.nodes, id, updates),
      };
    }),

  updateNodeSilent: (id, updates) =>
    set((state) => {
      useWorkspaceStore.getState().markDirty();
      return {
        nodes: followUpdatedNode(state.nodes, id, updates),
      };
    }),

  setArrowBinding: (id, endpoint, binding) => set((state) => {
    const arrow = state.nodes.find((node) => node.id === id);
    if (!arrow || !isArrow(arrow)) return {};
    useHistoryStore.getState().record();
    useWorkspaceStore.getState().markDirty();
    const data = arrow.data as ShapeNodeData;
    const key = endpoint === 'start' ? 'startBinding' : 'endBinding';
    const nodes = state.nodes.map((node) => node.id === id
      ? { ...node, data: { ...data, [key]: binding } }
      : node);
    return { nodes: reconcileArrowReferences(nodes) };
  }),

  deleteNode: (id) => applyNodeDeletion(get, set, [id]),

  deleteSelectedNodes: () => applyNodeDeletion(get, set, get().selectedNodeIds),

  loadPageNodes: (nodes) => {
    // Reset shared history on page switch.
    useHistoryStore.getState().clear();
    set({ nodes: reconcileArrowReferences(nodes), selectedNodeIds: [], lightboxNodeId: null });
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
      .map((n) => ({ ...n, data: { ...n.data }, boundElements: undefined }));
  },

  pasteNodes: (offsetX = 20, offsetY = 20) => {
    if (clipboard.length === 0) return;
    const idMap = new Map(clipboard.map((node) => [node.id, generateId()]));
    const copiedIds = new Set(idMap.keys());
    const newNodes = clipboard.map((n) => {
      const data = { ...n.data } as ShapeNodeData;
      if (isArrow(n)) {
        const remap = (binding: ArrowBinding | null | undefined) => binding && copiedIds.has(binding.elementId)
          ? { ...binding, elementId: idMap.get(binding.elementId)! } : null;
        data.startBinding = remap(data.startBinding);
        data.endBinding = remap(data.endBinding);
      }
      return { ...n, id: idMap.get(n.id)!, x: n.x + offsetX, y: n.y + offsetY, data, boundElements: undefined };
    });
    set((state) => {
      useHistoryStore.getState().record();
      return {
        nodes: reconcileArrowReferences([...state.nodes, ...newNodes]),
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
