import { useRef, useEffect, useState } from 'react';
import { Group, Rect, Circle, Text, Image as KonvaImage } from 'react-konva';
import { Html } from 'react-konva-utils';
import type Konva from 'konva';
import type { CanvasNode, ImageNodeData } from '../../types/data';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useToolStore } from '../../stores/useToolStore';
import { isNodeInteractive } from '../../utils/toolConfig';
import { generateId } from '../../utils/ids';
import { multiDragStart, multiDragMove, multiDragEnd } from '../../utils/multiDrag';
import { calculateSnap, type SnapLine } from './SnapGuides';

interface ImageNodeProps {
  node: CanvasNode;
  isSelected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  stageScale: number;
  onSnapChange: (lines: SnapLine[]) => void;
}

export function ImageNode({ node, isSelected, onSelect, stageScale, onSnapChange }: ImageNodeProps) {
  const data = node.data as ImageNodeData;
  const groupRef = useRef<Konva.Group>(null);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const activeTool = useToolStore((s) => s.activeTool);
  const isInteractive = isNodeInteractive(activeTool);

  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.onerror = () => setImage(null);
    img.src = data.src;
  }, [data.src]);

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    // Ctrl+Alt+drag: duplicate the node, drag the duplicate
    if ((e.evt.ctrlKey || e.evt.metaKey) && e.evt.altKey) {
      const duplicate: CanvasNode = {
        ...node,
        id: generateId(),
        data: { ...node.data },
      };
      useCanvasStore.getState().addNode(duplicate);
    }
    multiDragStart(node.id, e.target.x(), e.target.y());
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    multiDragMove(node.id, e.target.x(), e.target.y(), e.target.getStage());
    if (!e.evt.shiftKey) {
      onSnapChange([]);
      return;
    }
    const allNodes = useCanvasStore.getState().nodes;
    const draggedBounds = {
      id: node.id,
      x: e.target.x(),
      y: e.target.y(),
      width: node.width,
      height: node.height,
    };
    const snap = calculateSnap(draggedBounds, allNodes);
    onSnapChange(snap.lines);
    e.target.x(snap.x);
    e.target.y(snap.y);
    multiDragMove(node.id, snap.x, snap.y, e.target.getStage());
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onSnapChange([]);
    multiDragEnd(node.id, e.target.x(), e.target.y());
  };

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    const tool = useToolStore.getState().activeTool;
    if (tool === 'select' || tool === 'text' || tool === 'image') {
      const additive = e.evt.ctrlKey || e.evt.metaKey;
      onSelect(node.id, additive);
      // Konva only fires click when no drag occurred (REQ-IMAGE-019).
      if (data.mini) {
        useCanvasStore.getState().openLightbox(node.id);
      }
    }
  };

  const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    const tool = useToolStore.getState().activeTool;
    if (tool === 'select' || tool === 'text' || tool === 'image') {
      useCanvasStore.getState().openLightbox(node.id);
    }
  };

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
  };

  // Calculate crop parameters for Konva
  const crop = data.crop;
  const cropConfig = crop && image ? {
    crop: {
      x: crop.x * data.naturalWidth,
      y: crop.y * data.naturalHeight,
      width: crop.width * data.naturalWidth,
      height: crop.height * data.naturalHeight,
    },
  } : {};

  return (
    <Group
      ref={groupRef}
      nodeId={node.id}
      x={node.x}
      y={node.y}
      rotation={data.rotation || 0}
      draggable={isInteractive}
      listening={isInteractive}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => { if (isInteractive) setHovered(true); }}
      onMouseLeave={() => { if (isInteractive) setHovered(false); }}
    >
      {/* Hit area */}
      <Rect
        id={node.id}
        x={0}
        y={0}
        width={node.width}
        height={node.height}
        fill="transparent"
        onClick={handleClick}
        onTap={handleClick}
        onDblClick={handleDblClick}
        onDblTap={handleDblClick}
      />

      {/* The actual image with optional crop */}
      {image && (
        <KonvaImage
          image={image}
          x={0}
          y={0}
          width={node.width}
          height={node.height}
          {...cropConfig}
          listening={false}
        />
      )}

      {/* Placeholder while loading */}
      {!image && (
        <Rect
          x={0}
          y={0}
          width={node.width}
          height={node.height}
          fill="#f3f4f6"
          stroke="#d1d5db"
          strokeWidth={1}
          dash={[4, 4]}
          cornerRadius={4}
          listening={false}
        />
      )}

      {/* Selection border + resize handles */}
      {isSelected && (
        <>
          <Rect
            x={-2}
            y={-2}
            width={node.width + 4}
            height={node.height + 4}
            stroke="#2563eb"
            strokeWidth={1.5}
            fill="transparent"
            dash={[6, 3]}
            listening={false}
          />
          {/* Corner resize handles */}
          {[
            { cx: 0, cy: 0, cursor: 'nw-resize', anchor: 'tl' },
            { cx: node.width, cy: 0, cursor: 'ne-resize', anchor: 'tr' },
            { cx: 0, cy: node.height, cursor: 'sw-resize', anchor: 'bl' },
            { cx: node.width, cy: node.height, cursor: 'se-resize', anchor: 'br' },
          ].map(({ cx, cy, cursor, anchor }) => (
            <Rect
              key={anchor}
              x={cx - 5}
              y={cy - 5}
              width={10}
              height={10}
              fill="#ffffff"
              stroke="#2563eb"
              strokeWidth={1}
              cornerRadius={2}
              onMouseEnter={(e) => { e.target.getStage()!.container().style.cursor = cursor; }}
              onMouseLeave={(e) => { e.target.getStage()!.container().style.cursor = 'default'; }}
              draggable
              onDragMove={(e) => {
                e.cancelBubble = true;
                const handle = e.target;
                const hx = handle.x() + 5;
                const hy = handle.y() + 5;

                let newW = node.width;
                let newH = node.height;
                let newX = node.x;
                let newY = node.y;

                if (anchor === 'br') {
                  newW = Math.max(30, hx);
                  newH = Math.max(30, hy);
                } else if (anchor === 'bl') {
                  const dx = hx;
                  newW = Math.max(30, node.width - dx);
                  newX = node.x + (node.width - newW);
                  newH = Math.max(30, hy);
                } else if (anchor === 'tr') {
                  newW = Math.max(30, hx);
                  const dy = hy;
                  newH = Math.max(30, node.height - dy);
                  newY = node.y + (node.height - newH);
                } else if (anchor === 'tl') {
                  const dx = hx;
                  const dy = hy;
                  newW = Math.max(30, node.width - dx);
                  newH = Math.max(30, node.height - dy);
                  newX = node.x + (node.width - newW);
                  newY = node.y + (node.height - newH);
                }

                // Keep aspect ratio
                const aspect = node.width / node.height;
                if (newW / newH > aspect) {
                  newW = newH * aspect;
                } else {
                  newH = newW / aspect;
                }

                updateNode(node.id, { x: newX, y: newY, width: newW, height: newH });

                // Reset handle to corner position (it will re-render)
                handle.x(anchor.includes('r') ? newW - 5 : -5);
                handle.y(anchor.includes('b') ? newH - 5 : -5);
              }}
              onDragEnd={(e) => { e.cancelBubble = true; }}
            />
          ))}
        </>
      )}

      {/* Note "T" icon — shown when image has a note OR is selected/hovered */}
      {(data.note !== undefined || isSelected || hovered) && data.note !== undefined && (
        <Group
          x={node.width + 4}
          y={node.height / 2 - 10}
        >
          <Circle
            radius={10 / stageScale}
            fill={editingNote ? '#2563eb' : 'rgba(37, 99, 235, 0.6)'}
            stroke="#ffffff"
            strokeWidth={1 / stageScale}
            onClick={(e) => {
              e.cancelBubble = true;
              if (isSelected) setEditingNote(!editingNote);
            }}
          />
          <Text
            x={-4 / stageScale}
            y={-5 / stageScale}
            text="T"
            fontSize={10 / stageScale}
            fill="#ffffff"
            fontStyle="bold"
            listening={false}
          />
        </Group>
      )}

      {/* Note popup — shown on hover or when selected */}
      {data.note && (isSelected || hovered) && !editingNote && (
        <Html groupProps={{ x: node.width + 20, y: node.height / 2 - 15 }}>
          <div
            style={{
              background: '#1e293b',
              color: '#f8fafc',
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 12,
              maxWidth: 200,
              whiteSpace: 'pre-wrap',
              pointerEvents: 'none',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            }}
          >
            {data.note}
          </div>
        </Html>
      )}

      {/* Note inline editor */}
      {editingNote && isSelected && (
        <Html groupProps={{ x: node.width + 20, y: node.height / 2 - 20 }}>
          <textarea
            autoFocus
            defaultValue={data.note || ''}
            style={{
              background: '#ffffff',
              border: '1px solid #2563eb',
              borderRadius: 6,
              padding: '6px 8px',
              fontSize: 12,
              width: 180,
              minHeight: 60,
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'inherit',
            }}
            onBlur={(e) => {
              const val = e.target.value.trim();
              updateNode(node.id, {
                data: { ...data, note: val || undefined },
              });
              setEditingNote(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
              if (e.key === 'Escape') {
                setEditingNote(false);
              }
            }}
          />
        </Html>
      )}
    </Group>
  );
}
