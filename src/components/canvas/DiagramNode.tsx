import { useEffect, useRef, useState } from 'react';
import { Group, Image as KonvaImage, Rect, Text } from 'react-konva';
import { Html } from 'react-konva-utils';
import type Konva from 'konva';
import type { CanvasNode, DiagramNodeData, DiagramRenderSnapshot } from '../../types/data';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useToolStore } from '../../stores/useToolStore';
import { useGroupStore } from '../../stores/useGroupStore';
import { useDrawStore } from '../../stores/useDrawStore';
import { useDiagramStore } from '../../stores/useDiagramStore';
import { isNodeInteractive } from '../../utils/toolConfig';
import { multiDragStart, multiDragMove, multiDragEnd, multiDragBounds } from '../../utils/multiDrag';
import { FRAME_PAD, FRAME_TITLE_H } from '../../diagram/canvasOps';
import { sniffFormat } from '../../diagram';
import { FORMAT_LABEL } from '../../diagram/formatLabels';
import { calculateObjectSnap, type SnapGuide } from './SnapGuides';
import './DiagramNode.css';

interface DiagramNodeProps {
  node: CanvasNode;
  isSelected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  stageScale: number;
  onSnapChange: (lines: SnapGuide[]) => void;
}

/**
 * Snapshot artwork inside the frame's content box, aspect-fitted and centred.
 * Sized from the FRAME, not the snapshot — "Fit to scroll width" resizes the
 * frame and the image must follow. Same hand-rolled loader as ImageNode: the
 * SVG data URI re-rasterizes crisply at any zoom (spike-verified).
 */
function SnapshotImage({
  render,
  frameWidth,
  frameHeight,
}: {
  render: DiagramRenderSnapshot;
  frameWidth: number;
  frameHeight: number;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.onerror = () => setImage(null);
    img.src = render.src;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [render.src]);

  const boxW = Math.max(0, frameWidth - FRAME_PAD * 2);
  const boxH = Math.max(0, frameHeight - FRAME_TITLE_H - FRAME_PAD * 2);
  if (boxW <= 0 || boxH <= 0) return null;
  const scale = Math.min(boxW / Math.max(1, render.naturalWidth), boxH / Math.max(1, render.naturalHeight));
  const w = render.naturalWidth * scale;
  const h = render.naturalHeight * scale;
  const x = FRAME_PAD + (boxW - w) / 2;
  const y = FRAME_TITLE_H + FRAME_PAD + (boxH - h) / 2;

  if (!image) {
    return (
      <Rect
        x={x}
        y={y}
        width={w}
        height={h}
        stroke="#C3CBC9"
        strokeWidth={1}
        dash={[6, 4]}
        listening={false}
      />
    );
  }
  return <KonvaImage image={image} x={x} y={y} width={w} height={h} listening={false} />;
}

/**
 * A diagram is a canvas object, like an image: selectable, draggable, deletable.
 * What makes it a diagram is that its contents are generated — ordinary shape
 * and text nodes carrying this node's id as their groupId, so they keep moving
 * with the frame through the existing group machinery while staying editable
 * one by one under double-click isolation.
 *
 * The source lives on the node, so it travels with the diagram through copy,
 * save and load without a side table to keep in step.
 */
export function DiagramNode({ node, isSelected, onSelect, stageScale, onSnapChange }: DiagramNodeProps) {
  const data = node.data as DiagramNodeData;
  const groupRef = useRef<Konva.Group>(null);

  const activeTool = useToolStore((s) => s.activeTool);
  const isInteractive = isNodeInteractive(activeTool);

  // Read from the source, not stored on the node: the source editor lets you
  // paste a different language over the old one, so a remembered format would
  // go stale the moment it mattered.
  const format = sniffFormat(data.source ?? '');
  const formatLabel = FORMAT_LABEL[format];

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    if (activeTool === 'select' || activeTool === 'text' || activeTool === 'image') {
      onSelect(node.id, e.evt.ctrlKey || e.evt.metaKey);
    }
  };

  const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    // A snapshot frame has no members — isolation would dim the page around
    // nothing editable. The source dialog is what "open this diagram" means.
    if (data.render) {
      useDiagramStore.getState().openSource(node.id);
      return;
    }
    useGroupStore.getState().enterIsolation(node.id);
    useCanvasStore.setState({ selectedNodeIds: [node.id] });
    useDrawStore.getState().selectStrokes([]);
  };


  return (
    <>
      <Group
        ref={groupRef}
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        draggable={isInteractive}
        listening={isInteractive}
        onDragStart={(e) => multiDragStart(node.id, e.target.x(), e.target.y())}
        onDragMove={(e) => {
          multiDragMove(node.id, e.target.x(), e.target.y(), e.target.getStage());
          const draggedBounds = multiDragBounds(node.id, e.target.x(), e.target.y(), {
            id: node.id,
            x: e.target.x(),
            y: e.target.y(),
            width: node.width,
            height: node.height,
          });
          const snap = calculateObjectSnap(draggedBounds, useCanvasStore.getState().nodes, {
            snapToObjects: useToolStore.getState().drawOptions.snapToObjects,
            shiftKey: e.evt.shiftKey,
            viewportScale: useCanvasStore.getState().viewport.scale,
          });
          const x = e.target.x() + snap.x - draggedBounds.x;
          const y = e.target.y() + snap.y - draggedBounds.y;
          onSnapChange(snap.lines);
          e.target.position({ x, y });
          multiDragMove(node.id, x, y, e.target.getStage());
        }}
        onDragEnd={(e) => multiDragEnd(node.id, e.target.x(), e.target.y())}
        onClick={handleClick}
        onTap={handleClick}
        onDblClick={handleDblClick}
        onDblTap={handleDblClick}
      >
        {/* Frame. Paper with a hairline so the tinted contents stay the figure.
            The id is what the right-click walk looks for — without it a diagram
            had no context menu at all, and so no way to change its layer. */}
        <Rect
          id={node.id}
          width={node.width}
          height={node.height}
          fill="#FFFFFF"
          stroke={isSelected ? '#2563eb' : '#C3CBC9'}
          strokeWidth={isSelected ? 2 / stageScale : 1}
          cornerRadius={8}
        />
        {/* Title band */}
        <Rect width={node.width} height={FRAME_TITLE_H} fill="#F3F5F4" cornerRadius={[8, 8, 0, 0]} />
        <Rect y={FRAME_TITLE_H} width={node.width} height={1} fill="#DCE1E0" />
        {data.render && (
          <SnapshotImage render={data.render} frameWidth={node.width} frameHeight={node.height} />
        )}
        <Text
          x={14}
          y={FRAME_TITLE_H / 2 - 7}
          text={data.title || 'Diagram'}
          fontSize={13}
          fontStyle="600"
          fontFamily="Inter, system-ui, sans-serif"
          fill="#14181A"
        />

        {/* The one control on the frame: the source behind it, named for the
            language it is actually written in. This used to read "plantuml" on
            every diagram, so an SVG or Mermaid frame said out loud that it was
            something it was not. */}
        {isInteractive && (
          <Html
            divProps={{ style: { pointerEvents: 'auto' } }}
            groupProps={{ x: node.width - (formatLabel.length * 7 + 30), y: 7 }}
          >
            <button
              type="button"
              className="diagram-node__src"
              data-testid={`diagram-source-btn-${node.id}`}
              data-format={format}
              title={`Show the ${formatLabel} this diagram was built from`}
              onClick={(e) => {
                e.stopPropagation();
                useDiagramStore.getState().openSource(node.id);
              }}
            >
              {formatLabel}
            </button>
          </Html>
        )}
      </Group>

    </>
  );
}
