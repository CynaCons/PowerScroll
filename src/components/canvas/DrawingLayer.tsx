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
  penCursorPos: { x: number; y: number } | null;
  penColor: string;
  penWidth: number;
  lassoRect: { x: number; y: number; w: number; h: number } | null;
}

/**
 * One committed stroke. A pressure stroke (stylus, REQ-DRAW-011) renders as
 * a closed filled ribbon whose width follows the recorded pressure; anything
 * without pressures — mouse, finger, every pre-v0.42 stroke — stays the
 * constant-width Line it always was. The outline is memoised: strokes are
 * immutable between edits, so it computes once, not per frame.
 */
function CommittedStroke({ stroke, opacity = 1 }: { stroke: Stroke; opacity?: number }) {
  const outline = useMemo(
    () =>
      stroke.pressures
        ? buildInkOutline(stroke.points, stroke.pressures, stroke.strokeWidth)
        : null,
    [stroke.points, stroke.pressures, stroke.strokeWidth],
  );

  if (outline) {
    return (
      <Line
        points={outline}
        closed
        fill={stroke.color}
        stroke={stroke.color}
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
      points={stroke.points}
      stroke={stroke.color}
      strokeWidth={stroke.strokeWidth}
      tension={0.3}
      lineCap="round"
      lineJoin="round"
      globalCompositeOperation="source-over"
      listening={false}
      opacity={opacity}
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
  penCursorPos,
  penColor,
  penWidth,
  lassoRect,
}: DrawingLayerProps) {
  const selectedSet = new Set(selectedStrokeIds);
  const pendingSet = new Set(pendingEraseIds);

  // Live stylus ink previews with the same ribbon it will commit as —
  // pressure feedback that only appears on lift teaches nothing.
  const inProgressOutline =
    inProgressPoints &&
    inProgressPressures &&
    inProgressPressures.length * 2 === inProgressPoints.length
      ? buildInkOutline(inProgressPoints, inProgressPressures, inProgressWidth)
      : null;

  return (
    <>
      {/* Committed strokes */}
      {strokes.map((stroke) => (
        <CommittedStroke key={stroke.id} stroke={stroke} opacity={pendingSet.has(stroke.id) ? 0.2 : 1} />
      ))}

      {/* Selected stroke highlights */}
      {strokes
        .filter((s) => selectedSet.has(s.id))
        .map((stroke) => (
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
      {inProgressPoints && inProgressPoints.length >= 4 && (
        inProgressOutline ? (
          <Line
            points={inProgressOutline}
            closed
            fill={inProgressColor}
            stroke={inProgressColor}
            strokeWidth={1}
            lineJoin="round"
            listening={false}
            perfectDrawEnabled={false}
          />
        ) : (
          <Line
            points={inProgressPoints}
            stroke={inProgressColor}
            strokeWidth={inProgressWidth}
            tension={0.3}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        )
      )}

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
