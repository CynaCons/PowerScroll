/**
 * The bridge between the pure pipeline and the canvas store.
 *
 * Kept out of the React component so the rules — where contents sit inside the
 * frame, what counts as a member, how the frame sizes itself — are testable and
 * reusable rather than tangled in render code.
 */

import type { CanvasNode, DiagramNodeData, DiagramRenderSnapshot } from '../types/data';
import { undoBatchStart, undoBatchEnd, useCanvasStore } from '../stores/useCanvasStore';
import { useHistoryStore } from '../stores/useHistoryStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useDrawStore } from '../stores/useDrawStore';
import { livePageLike } from '../utils/columnReflow';
import { planHeightChange } from '../bridge/reflow';
import { generateId } from '../utils/ids';
import { buildDiagram } from './index';
import type { DiagramFormat } from './index';
import type { Diagnostic } from './types';
import { fitDiagramToScroll, fitFrameToScroll } from './fitToScroll';
import { columnAt } from '../utils/pageLayout';

/** Space between the frame edge and its contents. */
export const FRAME_PAD = 20;
/** Title band across the top of the frame. */
export const FRAME_TITLE_H = 34;
export const FRAME_MIN_W = 260;
export const FRAME_MIN_H = 120;

/**
 * Members are the nodes carrying the frame's id as their groupId, excluding the
 * frame itself. Derived, never stored — drag a mark out of the group and it
 * stops being part of the diagram.
 */
export function diagramMembers(nodes: CanvasNode[], frameId: string): CanvasNode[] {
  return nodes.filter((n) => n.groupId === frameId && n.id !== frameId);
}

/**
 * A snapshot diagram displays a rendered image and owns no member nodes
 * (v0.64 invariant: `render` present ⇔ zero members). Everything that walks
 * members — fit, isolation, export tiers — branches on this.
 */
export function isSnapshotDiagram(node: CanvasNode): boolean {
  if (node.type !== 'diagram') return false;
  const data = node.data as DiagramNodeData;
  return data?.render != null;
}

export interface RebuildResult {
  /** Replacement contents. Empty when nothing could be understood. */
  contents: CanvasNode[];
  /** Frame size that fits those contents. */
  frame: { width: number; height: number };
  diagnostics: Diagnostic[];
  /** Placement-time fit scale. 1 when the diagram was not fitted. */
  scale?: number;
  /** Set when the diagram was scaled down to fit its scroll band. */
  warning?: string;
}

/**
 * Scale a rebuilt diagram to the scroll band its frame origin sits in.
 * Callers commit the returned contents; rebuildDiagram itself stays a pure
 * layout so a source that parses to nothing is still left alone.
 */
export function applyDiagramScrollFit(frame: CanvasNode, built: RebuildResult): RebuildResult {
  if (built.contents.length === 0) return { ...built, scale: 1 };
  const scrolls = useWorkspaceStore.getState().getActivePage()?.scrolls;
  const fitted = fitDiagramToScroll(
    { x: frame.x, y: frame.y, width: built.frame.width, height: built.frame.height },
    built.contents,
    scrolls,
  );
  return {
    contents: fitted.members,
    frame: fitted.frame,
    diagnostics: built.diagnostics,
    scale: fitted.scale,
    warning: fitted.warning,
  };
}

/**
 * Rebuilds a frame's contents from its source and sizes the frame to fit.
 *
 * Pure: it reads the frame's position and returns what should replace its
 * contents. The caller decides whether to commit, which is what lets a source
 * that parses to nothing leave the existing drawing alone.
 *
 * `format` is for a caller that was told the language. A redraw from the source
 * editor leaves it off so the grammar follows whatever the user typed, rather
 * than what the frame was first created from.
 */
export function rebuildDiagram(
  frame: CanvasNode,
  source: string,
  format?: DiagramFormat,
): RebuildResult {
  const built = buildDiagram(source, {
    groupId: frame.id,
    origin: { x: frame.x + FRAME_PAD, y: frame.y + FRAME_TITLE_H + FRAME_PAD },
    format,
  });

  if (built.nodes.length === 0 || !built.bounds) {
    return {
      contents: [],
      frame: { width: frame.width, height: frame.height },
      diagnostics: built.diagnostics,
    };
  }

  // The frame wraps whatever the layout produced, plus padding on every side.
  const width = Math.max(FRAME_MIN_W, Math.round(built.bounds.width + FRAME_PAD * 2));
  const height = Math.max(
    FRAME_MIN_H,
    Math.round(built.bounds.height + FRAME_TITLE_H + FRAME_PAD * 2),
  );

  return { contents: built.nodes, frame: { width, height }, diagnostics: built.diagnostics };
}

export interface PlaceDiagramOptions {
  x: number;
  y: number;
  source: string;
  title: string;
  format?: DiagramFormat;
}

export interface PlaceDiagramResult {
  frameId: string;
  placed: boolean;
  width: number;
  height: number;
  elementCount: number;
  diagnostics: Diagnostic[];
  /** Placement-time fit warning, when the diagram was scaled to a scroll. */
  warning?: string;
  /** How the diagram displays: an exact rendered image, or native member nodes. */
  renderMode?: 'snapshot' | 'nodes';
}

/**
 * Creates a diagram frame at (x, y) and commits its rebuilt contents.
 * Shared by the bridge `create_diagram` path and file drop/paste so the
 * frame shape, groupId, and resize rule cannot drift. An empty rebuild
 * leaves the canvas untouched — same contract as createDiagram.
 */
export function placeDiagramOnCanvas(opts: PlaceDiagramOptions): PlaceDiagramResult {
  const frameId = generateId();
  const frame: CanvasNode = {
    id: frameId,
    type: 'diagram',
    x: opts.x,
    y: opts.y,
    width: FRAME_MIN_W,
    height: FRAME_MIN_H,
    layer: 2,
    groupId: frameId,
    data: { source: opts.source, title: opts.title },
  };
  const built = applyDiagramScrollFit(frame, rebuildDiagram(frame, opts.source, opts.format));
  if (built.contents.length === 0) {
    return {
      frameId,
      placed: false,
      width: built.frame.width,
      height: built.frame.height,
      elementCount: 0,
      diagnostics: built.diagnostics,
      warning: built.warning,
    };
  }
  // One undo removes the whole diagram — frame plus members — not one node
  // per keypress of Ctrl+Z.
  const canvas = useCanvasStore.getState();
  undoBatchStart(canvas.nodes);
  canvas.addNode(frame);
  for (const content of built.contents) canvas.addNode(content);
  canvas.updateNode(frameId, {
    width: built.frame.width,
    height: built.frame.height,
  });
  undoBatchEnd();
  return {
    frameId,
    placed: true,
    width: built.frame.width,
    height: built.frame.height,
    elementCount: built.contents.length,
    diagnostics: built.diagnostics,
    warning: built.warning,
    renderMode: 'nodes',
  };
}

export interface PlaceDiagramSnapshotOptions {
  x: number;
  y: number;
  source: string;
  title: string;
  snapshot: DiagramRenderSnapshot;
}

/**
 * Creates a snapshot diagram: one frame, zero members, the rendered image in
 * `data.render`. Placement-time fit is shrink-only on the frame box — the
 * image follows the frame, so nothing else needs rescaling.
 */
export function placeDiagramSnapshotOnCanvas(opts: PlaceDiagramSnapshotOptions): PlaceDiagramResult {
  const frameId = generateId();
  const width = Math.max(FRAME_MIN_W, Math.round(opts.snapshot.naturalWidth + FRAME_PAD * 2));
  const height = Math.max(
    FRAME_MIN_H,
    Math.round(opts.snapshot.naturalHeight + FRAME_TITLE_H + FRAME_PAD * 2),
  );
  const scrolls = useWorkspaceStore.getState().getActivePage()?.scrolls;
  const fitted = fitFrameToScroll({ x: opts.x, y: opts.y, width, height }, scrolls);
  const frame: CanvasNode = {
    id: frameId,
    type: 'diagram',
    x: opts.x,
    y: opts.y,
    width: Math.round(fitted.width),
    height: Math.round(fitted.height),
    layer: 2,
    groupId: frameId,
    data: { source: opts.source, title: opts.title, render: opts.snapshot },
  };
  const canvas = useCanvasStore.getState();
  undoBatchStart(canvas.nodes);
  canvas.addNode(frame);
  undoBatchEnd();
  return {
    frameId,
    placed: true,
    width: frame.width,
    height: frame.height,
    elementCount: 0,
    diagnostics: [],
    warning: fitted.warning,
    renderMode: 'snapshot',
  };
}

/** Reads the source off a frame node, tolerating a node of the wrong type. */
export function diagramSourceOf(node: CanvasNode): string {
  const data = node.data as DiagramNodeData;
  return typeof data?.source === 'string' ? data.source : '';
}

export type FitExistingOutcome =
  | { ok: true; scale: number; width: number; height: number; warning?: string }
  | { ok: false; code: 'NOT_FOUND' | 'UNSUPPORTED' | 'PRECONDITION'; message: string };

/**
 * On-demand refit of an existing diagram to the band its frame sits in.
 * Scales UP to fill band-width − padding when under, and down with the
 * same 0.45 floor when over. Out-of-band frames are refused. One undo.
 */
export function fitExistingDiagram(frameId: string): FitExistingOutcome {
  const nodes = useCanvasStore.getState().nodes;
  const frame = nodes.find((n) => n.id === frameId);
  if (!frame) {
    return { ok: false, code: 'NOT_FOUND', message: `No diagram with id "${frameId}"` };
  }
  if (frame.type !== 'diagram') {
    return {
      ok: false,
      code: 'UNSUPPORTED',
      message: `"${frameId}" is a ${frame.type} node, not a diagram.`,
    };
  }

  const data = frame.data as DiagramNodeData;
  const title = typeof data?.title === 'string' && data.title.trim() ? data.title.trim() : frameId;
  const scrolls = useWorkspaceStore.getState().getActivePage()?.scrolls;
  const column = columnAt(frame.x, scrolls);
  const band = scrolls?.find((s) => s.column === column);
  if (!band) {
    return {
      ok: false,
      code: 'PRECONDITION',
      message: `Diagram "${title}" (${frameId}) is not inside a scroll band.`,
    };
  }

  const members = diagramMembers(nodes, frameId);
  // A snapshot frame has no members to rescale — the image tracks the frame
  // box, so its fit is the frame fit. Without this branch the member path
  // identity-returns on an empty list and "Fit to scroll width" does nothing.
  let fitted;
  if (isSnapshotDiagram(frame) && members.length === 0) {
    const frameFit = fitFrameToScroll(frame, scrolls, { allowGrow: true });
    fitted = {
      members: [] as CanvasNode[],
      frame: { width: frameFit.width, height: frameFit.height },
      scale: frameFit.scale,
      warning: frameFit.warning,
    };
  } else {
    fitted = fitDiagramToScroll(frame, members, scrolls, { allowGrow: true });
  }
  if (
    fitted.scale === 1 &&
    fitted.frame.width === frame.width &&
    fitted.frame.height === frame.height
  ) {
    return { ok: true, scale: 1, width: frame.width, height: frame.height };
  }

  const byId = new Map(fitted.members.map((m) => [m.id, m]));
  const page = livePageLike();
  const planned =
    page.columnFlow && Math.abs(fitted.frame.height - frame.height) >= 2
      ? planHeightChange(page, frameId, fitted.frame.height)
      : null;
  const shiftedNodes = planned && planned.ok ? planned.nextNodes : nodes;
  const nextNodes = shiftedNodes.map((n) => {
    if (n.id === frameId) {
      return { ...n, width: fitted.frame.width, height: fitted.frame.height };
    }
    return byId.get(n.id) ?? n;
  });

  if (planned && planned.ok && planned.dy !== 0) {
    useHistoryStore.getState().batchStart();
    useHistoryStore.getState().record();
    useCanvasStore.setState({ nodes: nextNodes });
    useDrawStore.setState({ strokes: planned.nextStrokes });
  } else {
    undoBatchStart(nodes);
    useHistoryStore.getState().record();
    useCanvasStore.setState({ nodes: nextNodes });
  }
  useWorkspaceStore.getState().markDirty();
  undoBatchEnd();

  return {
    ok: true,
    scale: fitted.scale,
    width: fitted.frame.width,
    height: fitted.frame.height,
    warning: fitted.warning,
  };
}

export type ConvertSnapshotOutcome =
  | { ok: true; memberCount: number; skipped: number }
  | { ok: false; message: string };

/**
 * "Convert to editable nodes": transpile a snapshot frame's stored source
 * into native members and drop the rendered image. The deliberate reverse of
 * the v0.64 default — for when someone wants to pull a drawing apart, at the
 * price of the transpiler's subset (gradients, curves, stencils are lost and
 * named in diagnostics). One undo restores the snapshot.
 */
export function convertSnapshotToNodes(frameId: string): ConvertSnapshotOutcome {
  const canvas = useCanvasStore.getState();
  const frame = canvas.nodes.find((n) => n.id === frameId);
  if (!frame || frame.type !== 'diagram') {
    return { ok: false, message: `No diagram with id "${frameId}"` };
  }
  if (!isSnapshotDiagram(frame)) {
    return { ok: false, message: 'This diagram already has editable nodes.' };
  }

  const source = diagramSourceOf(frame);
  const built = applyDiagramScrollFit(frame, rebuildDiagram(frame, source, 'drawio'));
  if (built.contents.length === 0) {
    const first = built.diagnostics.find((d) => d.severity === 'error')?.message;
    return { ok: false, message: `Nothing could be converted${first ? ` — ${first}` : '.'}` };
  }

  const oldHeight = frame.height;
  undoBatchStart(canvas.nodes);
  for (const content of built.contents) canvas.addNode(content);
  const { render: _render, ...dataRest } = frame.data as DiagramNodeData;
  canvas.updateNode(frameId, {
    width: built.frame.width,
    height: built.frame.height,
    data: dataRest,
  });
  // Column reflow when the frame height moved — same dance as the source
  // dialog's redraw, so converting cannot bury the blocks below it.
  if (Math.abs(built.frame.height - oldHeight) >= 2) {
    const page = livePageLike();
    const planned = planHeightChange(
      {
        ...page,
        nodes: page.nodes.map((n) => (n.id === frameId ? { ...n, height: oldHeight } : n)),
      },
      frameId,
      built.frame.height,
    );
    if (planned.ok && planned.dy !== 0) {
      useCanvasStore.setState({
        nodes: planned.nextNodes.map((n) =>
          n.id === frameId ? { ...n, height: built.frame.height, width: built.frame.width } : n,
        ),
      });
      useDrawStore.setState({ strokes: planned.nextStrokes });
    }
  }
  useWorkspaceStore.getState().markDirty();
  undoBatchEnd();

  return {
    ok: true,
    memberCount: built.contents.length,
    skipped: built.diagnostics.filter((d) => d.severity === 'error').length,
  };
}

export const STARTER_DIAGRAM = `@startuml
component "gateway" as gw {
  portin telemetry
  portout storage
  component "broker : MqttBroker [1]" as broker
  component "buffer : StoreForward [1..*]" as buffer
  broker --> buffer : Queue
  telemetry --> broker
  buffer --> storage
}
@enduml`;
