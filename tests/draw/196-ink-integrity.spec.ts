/**
 * Test 196: zone erase keeps raw ink data
 *
 * Covers: REQ-DRAW-025.
 */
import { expect, test, type Page } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

async function eraseAt(page: Page, x: number, y: number) {
  await page.evaluate(({ x, y }) => {
    const stores = (window as any).__POWERNOTE_STORES__;
    stores.tool.getState().setTool('draw');
    stores.tool.getState().setDrawOptions({ isErasing: true, eraserMode: 'zone', eraserSize: 24 });
    const canvas = document.querySelector('[data-testid="canvas-container"] canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const event = (type: string, buttons: number) => new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: 196, pointerType: 'mouse', isPrimary: true,
      buttons, clientX: rect.left + x, clientY: rect.top + y,
    });
    canvas.dispatchEvent(event('pointerdown', 1));
    canvas.dispatchEvent(event('pointerup', 0));
  }, { x, y });
}

test.describe('196 - Raw ink integrity (REQ-DRAW-025)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('zone erase splits raw pen points and keeps their pressures parallel', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.draw.setState({ strokes: [{
        id: 'pen-raw', points: [100, 300, 300, 300, 500, 300, 700, 300, 900, 300],
        pressures: [0.1, 0.3, 0.5, 0.7, 0.9], color: '#111', strokeWidth: 4,
      }] });
    });

    await eraseAt(page, 500, 300);

    const survivors = await page.evaluate(
      () => (window as any).__POWERNOTE_STORES__.draw.getState().strokes,
    );
    expect(survivors).toHaveLength(2);
    for (const stroke of survivors) {
      expect(stroke.baked).toBeUndefined();
      expect(stroke.pressures).toHaveLength(stroke.points.length / 2);
      expect(stroke.points.some((value: number) => value === 100 || value === 900)).toBe(true);
    }
  });

  test('zone erase keeps pressure-less raw pieces pressure-less', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.draw.setState({ strokes: [{
        id: 'mouse-raw', points: [100, 300, 300, 300, 500, 300, 700, 300, 900, 300],
        color: '#111', strokeWidth: 4,
      }] });
    });

    await eraseAt(page, 500, 300);

    const survivors = await page.evaluate(
      () => (window as any).__POWERNOTE_STORES__.draw.getState().strokes,
    );
    expect(survivors).toHaveLength(2);
    expect(survivors.every((stroke: any) => stroke.baked === undefined && stroke.pressures === undefined)).toBe(true);
  });
});
