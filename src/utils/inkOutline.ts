import { getStroke } from 'perfect-freehand';

/**
 * Shared perfect-freehand tuning for every freehand stroke. `sizeMultiplier`
 * keeps the stored stroke width calibrated: with thinning .5, pressure .5
 * produces an outline exactly `strokeWidth` wide.
 */
export const INK_OPTIONS = {
  sizeMultiplier: 1,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  start: { taper: true },
  end: { taper: true },
} as const;

function buildOutline(
  points: number[],
  pressures: number[] | null | undefined,
  strokeWidth: number,
  last: boolean,
): number[] | null {
  if (points.length < 4 || points.length % 2 !== 0 || strokeWidth <= 0) return null;

  const hasRecordedPressure = Boolean(pressures?.length) && pressures!.length * 2 === points.length;
  const input = Array.from({ length: points.length / 2 }, (_, index) => {
    const x = points[index * 2];
    const y = points[index * 2 + 1];
    return hasRecordedPressure ? [x, y, pressures![index]] : [x, y];
  });
  const outline = getStroke(input, {
    ...INK_OPTIONS,
    size: strokeWidth * INK_OPTIONS.sizeMultiplier,
    simulatePressure: !hasRecordedPressure,
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
): number[] | null {
  return buildOutline(points, pressures, strokeWidth, true);
}

/** Build a live outline without fixing the tail to the latest pointer sample. */
export function buildInProgressInkOutline(
  points: number[],
  pressures: number[] | null | undefined,
  strokeWidth: number,
): number[] | null {
  return buildOutline(points, pressures, strokeWidth, false);
}
