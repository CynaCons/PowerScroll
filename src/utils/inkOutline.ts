/**
 * Variable-width ink rendering for real stylus pressure.
 *
 * A pressure stroke cannot be a Konva Line — Line has one strokeWidth. A pen
 * stroke is therefore drawn as a closed filled ribbon whose rim follows the
 * recorded centreline. Mouse, touch, and legacy baked strokes use a regular
 * constant-width Line instead.
 */

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Half-width in canvas px for one point: 0.3×..1.7× the base width. */
function halfWidth(pressure: number, baseWidth: number): number {
  const factor = 0.3 + 1.4 * clamp(pressure, 0, 1);
  return Math.max(0.35, (baseWidth * factor) / 2);
}

/**
 * Build the closed outline polygon for a pressure stroke. The three-point
 * pressure average is the pre-perfect-freehand behaviour and keeps digitizer
 * jitter out of the rim without changing the recorded input samples.
 */
export function buildInkOutline(
  points: number[],
  pressures: number[],
  baseWidth: number,
): number[] | null {
  const count = points.length / 2;
  if (count < 2 || pressures.length !== count) return null;

  const smooth = new Array<number>(count);
  for (let index = 0; index < count; index++) {
    const before = pressures[Math.max(0, index - 1)];
    const current = pressures[index];
    const after = pressures[Math.min(count - 1, index + 1)];
    smooth[index] = (before + current + after) / 3;
  }

  const left: number[] = [];
  const right: number[] = [];
  for (let index = 0; index < count; index++) {
    const x = points[index * 2];
    const y = points[index * 2 + 1];
    const before = Math.max(0, index - 1);
    const after = Math.min(count - 1, index + 1);
    let dx = points[after * 2] - points[before * 2];
    let dy = points[after * 2 + 1] - points[before * 2 + 1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) {
      dx = 1;
      dy = 0;
    } else {
      dx /= length;
      dy /= length;
    }
    const normalX = -dy;
    const normalY = dx;
    const width = halfWidth(smooth[index], baseWidth);
    left.push(x + normalX * width, y + normalY * width);
    right.push(x - normalX * width, y - normalY * width);
  }

  const outline = left;
  for (let index = count - 1; index >= 0; index--) {
    outline.push(right[index * 2], right[index * 2 + 1]);
  }
  return outline;
}
