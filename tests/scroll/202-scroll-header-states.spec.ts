/**
 * Test 202: scroll header card interaction states
 * Covers: REQ-SCROLL-037, REQ-SCROLL-038, REQ-SCROLL-039..044
 */
import { test, expect, type Page } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

async function seed(page: Page) {
  await page.evaluate(() => {
    const S = (window as any).__POWERNOTE_STORES__;
    const ws = S.workspace.getState();
    const first = ws.getActivePage().scrolls[0];
    ws.renameScroll(ws.activePageId, first.id, 'Research');
    ws.createScroll(ws.activePageId, 'Design');
    S.canvas.getState().addNode({ id: 'research-bottom', type: 'text', x: 60, y: 2000, width: 120, height: 40, layer: 2, data: { text: 'bottom', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#14181A' } });
  });
}

test.describe('202 - Scroll header card states', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); await waitForCanvasReady(page); });

  test('active card changes on click and retains its page counter', async ({ page }) => {
    await seed(page);
    const cards = page.getByTestId('scroll-header-card');
    await expect(cards).toHaveCount(2);
    await cards.nth(1).click();
    await expect(cards.nth(1)).toHaveClass(/scroll-header-card--active/);
    await expect(cards.nth(1).locator('.scroll-header-card__counter')).toHaveText(/page 1 of/);
  });

  test('resize handle exposes a screen-space width readout while dragging', async ({ page }) => {
    await seed(page);
    const handle = page.getByTestId('scroll-resize-handle').first();
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 2, box!.y + 10);
    await page.mouse.down();
    await page.mouse.move(box!.x + 26, box!.y + 10, { steps: 4 });
    await expect(page.getByTestId('scroll-resize-width-text')).toHaveText(/px$/);
    await page.mouse.up();
  });
});
