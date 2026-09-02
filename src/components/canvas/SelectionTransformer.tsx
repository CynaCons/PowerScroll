import { useRef, useEffect, useState } from 'react';
import { Transformer } from 'react-konva';
import type Konva from 'konva';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useHistoryStore } from '../../stores/useHistoryStore';
import { useDrawStore, type StrokeTransformMatrix } from '../../stores/useDrawStore';
import { MIN_TEXT_HEIGHT, MIN_TEXT_WIDTH } from '../../utils/pageLayout';
import type { TextNodeData } from '../../types/data';

interface SelectionTransformerProps {
  selectedNodeIds: string[];
  selectedStrokeIds: string[];
  stageRef: React.RefObject<Konva.Stage | null>;
}

const DESKTOP_ANCHOR_SIZE = 8;
const DESKTOP_PADDING_SINGLE = 2;
const DESKTOP_PADDING_MULTI = 6;
const TOUCH_ANCHOR_SIZE = 24;
const TOUCH_PADDING_SINGLE = 10;
const TOUCH_PADDING_MULTI = 16;
const STROKE_PROXY_ID = '__stroke-transform-proxy__';

const isCoarsePointer = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(pointer: coarse)').matches
  : false;

/** Selection transform for nodes and selected freehand ink. */
export function SelectionTransformer({ selectedNodeIds, selectedStrokeIds, stageRef }: SelectionTransformerProps) {
  const transformerRef = useRef<Konva.Transformer>(null);
  const strokeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const nodes = useCanvasStore((s) => s.nodes);
  const strokes = useDrawStore((s) => s.strokes);
  const [altDown, setAltDown] = useState(false);

  // Konva evaluates centeredScaling during a handle drag, so this is live.
  useEffect(() => {
    const down = (event: KeyboardEvent) => event.key === 'Alt' && setAltDown(true);
    const up = (event: KeyboardEvent) => event.key === 'Alt' && setAltDown(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const selected = selectedNodeIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is NonNullable<typeof node> => !!node);
  const hasUnsupported = selected.some((node) => node.type === 'diagram' || node.type === 'gantt');
  const hasResizableSelected = selectedStrokeIds.length > 0
    || selected.some((node) => node.type === 'image' || node.type === 'shape' || node.type === 'text');
  // Diagram and Gantt have bespoke internal layouts, so hiding anchors avoids
  // advertising a resize operation whose semantics have not been defined.
  const resizeEnabled = hasResizableSelected && !hasUnsupported;
  const forceRatio = selected.some((node) => node.type === 'text' || node.type === 'image');

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;
    if (selectedNodeIds.length === 0 && selectedStrokeIds.length === 0) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }
    // Single images retain their bespoke, aspect-locked widget.
    const only = selectedNodeIds.length === 1 ? nodes.find((node) => node.id === selectedNodeIds[0]) : undefined;
    if (selectedNodeIds.length === 1 && selectedStrokeIds.length === 0 && only?.type === 'image') {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    const targets: Konva.Node[] = [];
    for (const nodeId of selectedNodeIds) {
      const storeNode = nodes.find((node) => node.id === nodeId);
      if (storeNode?.type === 'shape') {
        const data = storeNode.data as { shapeType?: string };
        if (data.shapeType === 'arrow' || data.shapeType === 'line') continue;
      }
      const group: Konva.Node | null | undefined = stage.findOne(`#${nodeId}`)?.parent;
      if (group && group !== stage) targets.push(group);
    }
    if (selectedStrokeIds.length > 0) {
      const proxy = stage.findOne(`#${STROKE_PROXY_ID}`);
      if (proxy) targets.push(proxy);
    }
    transformer.nodes(targets);
    transformer.getLayer()?.batchDraw();
    const raf = requestAnimationFrame(() => {
      // A delete/page switch can destroy a target between the effect and this
      // deferred refresh. Konva's Transformer assumes every target survives.
      if (!transformer.getStage() || transformer.nodes().some((node) => !node.getStage())) return;
      transformer.forceUpdate();
      transformer.getLayer()?.batchDraw();
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedNodeIds, selectedStrokeIds, stageRef, nodes, strokes]);

  const handleTransformEnd = () => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;
    const canvas = useCanvasStore.getState();
    const draw = useDrawStore.getState();
    useHistoryStore.getState().batchStart();
    useHistoryStore.getState().record();
    try {
      for (const konvaNode of transformer.nodes()) {
        if (konvaNode.id() === STROKE_PROXY_ID) continue;
        const id = konvaNode.getAttr('nodeId') as string | undefined;
        const storeNode = id && canvas.nodes.find((node) => node.id === id);
        if (!storeNode) continue;
        const sx = Math.abs(konvaNode.scaleX());
        const sy = Math.abs(konvaNode.scaleY());
        const fontScale = forceRatio ? sx : Math.sqrt(sx * sy);
        const updates: Record<string, unknown> = {
          x: konvaNode.x(), y: konvaNode.y(),
          width: Math.max(1, storeNode.width * sx),
          height: Math.max(1, storeNode.height * sy),
        };
        if (storeNode.type === 'text') {
          const data = storeNode.data as TextNodeData;
          updates.width = Math.max(MIN_TEXT_WIDTH, storeNode.width * sx);
          updates.height = Math.max(MIN_TEXT_HEIGHT, storeNode.height * sy);
          updates.data = { ...data, fontSize: Math.max(1, data.fontSize * fontScale) };
        }
        if (storeNode.type === 'shape' || storeNode.type === 'image') {
          updates.data = { ...storeNode.data, rotation: konvaNode.rotation() };
        }
        konvaNode.scaleX(1);
        konvaNode.scaleY(1);
        canvas.updateNodeSilent(id!, updates);
      }

      const proxy = stage.findOne(`#${STROKE_PROXY_ID}`);
      if (proxy && selectedStrokeIds.length > 0) {
        // This transform is layer-relative, so viewport zoom/pan is excluded.
        const [a, b, c, d, e, f] = proxy.getTransform().getMatrix();
        const origin = strokeOriginRef.current ?? { x: proxy.x(), y: proxy.y() };
        const matrix: StrokeTransformMatrix = [
          a, b, c, d,
          e - a * origin.x - c * origin.y,
          f - b * origin.x - d * origin.y,
        ];
        draw.transformStrokes(selectedStrokeIds, matrix);
        proxy.scaleX(1);
        proxy.scaleY(1);
        proxy.rotation(0);
      }
    } finally {
      useHistoryStore.getState().batchEnd();
      strokeOriginRef.current = null;
    }
  };

  const isMultiSelect = selectedNodeIds.length + selectedStrokeIds.length > 1;
  const padding = isMultiSelect
    ? (isCoarsePointer ? TOUCH_PADDING_MULTI : DESKTOP_PADDING_MULTI)
    : (isCoarsePointer ? TOUCH_PADDING_SINGLE : DESKTOP_PADDING_SINGLE);
  const anchorSize = resizeEnabled ? (isCoarsePointer ? TOUCH_ANCHOR_SIZE : DESKTOP_ANCHOR_SIZE) : 0;
  const rotateEnabled = resizeEnabled && (selectedStrokeIds.length > 0
    || selected.some((node) => node.type === 'shape' || node.type === 'image'));

  return <Transformer
    key={resizeEnabled ? 'resize' : 'no-resize'} ref={transformerRef}
    borderStroke="#2563eb" borderStrokeWidth={isMultiSelect ? 2.5 : 1.5}
    borderDash={isMultiSelect ? [8, 4] : undefined} padding={padding}
    resizeEnabled={resizeEnabled} rotateEnabled={rotateEnabled}
    rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]} rotationSnapTolerance={5}
    anchorSize={anchorSize} anchorFill="#ffffff" anchorStroke="#2563eb"
    anchorStrokeWidth={1} anchorCornerRadius={2} keepRatio={forceRatio}
    shiftBehavior="default" centeredScaling={altDown}
    onTransformStart={() => {
      const proxy = stageRef.current?.findOne(`#${STROKE_PROXY_ID}`);
      strokeOriginRef.current = proxy ? { x: proxy.x(), y: proxy.y() } : null;
    }}
    onTransformEnd={handleTransformEnd}
  />;
}
