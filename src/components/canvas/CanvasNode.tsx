import { memo } from 'react';
import type { CanvasNode as CanvasNodeType } from '../../types/data';
import type { SnapGuide } from './SnapGuides';
import { TextNode } from './TextNode';
import { ImageNode } from './ImageNode';
import { ShapeNode } from './ShapeNode';
import { GanttNode } from './GanttNode';
import { DiagramNode } from './DiagramNode';

interface CanvasNodeProps {
  node: CanvasNodeType;
  isSelected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  stageScale: number;
  autoEdit?: boolean;
  onSnapChange: (lines: SnapGuide[]) => void;
}

/**
 * Memoised: a page re-renders on every selection, drag frame and store write,
 * and without this each one repaints every block on the page (and rebuilds its
 * HTML overlay), which is what made pages with many scrolls slow (REQ-CANVAS-046).
 * Every prop is stable unless that block itself changed.
 */
export const CanvasNode = memo(function CanvasNode({ node, isSelected, onSelect, stageScale, autoEdit, onSnapChange }: CanvasNodeProps) {
  switch (node.type) {
    case 'text':
      return (
        <TextNode
          node={node}
          isSelected={isSelected}
          onSelect={onSelect}
          stageScale={stageScale}
          autoEdit={autoEdit}
          onSnapChange={onSnapChange}
        />
      );
    case 'image':
      return (
        <ImageNode
          node={node}
          isSelected={isSelected}
          onSelect={onSelect}
          stageScale={stageScale}
          onSnapChange={onSnapChange}
        />
      );
    case 'shape':
      return (
        <ShapeNode
          node={node}
          isSelected={isSelected}
          onSelect={onSelect}
          stageScale={stageScale}
          onSnapChange={onSnapChange}
        />
      );
    case 'gantt':
      return (
        <GanttNode
          node={node}
          isSelected={isSelected}
          onSelect={onSelect}
          stageScale={stageScale}
          onSnapChange={onSnapChange}
        />
      );
    case 'diagram':
      return (
        <DiagramNode
          node={node}
          isSelected={isSelected}
          onSelect={onSelect}
          stageScale={stageScale}
          onSnapChange={onSnapChange}
        />
      );
    default:
      return null;
  }
});
