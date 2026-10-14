/**
 * Test 152: scroll title card states
 * Covers: REQ-HIER-019, REQ-SCROLL-039
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

async function titleScroll(page: import('@playwright/test').Page, title: string) {
  await page.evaluate((name) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const first = ws.getActivePage().scrolls[0];
    ws.renameScroll(ws.activePageId, first.id, name);
    // Ask for a camera above the top: the clamp rests it with the ceiling just
    // below the header card strip (REQ-CANVAS-045).
    (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: 5000, scale: 1 });
  }, title);
}

test.describe('152 - Scroll title card states', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); await waitForCanvasReady(page); });

  test('a named scroll draws an opaque detached card, and pins after scrolling', async ({ page }) => {
    await titleScroll(page, 'Project notes');
    const card = page.getByTestId('scroll-header-card');
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute('data-pinned', 'false');
    await expect(card).toHaveCSS('height', '44px');
    await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: -600, scale: 1 }));
    await expect(card).toHaveAttribute('data-pinned', 'true');
    await expect(page.getByTestId('scroll-header-mask')).toHaveCount(1);
  });

  test('double-click opens in-place rename and untitled scrolls have no card', async ({ page }) => {
    await titleScroll(page, 'Project notes');
    await page.getByTestId('scroll-header-card').dblclick();
    await expect(page.getByTestId('scroll-rename-input')).toBeVisible();
    await page.getByTestId('scroll-rename-input').press('Escape');
    await expect(page.getByTestId('scroll-rename-input')).toHaveCount(0);
    await page.evaluate(() => {
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
      ws.renameScroll(ws.activePageId, ws.getActivePage().scrolls[0].id, '');
    });
    await expect(page.getByTestId('scroll-header-card')).toHaveCount(0);
  });
});
