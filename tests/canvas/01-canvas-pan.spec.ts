/**
 * Test 01: Canvas Pan
 * Covers: REQ-CANVAS-002 — Pan via Space+drag (select-tool background drag is marquee)
 *
 * Verifies that Space+dragging on the canvas background changes the viewport
 * position stored in the canvas store.
 */
import { test, expect } from '@playwright/test';
import { getCanvasStore, waitForCanvasReady } from '../helpers';

test.describe('01 - Canvas Pan (REQ-CANVAS-002)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('Space+dragging canvas background changes viewport position', async ({ page }) => {
    const storeBefore = await getCanvasStore(page);
    const initialX = storeBefore.viewport.x;
    const initialY = storeBefore.viewport.y;

    const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + 400;
    const startY = box!.y + 300;
    const endX = box!.x + 500;
    const endY = box!.y + 400;

    await page.keyboard.down('Space');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Space');

    await page.waitForTimeout(200);

    const storeAfter = await getCanvasStore(page);
    expect(storeAfter.viewport.x).not.toEqual(initialX);
    expect(storeAfter.viewport.y).not.toEqual(initialY);
  });

  test('viewport position reflects Space+drag direction', async ({ page }) => {
    const storeBefore = await getCanvasStore(page);

    const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + 400;
    const startY = box!.y + 300;

    await page.keyboard.down('Space');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 100, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Space');

    await page.waitForTimeout(200);

    const storeAfter = await getCanvasStore(page);
    expect(storeAfter.viewport.x).toBeGreaterThan(storeBefore.viewport.x);
    expect(storeAfter.viewport.y).toBeGreaterThan(storeBefore.viewport.y);
  });
});
