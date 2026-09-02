import { useMemo } from 'react';
import { Line, Circle, Rect, Shape } from 'react-konva';
import type { Stroke } from '../../types/data';
import { buildInProgressInkOutline, buildInkOutline } from '../../utils/inkOutline';

interface DrawingLayerProps {
  strokes: Stroke[];
  selectedStrokeIds: string[];
  pendingEraseIds: string[];
  inProgressPoints: number[] | null;
  inProgressPressures: number[] | null;
  inProgressColor: string;
  inProgressWidth: number;
  eraserPos: { x: number; y: number; radius: number } | null;
  penCursorPos: { x: number; y: number } | null;
  penColor: string;
  penWidth: number;
  lassoRect: { x: number; y: number; w: number; h: number } | null;
}

/** Draw an outline with quadratic curves through each pair of vertex midpoints. */
function FreehandOutline({
  points,
  color,
  opacity = 1,
}: {
  points: number[];
  color: string;
  opacity?: number;
}) {
  return (
    <Shape
      name="freehand-outline"
      fill={color}
      opacity={opacity}
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(context, shape) => {
        // buildInkOutline repeats its first vertex to make closure explicit;
        // omit it here because the midpoint loop closes the path itself.
        const vertexCount = points.length / 2 - 1;
        if (vertexCount < 3) return;
        const pointAt = (index: number) => [points[index * 2], points[index * 2 + 1]];
        const [lastX, lastY] = pointAt(vertexCount - 1);
        const [firstX, firstY] = pointAt(0);
        context.beginPath();
        context.moveTo((lastX + firstX) / 2, (lastY + firstY) / 2);
        for (let index = 0; index < vertexCount; index++) {
          const [x, y] = pointAt(index);
          const [nextX, nextY] = pointAt((index + 1) % vertexCount);
          context.quadraticCurveTo(x, y, (x + nextX) / 2, (y + nextY) / 2);
        }
        context.closePath();
        context.fillStrokeShape(shape);
      }}
    />
  );
}

/** One committed outline. Strokes are immutable between edits, so memoise it. */
function CommittedStroke({ stroke, opacity = 1 }: { stroke: Stroke; opacity?: number }) {
  const outline = useMemo(
    () => buildInkOutline(stroke.points, stroke.pressures, stroke.strokeWidth),
    [stroke.points, stroke.pressures, stroke.strokeWidth],
  );

  return outline ? <FreehandOutline points={outline} color={stroke.color} opacity={opacity} /> : null;
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
  penCursorPos,
  penColor,
  penWidth,
  lassoRect,
}: DrawingLayerProps) {
  const selectedSet = new Set(selectedStrokeIds);
  const pendingSet = new Set(pendingEraseIds);
  const selectedStrokes = strokes.filter((stroke) => selectedSet.has(stroke.id));
  const strokeBounds = selectedStrokes.reduce(
    (bounds, stroke) => {
      const pad = stroke.strokeWidth / 2;
      for (let i = 0; i < stroke.points.length; i += 2) {
        bounds.minX = Math.min(bounds.minX, stroke.points[i] - pad);
        bounds.minY = Math.min(bounds.minY, stroke.points[i + 1] - pad);
        bounds.maxX = Math.max(bounds.maxX, stroke.points[i] + pad);
        bounds.maxY = Math.max(bounds.maxY, stroke.points[i + 1] + pad);
      }
      return bounds;
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  // Live ink uses the same outline but leaves the tail unfixed until pointerup.
  const inProgressOutline =
    inProgressPoints
      ? buildInProgressInkOutline(inProgressPoints, inProgressPressures, inProgressWidth)
      : null;

  return (
    <>
      {/* A transparent Transformer target lets selected ink share the same
          selection box as nodes. It lives in canvas coordinates, not inside a
          drawing group, so the end-of-gesture affine transform can be applied
          directly to the stored points. */}
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
      {/* Committed strokes */}
      {strokes.map((stroke) => (
        <CommittedStroke key={stroke.id} stroke={stroke} opacity={pendingSet.has(stroke.id) ? 0.2 : 1} />
      ))}

      {/* Selected stroke highlights */}
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

      {/* In-progress stroke (while drawing) */}
      {inProgressOutline && <FreehandOutline points={inProgressOutline} color={inProgressColor} />}

      {/* Eraser cursor circle */}
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

      {/* Pen cursor dot — matches stroke size and color */}
      {penCursorPos && (
        <Circle
          x={penCursorPos.x}
          y={penCursorPos.y}
          radius={penWidth / 2}
          fill={penColor}
          opacity={0.7}
          listening={false}
        />
      )}

      {/* Lasso selection rectangle */}
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
