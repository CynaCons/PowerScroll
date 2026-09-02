import { getStroke, getStrokePoints, type StrokePoint } from 'perfect-freehand';
import type { Stroke } from '../types/data';

/**
 * Shared perfect-freehand tuning for every freehand stroke. There is no
 * length-relative taper: round caps keep the start of a long stroke as wide
 * as its middle. `sizeMultiplier` keeps the stored stroke width calibrated:
 * with thinning .5, pressure .5 produces an outline exactly `strokeWidth`
 * wide.
 */
export const INK_OPTIONS = {
  sizeMultiplier: 1,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  start: { cap: true, taper: 0 },
  end: { cap: true, taper: 0 },
} as const;

function hasRecordedPressure(points: number[], pressures: number[] | null | undefined): pressures is number[] {
  return Boolean(pressures?.length) && pressures!.length * 2 === points.length;
}

function strokeInput(points: number[], pressures: number[] | null | undefined) {
  const recorded = hasRecordedPressure(points, pressures);
  return Array.from({ length: points.length / 2 }, (_, index) => {
    const x = points[index * 2];
    const y = points[index * 2 + 1];
    return recorded ? [x, y, pressures[index]] : [x, y];
  });
}

const roundPressure = (pressure: number) => Math.round(pressure * 1_000) / 1_000;

/**
 * Match perfect-freehand's pressure simulation for the already streamlined
 * points. This is intentionally kept here rather than relying on render-time
 * state, so cutting a baked stroke cannot restart its pressure calculation.
 */
function simulatedPressures(points: StrokePoint[], size: number): number[] {
  const simulate = (previous: number, distance: number) => {
    const sp = Math.min(1, distance / size);
    const rp = Math.min(1, 1 - sp);
    return Math.min(1, previous + (rp - previous) * (sp * 0.275));
  };
  let previous = points.slice(0, 10).reduce(
    (average, point) => (average + simulate(average, point.distance)) / 2,
    points[0].pressure,
  );
  const totalLength = points[points.length - 1]?.runningLength ?? 0;

  return points.map((point, index) => {
    // getStrokeOutlinePoints omits near-tail non-final points. Their pressure
    // cannot affect the outline, but retaining the prior value keeps the
    // stored pressure list complete and parallel to points.
    if (index !== points.length - 1 && totalLength - point.runningLength < 3) {
      return roundPressure(previous);
    }
    previous = simulate(previous, point.distance);
    return roundPressure(previous);
  });
}

/**
 * Freeze a raw stroke's streamlining and pressure state at commit time.
 * `last` is false for the live-to-committed handoff; legacy zone erasure uses
 * true to preserve its existing committed rendering exactly.
 */
export function bakeStroke(stroke: Stroke, last = false): Stroke {
  if (stroke.baked || stroke.points.length < 4 || stroke.points.length % 2 !== 0 || stroke.strokeWidth <= 0) {
    return stroke;
  }
  const size = stroke.strokeWidth * INK_OPTIONS.sizeMultiplier;
  const recorded = hasRecordedPressure(stroke.points, stroke.pressures);
  const bakedPoints = getStrokePoints(strokeInput(stroke.points, stroke.pressures), {
    ...INK_OPTIONS,
    size,
    last,
  });
  if (bakedPoints.length < 2) return stroke;

  return {
    ...stroke,
    points: bakedPoints.flatMap(({ point }) => point),
    pressures: recorded
      ? bakedPoints.map(({ pressure }) => roundPressure(pressure))
      : simulatedPressures(bakedPoints, size),
    baked: true,
  };
}

function buildOutline(
  points: number[],
  pressures: number[] | null | undefined,
  strokeWidth: number,
  last: boolean,
  baked = false,
): number[] | null {
  if (points.length < 4 || points.length % 2 !== 0 || strokeWidth <= 0) return null;

  const recorded = hasRecordedPressure(points, pressures);
  const input = strokeInput(points, pressures);
  const outline = getStroke(input, {
    ...INK_OPTIONS,
    size: strokeWidth * INK_OPTIONS.sizeMultiplier,
    streamline: baked ? 0 : INK_OPTIONS.streamline,
    simulatePressure: baked ? false : !recorded,
    last,
  });

  if (outline.length < 3) return null;
  const flat = outline.flat();
  // Keep the function's closed flat-polygon contract explicit for non-Konva
  // consumers as well as the closed Shape renderer.
  flat.push(outline[0][0], outline[0][1]);
  return flat;
}

/** Build a closed, committed freehand outline. */
export function buildInkOutline(
  points: number[],
  pressures: number[] | null | undefined,
  strokeWidth: number,
  baked = false,
): number[] | null {
  return buildOutline(points, pressures, strokeWidth, true, baked);
}

/** Build a live outline without fixing the tail to the latest pointer sample. */
export function buildInProgressInkOutline(
  points: number[],
  pressures: number[] | null | undefined,
  strokeWidth: number,
): number[] | null {
  return buildOutline(points, pressures, strokeWidth, false);
}
