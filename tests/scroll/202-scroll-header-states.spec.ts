/**
 * Test 202: scroll document/held headers
 * Covers: REQ-SCROLL-024, REQ-SCROLL-033..038
 */
import { test, expect, type Page } from '@playwright/test';
import { preloadModule, waitForCanvasReady } from '../helpers';

async function seed(page: Page) {
  await preloadModule(page, '/src/utils/pageLayout.ts');
  await preloadModule(page, '/src/utils/scrollCeiling.ts');
  return page.evaluate(() => {
    const stores = (window as any).__POWERNOTE_STORES__;
    const ws = stores.workspace.getState();
    const first = ws.getActivePage().scrolls[0];
    ws.renameScroll(ws.activePageId, first.id, 'Research');
    const second = ws.createScroll(ws.activePageId, 'Design');
    const layout = (window as any).__mods['/src/utils/pageLayout.ts'];
    stores.canvas.getState().addNode({ id: 'research-bottom', type: 'text', x: layout.columnLeft(0, ws.getActivePage().scrolls), y: 2000, width: 120, height: 40, layer: 2, data: { text: 'bottom', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#14181A' } });
    return { first: first.id, second: second.id };
  });
}

async function setViewport(page: Page, viewport: { y: number; scale: number }) {
  await page.evaluate((next) => (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, ...next }), viewport);
  await page.waitForTimeout(40);
}

async function dragFirstResizeHandle(page: Page, delta: number) {
  const point = await page.evaluate(() => {
    const stage = (window as any).Konva.stages[0];
    const rect = stage.find('.scroll-resize-handle')[0].getClientRect();
    const box = stage.container().getBoundingClientRect();
    return { x: box.left + rect.x + rect.width / 2, y: box.top + rect.y + rect.height / 2 };
  });
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + delta, point.y, { steps: 6 });
}

test.describe('202 - Scroll header states (REQ-SCROLL-024, REQ-SCROLL-033..038)', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); await waitForCanvasReady(page); });

  test('resting heading has document type and rule at y=46, clear of the first block at 48', async ({ page }) => {
    await seed(page);
    const state = await page.evaluate(() => {
      const stage = (window as any).Konva.stages[0];
      const text = stage.find('.scroll-title-text')[0], rule = stage.find('.scroll-title-hairline')[0];
      const S = (window as any).__POWERNOTE_STORES__;
      const layout = (window as any).__mods['/src/utils/pageLayout.ts'];
      const { pageCeiling } = (window as any).__mods['/src/utils/scrollCeiling.ts'];
      // The resting header TOP is the ceiling row (T150); its rule is 34 units below it.
      const ceiling = pageCeiling(S.canvas.getState().nodes, S.draw.getState().strokes, S.workspace.getState().getActivePage().scrolls);
      return { font: text.fontSize(), weight: text.fontStyle(), ruleY: rule.points()[1], expectedRuleY: (ceiling ?? layout.SCROLL_TITLE_RESTING_Y) + layout.SCROLL_TITLE_RESTING_HEIGHT, height: layout.SCROLL_TITLE_RESTING_HEIGHT };
    });
    expect(state.height).toBe(34);
    expect(state).toMatchObject({ font: 24, weight: '700' });
    expect(state.ruleY).toBeCloseTo(state.expectedRuleY, 5);
  });

  test('held header and fade remain screen-constant across scales', async ({ page }) => {
    await seed(page);
    const metrics: Array<{ band: number; fade: number }> = [];
    for (const scale of [0.5, 1]) {
      await setViewport(page, { y: -300 * scale, scale });
      metrics.push(await page.evaluate(() => {
        const stage = (window as any).Konva.stages[0], band = stage.find('.scroll-title-backing')[0], fade = stage.find('.scroll-title-fade')[0];
        return { band: band.height() * stage.scaleY(), fade: fade.height() * stage.scaleY() };
      }));
    }
    expect(metrics[0].band).toBeCloseTo(32, 1); expect(metrics[1].band).toBeCloseTo(32, 1);
    expect(metrics[0].fade).toBeCloseTo(22, 1); expect(metrics[1].fade).toBeCloseTo(22, 1);
  });

  test('progress grows monotonically to the full band width', async ({ page }) => {
    await seed(page);
    const widths: number[] = [];
    for (const y of [-100, -700, -1700]) {
      await setViewport(page, { y, scale: 1 });
      widths.push(await page.evaluate(() => (window as any).Konva.stages[0].find('.scroll-title-progress')[0].width()));
    }
    expect(widths[1]).toBeGreaterThanOrEqual(widths[0]); expect(widths[2]).toBeGreaterThanOrEqual(widths[1]);
    const bandWidth = await page.evaluate(() => (window as any).Konva.stages[0].find('.scroll-title-backing')[0].width());
    expect(widths[2]).toBeCloseTo(bandWidth, 4);
  });

  test('active spine switches on header click', async ({ page }) => {
    const ids = await seed(page);
    expect(await page.evaluate(() => (window as any).Konva.stages[0].find('.scroll-active-spine').length)).toBe(1);
    await page.evaluate((id) => {
      const stage = (window as any).Konva.stages[0];
      stage.find('.scroll-title-hit').find((node: any) => node.getParent().name() === `scroll-header-${id}`)?.getParent().fire('click');
    }, ids.second);
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.workspace.getState().activeScrollId)).toBe(ids.second);
    expect(await page.evaluate((id) => (window as any).Konva.stages[0].find('.scroll-active-spine')[0].getParent().name(), ids.second)).toBe(`scroll-header-${ids.second}`);
  });

  test('drag readout sits in the band and rename preserves the title box', async ({ page }) => {
    await seed(page);
    await setViewport(page, { y: -300, scale: 1 });
    await dragFirstResizeHandle(page, 24);
    const drag = await page.evaluate(() => {
      const stage = (window as any).Konva.stages[0], badge = stage.find('.scroll-resize-width-badge')[0], band = stage.find('.scroll-title-backing')[0];
      const b = badge.getClientRect(), h = band.getClientRect();
      return { inside: b.x >= h.x && b.x + b.width <= h.x + h.width && b.y >= h.y && b.y + b.height <= h.y + h.height };
    });
    expect(drag.inside).toBe(true);
    await page.mouse.up();
    const title = page.getByTestId('scroll-title-strip').filter({ hasText: 'Research' });
    const titleBox = await title.boundingBox();
    await page.evaluate(() => (window as any).Konva.stages[0].find('.scroll-title-text')[0].getParent().fire('dblclick'));
    const inputBox = await page.getByTestId('scroll-rename-input').boundingBox();
    expect(inputBox).not.toBeNull(); expect(titleBox).not.toBeNull();
    expect(inputBox!.x).toBeCloseTo(titleBox!.x, 1); expect(inputBox!.y).toBeCloseTo(titleBox!.y, 1);
    expect(inputBox!.width).toBeCloseTo(titleBox!.width, 1); expect(inputBox!.height).toBeCloseTo(titleBox!.height, 1);
  });
});
