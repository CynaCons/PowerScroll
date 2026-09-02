/**
 * Multi-node (+ selected stroke) drag session.
 * One undo snapshot at start; silent position updates during move/end.
 */
import type Konva from 'konva';
import { useCanvasStore, undoBatchStart, undoBatchEnd } from '../stores/useCanvasStore';
import { useDrawStore, pushStrokeUndo } from '../stores/useDrawStore';
import type { SnapNodeBounds } from '../components/canvas/SnapGuides';

interface DragSession {
  draggedId: string;
  originX: number;
  originY: number;
  nodeStarts: Map<string, { x: number; y: number }>;
  strokeStarts: Map<string, number[]>;
  multi: boolean;
}

let session: DragSession | null = null;

export function multiDragStart(draggedId: string, x: number, y: number): void {
  const canvas = useCanvasStore.getState();
  const draw = useDrawStore.getState();

  const inSelection = canvas.selectedNodeIds.includes(draggedId);

  // Konva begins dragging on mousedown, before any click has run — so a press
  // and drag in one motion arrives with the node still unselected. Falling back
  // to [draggedId] there tore groups apart: the frame of a diagram moved while
  // its contents stayed put. Group membership, not selection, decides what
  // travels together, which also matches what click-then-drag already did.
  let nodeIds: string[];
  if (inSelection) {
    nodeIds = [...canvas.selectedNodeIds];
  } else {
    const dragged = canvas.nodes.find((n) => n.id === draggedId);
    nodeIds = dragged?.groupId
      ? canvas.nodes.filter((n) => n.groupId === dragged.groupId).map((n) => n.id)
      : [draggedId];
  }
  const strokeIds =
    inSelection && nodeIds.length + draw.selectedStrokeIds.length > 1
      ? [...draw.selectedStrokeIds]
      : inSelection
        ? [...draw.selectedStrokeIds]
        : [];

  const multi = nodeIds.length > 1 || strokeIds.length > 0;

  if (multi) {
    undoBatchStart(canvas.nodes);
    if (strokeIds.length > 0) {
      pushStrokeUndo(draw.strokes);
    }
  }

  const nodeStarts = new Map<string, { x: number; y: number }>();
  for (const id of nodeIds) {
    const n = canvas.nodes.find((nn) => nn.id === id);
    if (n) nodeStarts.set(id, { x: n.x, y: n.y });
  }

  const strokeStarts = new Map<string, number[]>();
  for (const id of strokeIds) {
    const s = draw.strokes.find((ss) => ss.id === id);
    if (s) strokeStarts.set(id, [...s.points]);
  }

  session = {
    draggedId,
    originX: x,
    originY: y,
    nodeStarts,
    strokeStarts,
    multi,
  };
}

export function multiDragMove(
  draggedId: string,
  x: number,
  y: number,
  stage: Konva.Stage | null,
): void {
  if (!session || session.draggedId !== draggedId) return;
  const canvas = useCanvasStore.getState();

  // Keep the store in step with the Konva group that the user grabbed. This
  // lets bound arrows follow during the drag rather than only on release.
  canvas.updateNodeSilent(draggedId, { x, y });

  if (!session.multi) return;
  const dx = x - session.originX;
  const dy = y - session.originY;

  for (const [id, start] of session.nodeStarts) {
    if (id === draggedId) continue;
    const nx = start.x + dx;
    const ny = start.y + dy;
    canvas.updateNodeSilent(id, { x: nx, y: ny });
    if (stage) {
      // Hit rect has node id; parent Group holds position
      const hit = stage.findOne(`#${id}`);
      const group = hit?.getParent?.();
      if (group && group !== stage) {
        group.position({ x: nx, y: ny });
      }
    }
  }

  if (session.strokeStarts.size > 0) {
    useDrawStore.getState().moveStrokesSilent(
      Array.from(session.strokeStarts.keys()),
      dx,
      dy,
      session.strokeStarts,
    );
  }
}

/**
 * Bounds of everything moving in the active drag. Object snapping uses this
 * rather than just the grabbed node, so a multi-selection keeps its shape.
 */
export function multiDragBounds(
  draggedId: string,
  x: number,
  y: number,
  fallback: SnapNodeBounds,
): SnapNodeBounds {
  if (!session || session.draggedId !== draggedId || !session.multi) return fallback;
  const dx = x - session.originX;
  const dy = y - session.originY;
  const nodes = useCanvasStore.getState().nodes
    .filter((node) => session?.nodeStarts.has(node.id))
    .map((node) => {
      const start = session!.nodeStarts.get(node.id)!;
      return { left: start.x + dx, right: start.x + dx + node.width, top: start.y + dy, bottom: start.y + dy + (node.height || 30) };
    });
  if (nodes.length === 0) return fallback;
  const left = Math.min(...nodes.map((node) => Math.min(node.left, node.right)));
  const right = Math.max(...nodes.map((node) => Math.max(node.left, node.right)));
  const top = Math.min(...nodes.map((node) => Math.min(node.top, node.bottom)));
  const bottom = Math.max(...nodes.map((node) => Math.max(node.top, node.bottom)));
  return {
    id: draggedId,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    excludeIds: Array.from(session.nodeStarts.keys()),
  };
}

export function multiDragEnd(draggedId: string, x: number, y: number): void {
  if (!session || session.draggedId !== draggedId) {
    useCanvasStore.getState().updateNode(draggedId, { x, y });
    session = null;
    return;
  }

  const dx = x - session.originX;
  const dy = y - session.originY;
  const canvas = useCanvasStore.getState();

  if (!session.multi) {
    canvas.updateNode(draggedId, { x, y });
    session = null;
    return;
  }

  for (const [id, start] of session.nodeStarts) {
    canvas.updateNodeSilent(id, { x: start.x + dx, y: start.y + dy });
  }

  if (session.strokeStarts.size > 0) {
    useDrawStore.getState().moveStrokesSilent(
      Array.from(session.strokeStarts.keys()),
      dx,
      dy,
      session.strokeStarts,
    );
  }

  undoBatchEnd();
  session = null;
}

export function multiDragCancel(): void {
  if (session?.multi) {
    undoBatchEnd();
  }
  session = null;
}
