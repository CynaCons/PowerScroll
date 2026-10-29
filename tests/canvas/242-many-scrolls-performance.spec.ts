/**
 * Test 242: a page with many scrolls stays light to pan.
 * Covers: REQ-CANVAS-046
 *
 * Owner report 2026-10-29: pages with 30-40 scrolls got slow. Profiling found
 * every block repainted on every click, drag frame and tool switch, every
 * block's HTML repositioned on every pan frame, and every sheet and block of
 * every scroll redrawn by Konva on every frame though almost all were off
 * screen. This checks the structure that keeps that from coming back.
 */
import { expect, test } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

const SCROLLS = 40;
const PER = 5;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
  await page.evaluate(({ SCROLLS, PER }) => {
    const S = (window as any).__POWERNOTE_STORES__;
    S.workspace.getState().updateSettings({ backgroundMode: 'scroll' });
    const ws = S.workspace.getState();
    for (let i = 1; i < SCROLLS; i++) ws.createScroll(ws.activePageId, `Scroll ${i}`);
    for (const s of S.workspace.getState().getActivePage().scrolls) {
      for (let k = 0; k < PER; k++) {
        S.canvas.getState().addNode({
          id: `b-${s.column}-${k}`, type: 'text', x: 80 + s.column * 834, y: 40 + k * 200, width: 600, height: 120,
          data: { text: `block ${s.column}.${k}`, fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#14181A' },
        });
      }
    }
    S.canvas.getState().setViewport({ x: 0, y: 0, scale: 1 });
  }, { SCROLLS, PER });
  await expect(page.locator('.powernote-markdown')).toHaveCount(SCROLLS * PER);
  // Heights auto-size and each band packs; wait until the layout holds still.
  let last = '';
  await expect.poll(async () => {
    const now = await page.evaluate(() => JSON.stringify((window as any).__POWERNOTE_STORES__.canvas.getState().nodes.map((n: any) => [n.y, n.height])));
    const still = now === last;
    last = now;
    await page.waitForTimeout(150);
    return still;
  }).toBe(true);
});

test('far-away blocks and sheets are not drawn; their text stays in the page', async ({ page }) => {
  const drawn = await page.evaluate(() => {
    const stage = (window as any).Konva.stages[0];
    const wrapper = (id: string) => stage.find((n: any) => n.attrs.cullId === id)[0];
    return {
      near: wrapper('b-0-0').visible(),
      far: wrapper('b-39-0').visible(),
      sheets: stage.find('.scroll-sheet').length,
    };
  });
  expect(drawn.near, 'a block on screen is drawn').toBe(true);
  expect(drawn.far, 'a block 39 scrolls away is not drawn').toBe(false);
  expect(drawn.sheets, 'only the sheets near the view are drawn').toBeLessThan(SCROLLS / 2);
  // The far block's text is still there for search, agents and its height.
  await expect(page.locator('.powernote-markdown').filter({ hasText: 'block 39.0' })).toHaveCount(1);

  // Pan to it: it is drawn and clickable there.
  await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: -39 * 834, y: 0, scale: 1 }));
  await expect.poll(() => page.evaluate(() => {
    const stage = (window as any).Konva.stages[0];
    return stage.find((n: any) => n.attrs.cullId === 'b-39-0')[0].visible();
  })).toBe(true);
  const box = (await page.locator('.powernote-markdown').filter({ hasText: 'block 39.0' }).boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().selectedNodeIds)).toEqual(['b-39-0']);
});

test('panning moves one shared layer, not every block', async ({ page }) => {
  const read = () => page.evaluate(() => {
    const layer = document.querySelector('.powernote-html-layer') as HTMLElement;
    const blocks = Array.from(layer.children).map((d) => (d as HTMLElement).style.transform);
    return { layer: layer.style.transform, blocks };
  });
  const before = await read();
  expect(before.blocks).toHaveLength(SCROLLS * PER);
  const text = page.locator('.powernote-markdown').filter({ hasText: 'block 0.1' });
  const at = (await text.boundingBox())!;

  const box = (await page.locator('[data-testid="canvas-container"]').boundingBox())!;
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.wheel(120, 160);
  await expect.poll(async () => (await read()).layer).not.toBe(before.layer);

  const after = await read();
  expect(after.blocks, 'no block moved its own div for a pan').toEqual(before.blocks);
  // ...yet on screen it moved with the canvas, exactly as far as the camera.
  const vp = await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().viewport);
  const moved = (await text.boundingBox())!;
  expect(moved.x - at.x).toBeCloseTo(vp.x, 0);
  expect(moved.y - at.y).toBeCloseTo(vp.y, 0);
});
