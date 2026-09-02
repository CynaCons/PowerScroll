/**
 * Test 190: perfect-freehand outlines for all freehand input
 *
 * Covers: REQ-DRAW-020, REQ-DRAW-021.
 */
import { expect, test } from '@playwright/test';
import { buildInkOutline, INK_OPTIONS } from '../../src/utils/inkOutline';
import { disableFSA, waitForCanvasReady } from '../helpers';

function bounds(points: number[]) {
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

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

async function mouseStroke(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="canvas-container"] canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const event = (type: string, x: number, y: number, buttons: number) => new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 190, pointerType: 'mouse', isPrimary: true, pressure: 0.5, buttons,
      clientX: rect.left + x, clientY: rect.top + y,
    });
    canvas.dispatchEvent(event('pointerdown', 220, 260, 1));
    for (let index = 1; index <= 10; index++) {
      canvas.dispatchEvent(event('pointermove', 220 + index * 18, 260 + index * 3, 1));
    }
    canvas.dispatchEvent(event('pointerup', 400, 290, 0));
  });
}

test.describe('190 - Freehand outline (REQ-DRAW-020/021)', () => {
  test('a pressure-less stroke is a closed, tapered perfect-freehand polygon', () => {
    expect(INK_OPTIONS).toMatchObject({
      thinning: 0.5, smoothing: 0.5, streamline: 0.5,
      start: { taper: true }, end: { taper: true },
    });
    const points = [0, 0, 25, 0, 50, 0, 75, 0, 100, 0];
    const outline = buildInkOutline(points, undefined, 10);
    expect(outline).not.toBeNull();
    expect(outline!.length).toBeGreaterThanOrEqual(6);
    expect(outline!.length % 2).toBe(0);
    expect(outline!.slice(0, 2)).toEqual(outline!.slice(-2));

    const outlineBounds = bounds(outline!);
    expect(outlineBounds.minX).toBeGreaterThanOrEqual(-10);
    expect(outlineBounds.maxX).toBeLessThanOrEqual(110);
    expect(outlineBounds.minY).toBeGreaterThanOrEqual(-10);
    expect(outlineBounds.maxY).toBeLessThanOrEqual(10);
    expect(widthAtX(outline!, 10)).toBeLessThan(widthAtX(outline!, 50));
    expect(widthAtX(outline!, 90)).toBeLessThan(widthAtX(outline!, 50));
  });

  test('recorded pressure grows the outline without changing stored samples', () => {
    const points = [0, 0, 25, 0, 50, 0, 75, 0, 100, 0];
    const pressures = [0.1, 0.3, 0.5, 0.75, 1];
    const originalPoints = [...points];
    const originalPressures = [...pressures];
    const outline = buildInkOutline(points, pressures, 10);
    expect(outline).not.toBeNull();
    expect(widthAtX(outline!, 25)).toBeLessThan(widthAtX(outline!, 75));
    expect(points).toEqual(originalPoints);
    expect(pressures).toEqual(originalPressures);
  });

  test('a mouse stroke commits a filled freehand outline node', async ({ page }) => {
    await disableFSA(page);
    await page.goto('/');
    await waitForCanvasReady(page);
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setTool('draw');
    });
    await mouseStroke(page);
    await expect.poll(async () => page.evaluate(
      () => (window as any).__POWERNOTE_STORES__.draw.getState().strokes.length,
    )).toBe(1);

    const rendered = await page.evaluate(() => {
      const stage = (window as any).Konva?.stages?.[0];
      const drawLayer = stage?.getChildren().find((layer: any) => layer.name() === 'draw-layer');
      return drawLayer?.find('.freehand-outline').map((node: any) => ({
        kind: node.getClassName(),
        fill: node.fill(),
      })) ?? [];
    });
    expect(rendered).toContainEqual(expect.objectContaining({ kind: 'Shape', fill: '#1a1a1a' }));
  });
});
