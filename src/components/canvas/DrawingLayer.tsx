import { useMemo } from 'react';
import { Line, Circle, Rect } from 'react-konva';
import type { Stroke } from '../../types/data';
import { buildInkOutline } from '../../utils/inkOutline';

interface DrawingLayerProps {
  strokes: Stroke[];
  selectedStrokeIds: string[];
  pendingEraseIds: string[];
  inProgressPoints: number[] | null;
  inProgressPressures: number[] | null;
  inProgressColor: string;
  inProgressWidth: number;
  eraserPos: { x: number; y: number; radius: number } | null;
  lassoRect: { x: number; y: number; w: number; h: number } | null;
}

function StrokeLine({
  points,
  pressures,
  color,
  strokeWidth,
  opacity = 1,
  legacyBaked = false,
}: {
  points: number[];
  pressures?: number[] | null;
  color: string;
  strokeWidth: number;
  opacity?: number;
  legacyBaked?: boolean;
}) {
  const outline = useMemo(
    () => !legacyBaked && pressures ? buildInkOutline(points, pressures, strokeWidth) : null,
    [legacyBaked, points, pressures, strokeWidth],
  );

  if (outline) {
    return (
      <Line
        name="stroke-group"
        points={outline}
        closed
        fill={color}
        stroke={color}
        strokeWidth={1}
        lineJoin="round"
        listening={false}
        perfectDrawEnabled={false}
        opacity={opacity}
      />
    );
  }

  return (
    <Line
      name="stroke-group"
      points={points}
      stroke={color}
      strokeWidth={strokeWidth}
      tension={0.3}
      lineCap="round"
      lineJoin="round"
      globalCompositeOperation="source-over"
      listening={false}
      opacity={opacity}
    />
  );
}

function CommittedStroke({ stroke, opacity = 1 }: { stroke: Stroke; opacity?: number }) {
  return (
    <StrokeLine
      points={stroke.points}
      pressures={stroke.pressures}
      color={stroke.color}
      strokeWidth={stroke.strokeWidth}
      opacity={opacity}
      legacyBaked={stroke.baked === true}
    />
  );
}

export function DrawingLayer({
  strokes,
  selectedStrokeIds,
  pendingEraseIds,
  inProgressPoints,
  inProgressPressures,
  inProgressColor,
  inProgressWidth,
  eraserPos,
  lassoRect,
}: DrawingLayerProps) {
  const selectedSet = new Set(selectedStrokeIds);
  const pendingSet = new Set(pendingEraseIds);
  const selectedStrokes = strokes.filter((stroke) => selectedSet.has(stroke.id));
  const strokeBounds = selectedStrokes.reduce(
    (bounds, stroke) => {
      const pad = stroke.strokeWidth / 2;
      for (let index = 0; index < stroke.points.length; index += 2) {
        bounds.minX = Math.min(bounds.minX, stroke.points[index] - pad);
        bounds.minY = Math.min(bounds.minY, stroke.points[index + 1] - pad);
        bounds.maxX = Math.max(bounds.maxX, stroke.points[index] + pad);
        bounds.maxY = Math.max(bounds.maxY, stroke.points[index + 1] + pad);
      }
      return bounds;
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  return (
    <>
      {selectedStrokes.length > 0 && Number.isFinite(strokeBounds.minX) && (
        <Rect
          id="__stroke-transform-proxy__"
          x={strokeBounds.minX}
          y={strokeBounds.minY}
          width={Math.max(1, strokeBounds.maxX - strokeBounds.minX)}
          height={Math.max(1, strokeBounds.maxY - strokeBounds.minY)}
          opacity={0}
          listening={false}
        />
      )}

      {strokes.map((stroke) => (
        <CommittedStroke
          key={stroke.id}
          stroke={stroke}
          opacity={(stroke.opacity ?? 1) * (pendingSet.has(stroke.id) ? 0.2 : 1)}
        />
      ))}

      {selectedStrokes.map((stroke) => (
        <Line
          key={`sel-${stroke.id}`}
          points={stroke.points}
          stroke="#2563eb"
          strokeWidth={stroke.strokeWidth + 4}
          tension={0.3}
          lineCap="round"
          lineJoin="round"
          opacity={0.3}
          listening={false}
        />
      ))}

      {inProgressPoints && inProgressPoints.length >= 4 && (
        <StrokeLine
          points={inProgressPoints}
          pressures={inProgressPressures}
          color={inProgressColor}
          strokeWidth={inProgressWidth}
        />
      )}

      {eraserPos && (
        <Circle
          x={eraserPos.x}
          y={eraserPos.y}
          radius={eraserPos.radius}
          fill="rgba(255,255,255,0.5)"
          stroke="#94a3b8"
          strokeWidth={1}
          listening={false}
        />
      )}

      {lassoRect && (
        <Rect
          x={lassoRect.x}
          y={lassoRect.y}
          width={lassoRect.w}
          height={lassoRect.h}
          fill="rgba(37,99,235,0.08)"
          stroke="#2563eb"
          strokeWidth={1}
          dash={[6, 4]}
          listening={false}
        />
      )}
    </>
  );
}
