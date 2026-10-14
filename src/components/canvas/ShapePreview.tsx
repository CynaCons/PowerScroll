import { useLayoutEffect, useRef } from 'react';
import { Arrow, Ellipse, Group, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useToolStore } from '../../stores/useToolStore';
import { BindingHint } from './BindingHint';

/**
 * A lightweight top canvas layer for shape creation. It alone subscribes to
 * per-pointermove preview state, keeping every CanvasNode out of that update.
 */
export function ShapePreview() {
  const groupRef = useRef<Konva.Group>(null);
  const preview = useToolStore((state) => state.shapePreview);
  const options = useToolStore((state) => state.shapeOptions);
  const bindingHint = useToolStore((state) => state.shapeBindingHint);
  const nodes = useCanvasStore((state) => state.nodes);
  const scale = useCanvasStore((state) => state.viewport.scale);

  const target = bindingHint
    ? nodes.find((node) => node.id === bindingHint.targetId)
    : undefined;
  const hasPreview = preview && (Math.abs(preview.w) > 2 || Math.abs(preview.h) > 2);

  // Text blocks are HTML portals at z-index 10. Lift this transparent Konva
  // canvas above them, so the preview is visible over every page-content type —
  // only while a shape is being dragged out, so the rest of the time clicks on
  // a text block still reach the block.
  const lifted = !!(hasPreview || target);
  useLayoutEffect(() => {
    if (!lifted) return;
    const canvas = groupRef.current?.getLayer()?.getCanvas()._canvas;
    if (!canvas) return;
    const { zIndex } = canvas.style;
    canvas.style.zIndex = '11';
    return () => {
      canvas.style.zIndex = zIndex;
    };
  }, [lifted]);

  const commonProps = {
    stroke: options.stroke,
    strokeWidth: options.strokeWidth,
    dash: [6, 4],
    fill: options.fill === 'transparent' ? undefined : options.fill,
    listening: false as const,
  };

  return (
    <Group ref={groupRef} name="shape-preview-layer" listening={false}>
      {hasPreview && options.shapeType === 'rect' && (
        <Rect name="shape-preview" x={preview.x} y={preview.y} width={preview.w} height={preview.h} {...commonProps} />
      )}
      {hasPreview && options.shapeType === 'circle' && (
        <Ellipse name="shape-preview" x={preview.x + preview.w / 2} y={preview.y + preview.h / 2} radiusX={Math.abs(preview.w) / 2} radiusY={Math.abs(preview.h) / 2} {...commonProps} />
      )}
      {hasPreview && options.shapeType === 'triangle' && (
        <Line name="shape-preview" points={[preview.x + preview.w / 2, preview.y, preview.x + preview.w, preview.y + preview.h, preview.x, preview.y + preview.h]} closed {...commonProps} />
      )}
      {hasPreview && options.shapeType === 'diamond' && (
        <Line name="shape-preview" points={[preview.x + preview.w / 2, preview.y, preview.x + preview.w, preview.y + preview.h / 2, preview.x + preview.w / 2, preview.y + preview.h, preview.x, preview.y + preview.h / 2]} closed {...commonProps} />
      )}
      {hasPreview && options.shapeType === 'arrow' && (
        <Arrow name="shape-preview-arrow" points={[preview.x, preview.y, preview.x + preview.w, preview.y + preview.h]} stroke={options.stroke} fill={options.stroke} strokeWidth={options.strokeWidth} dash={[6, 4]} pointerLength={Math.max(8, options.strokeWidth * 3)} pointerWidth={Math.max(6, options.strokeWidth * 2.5)} listening={false} />
      )}
      {hasPreview && options.shapeType === 'line' && (
        <Line name="shape-preview" points={[preview.x, preview.y, preview.x + preview.w, preview.y + preview.h]} stroke={options.stroke} strokeWidth={options.strokeWidth} dash={[6, 4]} lineCap="round" listening={false} />
      )}
      {target && bindingHint && (
        <BindingHint target={target} point={bindingHint.point} scale={scale} offset={{ x: 0, y: 0 }} />
      )}
    </Group>
  );
}
