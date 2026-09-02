/**
 * Test 189: Eraser sweep, preview and undo batching
 * Covers: REQ-DRAW-004, 005, 006, 015..019
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';
import {
  boundsFromFlatPoints,
  boundsIntersect,
  pointSegmentDistance,
  segmentSegmentDistance,
} from '../../src/utils/eraserGeometry';

type CanvasPoint = { x: number; y: number };

async function configureEraser(page: import('@playwright/test').Page, mode: 'stroke' | 'zone') {
  await page.evaluate((eraserMode) => {
    const stores = (window as any).__POWERNOTE_STORES__;
    stores.tool.getState().setTool('draw');
    stores.tool.getState().setDrawOptions({ isErasing: true, eraserMode, eraserSize: 24 });
  }, mode);
}

async function addStroke(
  page: import('@playwright/test').Page,
  id: string,
  points: number[],
) {
  await page.evaluate(({ id, points }) => {
    (window as any).__POWERNOTE_STORES__.draw.getState().addStroke({
      id, points, color: '#111111', strokeWidth: 4,
    });
  }, { id, points });
}

async function dispatchPointer(
  page: import('@playwright/test').Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  point: CanvasPoint,
  options: { altKey?: boolean; pointerId?: number } = {},
) {
  await page.evaluate(({ type, point, options }) => {
    const canvas = document.querySelector('[data-testid="canvas-container"] canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const viewport = (window as any).__POWERNOTE_STORES__.canvas.getState().viewport;
    canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: options.pointerId ?? 189,
      pointerType: 'mouse', isPrimary: true,
      clientX: rect.left + viewport.x + point.x * viewport.scale,
      clientY: rect.top + viewport.y + point.y * viewport.scale,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      altKey: options.altKey ?? false,
    }));
  }, { type, point, options });
}

test.describe('189 - Eraser rework (REQ-DRAW-004/005/006/015..019)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('geometry primitives measure segment contacts and bounding boxes', () => {
    expect(pointSegmentDistance({ x: 5, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(4);
    expect(segmentSegmentDistance(
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 },
    )).toBe(0);
    expect(boundsIntersect(
      boundsFromFlatPoints([10, 10, 20, 20]),
      { minX: 19, minY: 19, maxX: 30, maxY: 30 },
    )).toBe(true);
  });

  for (const scale of [1, 0.4]) {
    test(`stroke sweep erases the middle of a two-point line at ${scale}x zoom`, async ({ page }) => {
      await addStroke(page, `middle-${scale}`, [100, 300, 700, 300]);
      await page.evaluate((scale) => {
        (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: 0, scale });
      }, scale);
      await configureEraser(page, 'stroke');

      await dispatchPointer(page, 'pointerdown', { x: 390, y: 300 });
      await dispatchPointer(page, 'pointermove', { x: 410, y: 300 });
      const during = await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().pendingEraseIds);
      expect(during).toEqual([`middle-${scale}`]);
      await dispatchPointer(page, 'pointerup', { x: 410, y: 300 });
      const after = await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().strokes);
      expect(after).toEqual([]);
    });
  }

  test('Alt restores a pending stroke and Escape abandons a pending gesture', async ({ page }) => {
    await addStroke(page, 'restore-me', [100, 300, 700, 300]);
    await configureEraser(page, 'stroke');
    await dispatchPointer(page, 'pointerdown', { x: 400, y: 300 });
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().pendingEraseIds)).toEqual(['restore-me']);
    await dispatchPointer(page, 'pointermove', { x: 410, y: 300 }, { altKey: true });
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().pendingEraseIds)).toEqual([]);
    await dispatchPointer(page, 'pointerup', { x: 410, y: 300 });
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().strokes.map((s: any) => s.id))).toEqual(['restore-me']);

    await dispatchPointer(page, 'pointerdown', { x: 400, y: 300 }, { pointerId: 190 });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => {
      const draw = (window as any).__POWERNOTE_STORES__.draw.getState();
      return { ids: draw.strokes.map((s: any) => s.id), pending: draw.pendingEraseIds };
    })).toEqual({ ids: ['restore-me'], pending: [] });

    await dispatchPointer(page, 'pointerdown', { x: 400, y: 300 }, { pointerId: 191 });
    await dispatchPointer(page, 'pointercancel', { x: 400, y: 300 }, { pointerId: 191 });
    expect(await page.evaluate(() => {
      const draw = (window as any).__POWERNOTE_STORES__.draw.getState();
      return { ids: draw.strokes.map((s: any) => s.id), pending: draw.pendingEraseIds };
    })).toEqual({ ids: ['restore-me'], pending: [] });
  });

  test('zone sweep is one undo frame and restores original stroke ids', async ({ page }) => {
    await addStroke(page, 'one', [200, 250, 200, 350]);
    await addStroke(page, 'two', [400, 250, 400, 350]);
    await addStroke(page, 'three', [600, 250, 600, 350]);
    await configureEraser(page, 'zone');
    await dispatchPointer(page, 'pointerdown', { x: 150, y: 300 });
    await dispatchPointer(page, 'pointermove', { x: 650, y: 300 });
    await dispatchPointer(page, 'pointerup', { x: 650, y: 300 });
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().strokes.map((s: any) => s.id))).not.toEqual(['one', 'two', 'three']);

    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().strokes.map((s: any) => s.id))).toEqual(['one', 'two', 'three']);
  });

  test('zone mode fills the gap between far-apart pointer samples', async ({ page }) => {
    await addStroke(page, 'between-samples', [400, 250, 400, 350]);
    await configureEraser(page, 'zone');
    await dispatchPointer(page, 'pointerdown', { x: 150, y: 300 });
    await dispatchPointer(page, 'pointermove', { x: 650, y: 300 });
    await dispatchPointer(page, 'pointerup', { x: 650, y: 300 });
    const fragments = await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().strokes);
    expect(fragments).toHaveLength(2);
    expect(fragments.some((s: any) => s.id === 'between-samples')).toBe(false);
  });
});
