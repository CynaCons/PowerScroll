/**
 * Test 205: Shape previews during drag
 * Covers: REQ-SHAPE-035
 *
 * Verifies the in-progress shape is painted above a selected text block before
 * pointer-up. Pixels come from a real page screenshot, so this covers Konva
 * canvas layers and the text block's HTML overlay as the user sees them.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

const PREVIEW_STROKE = '#dc2626';

async function addSelectedTextBlock(page: Page) {
  await page.evaluate(() => {
    const stores = (window as any).__POWERNOTE_STORES__;
    stores.canvas.getState().addNode({
      id: 'preview-text-block',
      type: 'text',
      x: 120,
      y: 140,
      width: 260,
      height: 180,
      layer: 4,
      data: {
        text: 'Existing text block',
        fontSize: 18,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontStyle: 'normal',
        fill: '#1a1a1a',
      },
    });
    stores.canvas.setState({ selectedNodeIds: ['preview-text-block'] });
    stores.tool.getState().setTool('shape');
    stores.tool.getState().setShapeOptions({
      stroke: '#dc2626',
      strokeWidth: 4,
      fill: 'transparent',
      shapeType: 'rect',
    });
  });
  await page.locator('.powernote-markdown--selected').waitFor({ state: 'visible' });
}

async function startDrag(
  canvas: Locator,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  const base = { pointerId: 7, pointerType: 'pen', isPrimary: true, buttons: 1 };
  await canvas.dispatchEvent('pointerdown', {
    ...base,
    clientX: box.x + from.x,
    clientY: box.y + from.y,
  });
  await canvas.dispatchEvent('pointermove', {
    ...base,
    clientX: box.x + to.x,
    clientY: box.y + to.y,
  });
  return box;
}

async function screenshotPixel(page: Page, x: number, y: number) {
  const screenshot = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ screenshot, x, y }) => {
    const binary = atob(screenshot);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const image = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = image.getContext('2d');
    if (!context) throw new Error('Unable to read screenshot pixels');
    context.drawImage(bitmap, 0, 0);
    return Array.from(context.getImageData(x, y, 1, 1).data);
  }, { screenshot, x, y });
}

function expectPreviewStroke([red, green, blue, alpha]: number[]) {
  expect(alpha).toBeGreaterThan(240);
  expect(red).toBeGreaterThan(180);
  expect(green).toBeLessThan(80);
  expect(blue).toBeLessThan(80);
}

test.describe('205 - Shape preview while dragging (REQ-SHAPE-035)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await addSelectedTextBlock(page);
  });

  test('rectangle preview paints over an existing text block before pointer-up', async ({ page }) => {
    const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
    const box = await startDrag(canvas, { x: 140, y: 160 }, { x: 340, y: 280 });

    // This point is inside the selected text block's blue background. The
    // preview stroke must therefore be in the final composited image.
    expectPreviewStroke(await screenshotPixel(page, Math.round(box.x + 144), Math.round(box.y + 160)));
  });

  test('ellipse and arrow previews are visible mid-drag, with an arrowhead', async ({ page }) => {
    const canvas = page.locator('[data-testid="canvas-container"] canvas').last();

    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setShapeOptions({ shapeType: 'circle' });
    });
    let box = await startDrag(canvas, { x: 160, y: 180 }, { x: 320, y: 280 });
    expectPreviewStroke(await screenshotPixel(page, Math.round(box.x + 240), Math.round(box.y + 180)));

    await canvas.dispatchEvent('pointerup', {
      pointerId: 7,
      pointerType: 'pen',
      isPrimary: true,
      buttons: 0,
      clientX: box.x + 320,
      clientY: box.y + 280,
    });
    await page.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.tool.getState().setTool('shape');
      stores.tool.getState().setShapeOptions({ shapeType: 'arrow' });
    });

    box = await startDrag(canvas, { x: 150, y: 240 }, { x: 330, y: 240 });
    // This is above the shaft, inside the head at the arrow endpoint. A Line
    // preview would leave it untouched.
    expectPreviewStroke(await screenshotPixel(page, Math.round(box.x + 322), Math.round(box.y + 244)));
  });
});
