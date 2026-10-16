/**
 * Test 197: Shape tool flow
 * Covers: REQ-SHAPE-028, REQ-SHAPE-029
 */
import { test, expect, type Locator } from '@playwright/test';
import { getCanvasStore, textEditor, waitForCanvasReady } from '../helpers';

const SHAPES = [
  ['rect', 'Rectangle'],
  ['circle', 'Circle'],
  ['triangle', 'Triangle'],
  ['diamond', 'Diamond'],
  ['arrow', 'Arrow'],
  ['line', 'Line'],
] as const;

async function drag(canvas: Locator, from: { x: number; y: number }, to: { x: number; y: number }) {
  const base = { pointerId: 197, pointerType: 'mouse', isPrimary: true, buttons: 1 };
  await canvas.dispatchEvent('pointerdown', { ...base, clientX: from.x, clientY: from.y });
  await canvas.dispatchEvent('pointermove', { ...base, clientX: to.x, clientY: to.y });
  await canvas.dispatchEvent('pointerup', { ...base, buttons: 0, clientX: to.x, clientY: to.y });
}

async function toolState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const tool = (window as any).__POWERNOTE_STORES__.tool.getState();
    return { activeTool: tool.activeTool, shapeType: tool.shapeOptions.shapeType };
  });
}

test.describe('197 - Shape tool flow (REQ-SHAPE-028, REQ-SHAPE-029)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('each floating shape button shows its canonical digit and title', async ({ page }) => {
    await page.keyboard.press('1');

    for (const [index, [type, label]] of SHAPES.entries()) {
      const key = String(index + 1);
      const bindingHint = type === 'arrow' || type === 'line' ? ' — Ctrl: no binding' : '';
      await expect(page.locator(`[data-testid="shape-type-${type}"]`)).toHaveAttribute('title', `${label} — ${key}${bindingHint}`);
      await expect(page.locator(`[data-testid="shape-key-${type}"]`)).toHaveText(key);
    }
  });

  test('digits choose shapes without stealing typing or Shift+1 zoom', async ({ page }) => {
    await page.keyboard.press('4');
    await expect(page.locator('[data-testid="shape-toolbar"]')).toBeVisible();
    await expect(page.locator('[data-testid="shape-type-diamond"]')).toHaveClass(/text-toolbar__btn--active/);
    expect(await toolState(page)).toEqual({ activeTool: 'shape', shapeType: 'diamond' });

    await page.keyboard.press('6');
    await expect(page.locator('[data-testid="shape-type-line"]')).toHaveClass(/text-toolbar__btn--active/);
    expect(await toolState(page)).toEqual({ activeTool: 'shape', shapeType: 'line' });

    await page.keyboard.press('Control+Digit2');
    await page.keyboard.press('Alt+Digit2');
    expect(await toolState(page)).toEqual({ activeTool: 'shape', shapeType: 'line' });

    // Place real text through the text tool so its inline editor owns focus.
    await page.keyboard.press('t');
    const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
    await canvas.click({ position: { x: 550, y: 450 } });
    const editor = textEditor(page);
    await expect(editor).toBeVisible();
    await editor.focus();
    await page.keyboard.press('4');
    expect(await toolState(page)).toEqual({ activeTool: 'select', shapeType: 'line' });

    await page.keyboard.press('Escape');
    await expect(editor).not.toBeVisible();
    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().setZoom(3));
    await page.keyboard.press('Shift+Digit1');
    expect((await getCanvasStore(page)).viewport.scale).not.toBe(3);
    expect((await toolState(page)).activeTool).toBe('select');
  });

  test('a committed rectangle or arrow selects itself and returns to select', async ({ page }) => {
    await page.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.draw.getState().addStroke({
        id: 'preselected-ink', points: [20, 20, 60, 20], color: '#111827', strokeWidth: 3,
      });
      stores.draw.getState().selectStrokes(['preselected-ink']);
    });

    const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
    await page.keyboard.press('1');
    await drag(canvas, { x: 220, y: 200 }, { x: 360, y: 300 });

    const rectState = await getCanvasStore(page);
    const rect = rectState.nodes.find((node: any) => node.type === 'shape');
    expect(rect).toBeDefined();
    expect(rectState.selectedNodeIds).toEqual([rect!.id]);
    expect(await toolState(page)).toEqual({ activeTool: 'select', shapeType: 'rect' });
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().selectedStrokeIds)).toEqual([]);
    await expect.poll(() => page.evaluate((id) => {
      const transformer = (window as any).Konva.stages[0]?.findOne('Transformer');
      return transformer?.nodes().some((node: any) => node.getAttr('nodeId') === id) ?? false;
    }, rect!.id)).toBe(true);

    // Select-tool drag is now a marquee, not another rectangle creation.
    await drag(canvas, { x: 150, y: 150 }, { x: 420, y: 360 });
    expect((await getCanvasStore(page)).nodes.filter((node: any) => node.type === 'shape')).toHaveLength(1);
    expect((await getCanvasStore(page)).selectedNodeIds).toEqual([rect!.id]);

    await page.keyboard.press('5');
    await drag(canvas, { x: 500, y: 420 }, { x: 650, y: 480 });
    const arrowState = await getCanvasStore(page);
    const arrow = arrowState.nodes.find((node: any) => node.type === 'shape' && node.data.shapeType === 'arrow');
    expect(arrow).toBeDefined();
    expect(arrowState.selectedNodeIds).toEqual([arrow!.id]);
    expect(await toolState(page)).toEqual({ activeTool: 'select', shapeType: 'arrow' });
  });
});
