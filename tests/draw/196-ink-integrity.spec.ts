/**
 * Test 196: freehand ink integrity through commit and zone erase
 *
 * Covers: REQ-DRAW-022, REQ-DRAW-023, REQ-DRAW-024.
 */
import { expect, test, type Page } from '@playwright/test';
import { bakeStroke, buildInkOutline } from '../../src/utils/inkOutline';
import { waitForCanvasReady } from '../helpers';

type StrokeData = {
  id: string;
  points: number[];
  pressures?: number[];
  color: string;
  strokeWidth: number;
  baked?: true;
};

function widthAtX(outline: number[], x: number) {
  const ys: number[] = [];
  for (let index = 0; index < outline.length - 2; index += 2) {
    const x1 = outline[index];
    const y1 = outline[index + 1];
    const x2 = outline[index + 2];
    const y2 = outline[index + 3];
    if ((x1 <= x && x <= x2) || (x2 <= x && x <= x1)) {
      ys.push(x1 === x2 ? y1 : y1 + ((x - x1) * (y2 - y1)) / (x2 - x1));
    }
  }
  return Math.max(...ys) - Math.min(...ys);
}

function outlineFor(stroke: StrokeData) {
  const outline = buildInkOutline(stroke.points, stroke.pressures, stroke.strokeWidth, stroke.baked);
  if (!outline) throw new Error('Expected a freehand outline');
  return outline;
}

function pointSegmentDistance(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function closestOutlineDistance(px: number, py: number, outline: number[]) {
  let closest = Infinity;
  for (let index = 0; index < outline.length - 2; index += 2) {
    closest = Math.min(closest, pointSegmentDistance(
      px, py, outline[index], outline[index + 1], outline[index + 2], outline[index + 3],
    ));
  }
  return closest;
}

function expectSurvivorsMatchParent(parent: StrokeData, survivors: StrokeData[]) {
  const parentOutline = outlineFor(parent);
  const survivorOutlines = survivors.map(outlineFor);
  for (let index = 0; index < parentOutline.length - 2; index += 2) {
    const x = parentOutline[index];
    // The drag below erases around x=500; exclude the changed cap area.
    if (x > 465 && x < 535) continue;
    const distance = Math.min(...survivorOutlines.map((outline) => (
      closestOutlineDistance(x, parentOutline[index + 1], outline)
    )));
    expect(distance).toBeLessThanOrEqual(0.5);
  }
}

async function drawMouseStroke(page: Page, startX: number, endX: number, y: number, pointerId: number) {
  await page.evaluate(({ startX, endX, y, pointerId }) => {
    const canvas = document.querySelector('[data-testid="canvas-container"] canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const dispatch = (type: string, x: number, buttons: number) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId, pointerType: 'mouse', isPrimary: true, pressure: 0.5, buttons,
      clientX: rect.left + x, clientY: rect.top + y,
    }));
    dispatch('pointerdown', startX, 1);
    for (let index = 1; index <= 20; index++) {
      dispatch('pointermove', startX + ((endX - startX) * index) / 20, 1);
    }
    dispatch('pointerup', endX, 0);
  }, { startX, endX, y, pointerId });
}

async function dragZoneEraser(page: Page) {
  await page.evaluate(() => {
    const stores = (window as any).__POWERNOTE_STORES__;
    stores.tool.getState().setTool('draw');
    stores.tool.getState().setDrawOptions({ isErasing: true, eraserMode: 'zone', eraserSize: 24 });
    const canvas = document.querySelector('[data-testid="canvas-container"] canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const dispatch = (type: string, x: number, buttons: number) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 196, pointerType: 'mouse', isPrimary: true, buttons,
      clientX: rect.left + x, clientY: rect.top + 300,
    }));
    dispatch('pointerdown', 500, 1);
    dispatch('pointermove', 510, 1);
    dispatch('pointerup', 510, 0);
  });
}

test.describe('196 - Ink integrity (REQ-DRAW-022/023/024)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setTool('draw');
      (window as any).__POWERNOTE_STORES__.tool.getState().setDrawOptions({ isErasing: false, strokeWidth: 4 });
    });
  });

  test('round caps keep width independent of total stroke length', async ({ page }) => {
    await drawMouseStroke(page, 100, 800, 220, 1961);
    await drawMouseStroke(page, 100, 1_500, 420, 1962);
    const strokes = await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().strokes) as StrokeData[];
    expect(strokes).toHaveLength(2);

    const firstOutline = outlineFor(strokes[0]);
    const secondOutline = outlineFor(strokes[1]);
    const firstStart = Math.min(...strokes[0].points.filter((_, index) => index % 2 === 0));
    const firstEnd = Math.max(...strokes[0].points.filter((_, index) => index % 2 === 0));
    const secondStart = Math.min(...strokes[1].points.filter((_, index) => index % 2 === 0));
    const firstMiddle = widthAtX(firstOutline, firstStart + (firstEnd - firstStart) * 0.5);
    const firstNearStart = widthAtX(firstOutline, firstStart + (firstEnd - firstStart) * 0.05);
    const sameAbsoluteDistance = widthAtX(secondOutline, secondStart + (firstEnd - firstStart) * 0.05);
    expect(firstNearStart).toBeGreaterThanOrEqual(firstMiddle * 0.8);
    expect(sameAbsoluteDistance).toBeCloseTo(firstNearStart, 1);
  });

  test('baking calibrates width and persists final geometry', async ({ page }) => {
    const calibrated = bakeStroke({
      id: 'calibrated', points: [0, 0, 100, 0], pressures: [0.5, 0.5], color: '#111', strokeWidth: 6,
    });
    expect(widthAtX(outlineFor(calibrated), 50)).toBeCloseTo(6, 2);

    await drawMouseStroke(page, 100, 800, 300, 1963);
    const result = await page.evaluate(async () => {
      const stores = (window as any).__POWERNOTE_STORES__;
      const stroke = stores.draw.getState().strokes[0];
      stores.workspace.getState().savePageStrokes([stroke]);
      const serialization = await import('/src/utils/serialization.ts');
      const roundTrip = serialization.deserializeWorkspace(serialization.serializeWorkspace(stores.workspace.getState().workspace));
      return { stroke, restored: roundTrip?.sections[0].pages[0].strokes?.[0] };
    });
    expect(result.stroke.baked).toBe(true);
    expect(result.stroke.pressures.length * 2).toBe(result.stroke.points.length);
    expect(result.restored).toMatchObject({ baked: true, points: result.stroke.points, pressures: result.stroke.pressures });
  });

  test('a real zone drag leaves baked committed ink in place away from the cut', async ({ page }) => {
    await drawMouseStroke(page, 100, 900, 300, 1964);
    const parent = await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().strokes[0]) as StrokeData;
    await dragZoneEraser(page);
    const survivors = await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().strokes) as StrokeData[];
    expect(survivors).toHaveLength(2);
    expect(survivors.every((stroke) => stroke.baked)).toBe(true);
    expectSurvivorsMatchParent(parent, survivors);
  });

  test('zone cutting legacy raw ink bakes matching survivors', async ({ page }) => {
    const legacy: StrokeData = {
      id: 'legacy', points: [100, 300, 300, 300, 500, 300, 700, 300, 900, 300], color: '#111', strokeWidth: 4,
    };
    await page.evaluate((legacy) => {
      (window as any).__POWERNOTE_STORES__.draw.setState({ strokes: [legacy] });
    }, legacy);
    await dragZoneEraser(page);
    const survivors = await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().strokes) as StrokeData[];
    expect(survivors).toHaveLength(2);
    expect(survivors.every((stroke) => stroke.baked)).toBe(true);
    expectSurvivorsMatchParent(legacy, survivors);
  });
});
