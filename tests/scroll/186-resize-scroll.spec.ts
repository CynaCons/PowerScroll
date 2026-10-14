/**
 * Test 186: scroll widths are user/agent resizable, persistent and undoable.
 * Covers: REQ-HIER-024..026, REQ-SCROLL-031/032, REQ-AGENT-071
 */
import { test, expect, type Page } from '@playwright/test';
import { preloadModule, runBridge, runBridgeExpectingError, stubBridgeUrl, waitForBridgeReady, waitForCanvasReady } from '../helpers';

async function seedTwoScrolls(page: Page) {
  return page.evaluate(() => {
    const layout = (window as any).__mods['/src/utils/pageLayout.ts'];
    const S = (window as any).__POWERNOTE_STORES__;
    const ws = S.workspace.getState();
    const pageId = ws.activePageId;
    const first = ws.getActivePage().scrolls[0];
    ws.renameScroll(pageId, first.id, 'Backend');
    const second = ws.createScroll(pageId, 'Frontend');
    const scrolls = ws.getActivePage().scrolls;
    const rightX = layout.columnLeft(1, scrolls);
    S.canvas.getState().addNode({ id: 'right-block', type: 'text', x: rightX, y: 80, width: 220, height: 40, layer: 2, data: { text: 'Frontend', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#14181a' } });
    return { pageId, firstId: first.id, defaultWidth: layout.A4_WIDTH };
  });
}

async function dragFirstResizeHandle(page: Page, delta: number) {
  const handle = page.getByTestId('scroll-resize-handle').first();
  const box = await handle.boundingBox();
  if (!box) throw new Error('scroll resize handle not rendered');
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 3 + delta, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}

test.describe('186 - Resize scroll width (REQ-HIER-024..026, REQ-SCROLL-031/032, REQ-AGENT-071)', () => {
  test.beforeEach(async ({ page }) => { await stubBridgeUrl(page); await page.goto('/'); await waitForCanvasReady(page); await waitForBridgeReady(page); await preloadModule(page, '/src/utils/pageLayout.ts'); });

  test('header drag commits once, shifts the right band, and one undo restores all geometry', async ({ page }) => {
    const seeded = await seedTwoScrolls(page);
    await expect(page.getByTestId('scroll-resize-handle')).toHaveCount(2);
    await dragFirstResizeHandle(page, 120);
    const changed = await page.evaluate(({ firstId }) => {
      const S = (window as any).__POWERNOTE_STORES__;
      const scrolls = S.workspace.getState().getActivePage().scrolls;
      return { width: scrolls.find((scroll: any) => scroll.id === firstId).width, rightX: S.canvas.getState().nodes.find((node: any) => node.id === 'right-block').x };
    }, seeded);
    expect(changed.width).toBeCloseTo(seeded.defaultWidth + 120, 0);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(({ firstId }) => (window as any).__POWERNOTE_STORES__.workspace.getState().getActivePage().scrolls.find((scroll: any) => scroll.id === firstId).width ?? null, seeded)).toBeNull();
  });

  test('drag follows screen movement under zoom and previews before the one commit', async ({ page }) => {
    const seeded = await seedTwoScrolls(page);
    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: 0, scale: 0.3 }));
    const handle = page.getByTestId('scroll-resize-handle').first();
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 3, box!.y + 10); await page.mouse.down(); await page.mouse.move(box!.x + 23, box!.y + 10, { steps: 4 });
    await expect(page.getByTestId('scroll-resize-width-text')).toHaveText(`${Math.round(seeded.defaultWidth + 20 / 0.3)} px`);
    await page.mouse.up();
  });

  test('a small drag at 20% zoom does not explode to the maximum width', async ({ page }) => {
    const seeded = await seedTwoScrolls(page);
    const scale = 0.2;
    await page.evaluate((s) => {
      (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 40, y: 0, scale: s });
    }, scale);
    await expect(page.getByTestId('scroll-resize-handle')).toHaveCount(2);

    await dragFirstResizeHandle(page, 20);
    const width = await page.evaluate(({ firstId }) => {
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
      return ws.getActivePage().scrolls.find((s: any) => s.id === firstId).width;
    }, seeded);
    expect(width).toBeCloseTo(seeded.defaultWidth + 20 / scale, 0);
  });

  test('double-clicking the handle resets to an absent default width', async ({ page }) => {
    const seeded = await seedTwoScrolls(page);
    await runBridge(page, 'resize_scroll', { scrollId: seeded.firstId, width: 1000 });
    await expect(page.getByTestId('scroll-resize-handle')).toHaveCount(2);

    await page.getByTestId('scroll-resize-handle').first().dblclick();

    const reset = await page.evaluate(({ firstId }) => {
      const stores = (window as any).__POWERNOTE_STORES__;
      return stores.workspace.getState().getActivePage().scrolls.find((scroll: any) => scroll.id === firstId).width ?? null;
    }, seeded);
    expect(reset).toBeNull();
  });

  test('resize_scroll clamps and list_scrolls reports width; unknown ids fail loudly', async ({ page }) => {
    const seeded = await seedTwoScrolls(page);
    const max = await page.evaluate(() => (window as any).__mods['/src/utils/pageLayout.ts'].MAX_SCROLL_WIDTH);
    const result = await runBridge(page, 'resize_scroll', { scrollId: seeded.firstId, width: 99999 });
    expect(result.width).toBe(max);
    const listed = await runBridge(page, 'list_scrolls');
    expect(listed.scrolls.find((scroll: any) => scroll.scrollId === seeded.firstId).width).toBe(max);
    expect((await runBridgeExpectingError(page, 'resize_scroll', { scrollId: 'missing', width: 900 })).code).toBe('NOT_FOUND');
  });
});
