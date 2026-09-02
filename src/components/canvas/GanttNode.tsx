import { useMemo } from 'react';
import { Group, Rect } from 'react-konva';
import type Konva from 'konva';
import { Html } from 'react-konva-utils';
import type { CanvasNode as CanvasNodeType, GanttNodeData } from '../../types/data';
import { GanttRenderer, blankDocument, validateDocument } from '../../vendor/powerplanner/embed';
import type { GanttDocument } from '../../vendor/powerplanner/embed';
import { multiDragStart, multiDragMove, multiDragEnd } from '../../utils/multiDrag';
import type { SnapGuide } from './SnapGuides';

interface GanttNodeProps {
  node: CanvasNodeType;
  isSelected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  stageScale: number;
  onSnapChange: (lines: SnapGuide[]) => void;
}

/**
 * Renders a PowerPlanner Gantt chart inside a PowerScroll canvas node.
 *
 * The chart document lives in `node.data.doc` and is rendered by the
 * vendored read-only renderer. Konva handles selection, drag, and resize;
 * we just render into an Html portal sized to the node's bounding box.
 */
export function GanttNode({ node, isSelected, onSelect, onSnapChange }: GanttNodeProps) {
  const data = node.data as GanttNodeData;

  // Validate (or fall back to blank) once per doc reference change.
  const doc = useMemo<GanttDocument>(() => {
    try {
      return validateDocument(data.doc);
    } catch {
      // If the payload is missing or malformed, render a blank chart.
      return blankDocument('Untitled chart');
    }
  }, [data.doc]);

  const handleClick = (e: Konva.KonvaEventObject<Event>) => {
    const evt = e.evt as MouseEvent;
    onSelect(node.id, evt.shiftKey || evt.metaKey || evt.ctrlKey);
  };

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    multiDragStart(node.id, e.target.x(), e.target.y());
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    multiDragMove(node.id, e.target.x(), e.target.y(), e.target.getStage());
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    multiDragEnd(node.id, e.target.x(), e.target.y());
    onSnapChange([]);
  };

  return (
    <Group
      x={node.x}
      y={node.y}
      draggable
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onTap={handleClick}
    >
      {/* Konva hit area + selection chrome */}
      <Rect
        id={node.id}
        x={0}
        y={0}
        width={node.width}
        height={node.height}
        fill="transparent"
        stroke={isSelected ? '#818cf8' : 'transparent'}
        strokeWidth={isSelected ? 1.5 : 0}
        cornerRadius={8}
      />
      {/* Embedded Gantt renderer */}
      <Html
        groupProps={{ x: 0, y: 0 }}
        divProps={{
          style: {
            pointerEvents: 'none',
            width: node.width,
            height: node.height,
            overflow: 'hidden',
            borderRadius: 8,
            background: '#0b0c0f',
          },
        }}
      >
        <div style={{ width: node.width, height: node.height, pointerEvents: 'none' }}>
          <GanttRenderer
            document={doc}
            width={node.width}
            height={node.height}
            options={{
              showCriticalPath: data.showCriticalPath ?? false,
              themeOverride: data.theme && data.theme !== 'auto' ? data.theme : 'dark',
            }}
          />
        </div>
      </Html>
    </Group>
  );
}
