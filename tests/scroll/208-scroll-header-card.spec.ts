/**
 * Test 208: detached scroll header card and sheet gaps.
 * Covers: REQ-SCROLL-039..045
 */
import { inflateSync } from 'zlib';
import { test, expect, type Page } from '@playwright/test';
import { preloadModule, waitForCanvasReady } from '../helpers';

type Pixel = { r: number; g: number; b: number; a: number };

function readPixels(png: Buffer) {
  let offset = 8, width = 0, height = 0, channels = 4;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset); const type = png.toString('ascii', offset + 4, offset + 8); const data = png.subarray(offset + 8, offset + 8 + length); offset += length + 12;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = data[9] === 6 ? 4 : 3; }
    if (type === 'IDAT') idat.push(data);
  }
  const raw = inflateSync(Buffer.concat(idat)); const stride = width * channels; const out = Buffer.alloc(width * height * channels); let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]; const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src++], left = x >= channels ? out[row + x - channels] : 0, up = y ? out[row - stride + x] : 0, upperLeft = y && x >= channels ? out[row - stride + x - channels] : 0;
      if (filter === 0) out[row + x] = value;
      else if (filter === 1) out[row + x] = (value + left) & 255;
      else if (filter === 2) out[row + x] = (value + up) & 255;
      else if (filter === 3) out[row + x] = (value + Math.floor((left + up) / 2)) & 255;
      else { const p = left + up - upperLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upperLeft); out[row + x] = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft)) & 255; }
    }
  }
  return { width, height, at: (x: number, y: number): Pixel => { const i = (Math.floor(y) * width + Math.floor(x)) * channels; return { r: out[i], g: out[i + 1], b: out[i + 2], a: channels === 4 ? out[i + 3] : 255 }; } };
}

function near(pixel: Pixel, color: [number, number, number], tolerance = 5) { return Math.abs(pixel.r - color[0]) <= tolerance && Math.abs(pixel.g - color[1]) <= tolerance && Math.abs(pixel.b - color[2]) <= tolerance; }

async function shot(page: Page) { return readPixels(await page.screenshot()); }

async function seedPinned(page: Page, title = 'Masked header') {
  await page.evaluate((title) => {
    const S = (window as any).__POWERNOTE_STORES__; const ws = S.workspace.getState(); const scroll = ws.getActivePage().scrolls[0];
    ws.renameScroll(ws.activePageId, scroll.id, title);
    S.canvas.getState().addNode({ id: 'dark-under-card', type: 'shape', x: 60, y: 300, width: 700, height: 100, layer: 2, data: { shapeType: 'rect', fill: '#111418', stroke: '#111418', strokeWidth: 0, strokeDash: [] } });
    S.canvas.getState().addNode({ id: 'text-under-card', type: 'text', x: 60, y: 310, width: 600, height: 44, layer: 3, data: { text: 'XXXXXXXXXXXX', fontSize: 36, fontFamily: 'Inter', fontStyle: '700', fill: '#ffffff' } });
    S.canvas.getState().addNode({ id: 'progress-bottom', type: 'text', x: 60, y: 3000, width: 120, height: 30, layer: 2, data: { text: 'bottom', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#14181A' } });
    S.canvas.getState().setViewport({ x: 0, y: -300, scale: 1 });
  }, title);
  await expect(page.getByTestId('scroll-header-card')).toHaveAttribute('data-pinned', 'true');
}

test.describe('208 - Scroll header card', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); await waitForCanvasReady(page); await preloadModule(page, '/src/utils/pageLayout.ts'); });

  test('pinned opaque card stays white over a dark shape and renders dark title glyphs', async ({ page }) => {
    await seedPinned(page, 'Dark card');
    const box = await page.getByTestId('scroll-header-card').boundingBox(); expect(box).not.toBeNull();
    const image = await shot(page);
    expect(near(image.at(box!.x + 350, box!.y + 22), [255, 255, 255])).toBe(true);
    let darkGlyphs = 0;
    for (let y = box!.y + 12; y < box!.y + 32; y++) for (let x = box!.x + 38; x < box!.x + 130; x++) if (near(image.at(x, y), [20, 24, 26], 45)) darkGlyphs++;
    expect(darkGlyphs).toBeGreaterThan(4);
  });

  test('pinned card and its six-pixel mask gap hide text passing underneath', async ({ page }) => {
    await seedPinned(page);
    const box = await page.getByTestId('scroll-header-card').boundingBox(); const mask = await page.getByTestId('scroll-header-mask').boundingBox(); expect(box).not.toBeNull(); expect(mask).not.toBeNull();
    const image = await shot(page); const canvasColor = await page.locator('[data-testid="canvas-container"]').evaluate((element) => getComputedStyle(element).backgroundColor.match(/\d+/g)!.map(Number) as [number, number, number]);
    expect(near(image.at(box!.x + 420, box!.y + 22), [255, 255, 255])).toBe(true);
    const gapPixel = image.at(mask!.x + 420, mask!.y + mask!.height - 4);
    expect(gapPixel.r).toBeGreaterThan(230);
    expect(gapPixel.g).toBeGreaterThan(230);
    expect(gapPixel.b).toBeGreaterThan(230);
  });

  test('the composited three-pixel progress rule grows as the viewport moves down', async ({ page }) => {
    await seedPinned(page);
    const card = page.getByTestId('scroll-header-card');
    const widths: number[] = [];
    for (const y of [-300, -700, -1500]) {
      await page.evaluate((y) => (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y, scale: 1 }), y);
      const box = await card.boundingBox(); const image = await shot(page); let width = 0;
      for (let x = Math.floor(box!.x + 2); x < box!.x + box!.width - 2; x++) { if (near(image.at(x, box!.y + box!.height - 3), [20, 24, 26], 25)) width++; else if (width) break; }
      widths.push(width);
    }
    expect(widths[1]).toBeGreaterThanOrEqual(widths[0]); expect(widths[2]).toBeGreaterThan(widths[1]);
  });

  test('scroll mode paints a background-colour sheet gap with page number 2', async ({ page }) => {
    await page.evaluate(() => {
      const S = (window as any).__POWERNOTE_STORES__; S.workspace.getState().updateSettings({ backgroundMode: 'scroll', bgColor: '#111418' });
      S.canvas.getState().addNode({ id: 'page-three', type: 'text', x: 60, y: 2300, width: 120, height: 30, layer: 2, data: { text: 'bottom', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#14181A' } });
      S.canvas.getState().setViewport({ x: 0, y: -1100, scale: 1 });
    });
    await page.waitForFunction(() => (window as any).Konva.stages[0].find('.scroll-page-number').some((n: any) => n.text() === '2'));
    const gap = await page.evaluate(() => { const stage = (window as any).Konva.stages[0]; const rect = stage.find('.scroll-sheet-gap')[0].getClientRect(); const box = stage.container().getBoundingClientRect(); return { x: box.left + rect.x, y: box.top + rect.y }; });
    const image = await shot(page);
    expect(near(image.at(gap.x + 80, gap.y + 8), [17, 20, 24], 8)).toBe(true);
  });

  test('card height remains 44 screen pixels at 50% and 200% zoom', async ({ page }) => {
    await seedPinned(page);
    for (const scale of [0.5, 2]) {
      await page.evaluate((scale) => (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: -300 * scale, scale }), scale);
      const box = await page.getByTestId('scroll-header-card').boundingBox(); expect(box?.height).toBeCloseTo(44, 1);
    }
  });

  test('fully scrolled up, the card never covers the first content row at any zoom', async ({ page }) => {
    // Covers: REQ-SCROLL-040, REQ-CANVAS-045
    await page.evaluate(() => {
      const S = (window as any).__POWERNOTE_STORES__;
      const ws = S.workspace.getState();
      ws.renameScroll(ws.activePageId, ws.getActivePage().scrolls[0].id, 'Requirements');
      S.canvas.getState().addNode({
        id: 'first-row', type: 'text', x: 60, y: 0, width: 400, height: 40, layer: 2,
        data: { text: 'First line under the card', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#14181A' },
      });
    });
    const card = page.getByTestId('scroll-header-card').first();
    const block = page.getByText('First line under the card');
    for (const scale of [0.45, 1, 2]) {
      // Ask for a camera far above the top; the clamp brings it back to the card strip.
      await page.evaluate((s) => {
        (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: 5000, scale: s });
      }, scale);
      await page.waitForTimeout(100);
      const cardBox = (await card.boundingBox())!;
      const blockBox = (await block.boundingBox())!;
      expect(cardBox.height).toBeCloseTo(44, 0);
      expect(blockBox.y).toBeGreaterThanOrEqual(cardBox.y + cardBox.height + 6 - 0.5);
    }
  });
});
