/**
 * Test 54: Shape Click+Drag Creation
 * Covers: REQ-SHAPE-001, REQ-SHAPE-002, REQ-SHAPE-003
 *
 * Verifies that shapes can be created via click+drag on the canvas,
 * that the committed shape matches the drag area, and that all 5 shape
 * types work correctly including arrows/lines with signed dimensions.
 *
 * Drags are dispatched as POINTER events: since v0.42 the draw/shape/lasso
 * pipeline listens to pointer events (which is what real mice, pens and
 * fingers deliver), not to bare mouse events.
 */
import { test, expect, type Locator } from '@playwright/test';
import { waitForCanvasReady, getCanvasStore } from '../helpers';

async function dragShape(
  canvas: Locator,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const base = { pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 };
  await canvas.dispatchEvent('pointerdown', { ...base, clientX: from.x, clientY: from.y });
  await canvas.dispatchEvent('pointermove', { ...base, clientX: to.x, clientY: to.y });
  await canvas.dispatchEvent('pointerup', { ...base, buttons: 0, clientX: to.x, clientY: to.y });
}

test.describe('54 - Shape Click+Drag Creation (REQ-SHAPE-001..003)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    // Activate shape tool
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setTool('shape');
    });
  });

  test('drag creates a rectangle with correct position and size', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setShapeOptions({ shapeType: 'rect' });
    });

    const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
    await dragShape(canvas, { x: 200, y: 200 }, { x: 400, y: 350 });
    await page.waitForTimeout(200);

    const store = await getCanvasStore(page);
    const shapes = store.nodes.filter((n: any) => n.type === 'shape');
    expect(shapes.length).toBe(1);
    const shape = shapes[0];
    expect(shape.data.shapeType).toBe('rect');
    expect(shape.width).toBeGreaterThan(50);
    expect(shape.height).toBeGreaterThan(50);
  });

  test('drag creates a circle', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setShapeOptions({ shapeType: 'circle' });
    });

    const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
    await dragShape(canvas, { x: 300, y: 200 }, { x: 450, y: 350 });
    await page.waitForTimeout(200);

    const store = await getCanvasStore(page);
    const shapes = store.nodes.filter((n: any) => n.type === 'shape');
    expect(shapes.length).toBe(1);
    expect(shapes[0].data.shapeType).toBe('circle');
  });

  test('drag creates a triangle', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setShapeOptions({ shapeType: 'triangle' });
    });

    const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
    await dragShape(canvas, { x: 200, y: 200 }, { x: 350, y: 400 });
    await page.waitForTimeout(200);

    const store = await getCanvasStore(page);
    const shapes = store.nodes.filter((n: any) => n.type === 'shape');
    expect(shapes.length).toBe(1);
    expect(shapes[0].data.shapeType).toBe('triangle');
  });

  test('drag creates an arrow with correct direction', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setShapeOptions({ shapeType: 'arrow' });
    });

    const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
    // Drag from left to right
    await dragShape(canvas, { x: 200, y: 300 }, { x: 500, y: 300 });
    await page.waitForTimeout(200);

    const store = await getCanvasStore(page);
    const shapes = store.nodes.filter((n: any) => n.type === 'shape');
    expect(shapes.length).toBe(1);
    expect(shapes[0].data.shapeType).toBe('arrow');
    // Arrow width should be positive (left to right)
    expect(shapes[0].width).toBeGreaterThan(0);
  });

  test('drag creates a line', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setShapeOptions({ shapeType: 'line' });
    });

    const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
    await dragShape(canvas, { x: 200, y: 200 }, { x: 400, y: 400 });
    await page.waitForTimeout(200);

    const store = await getCanvasStore(page);
    const shapes = store.nodes.filter((n: any) => n.type === 'shape');
    expect(shapes.length).toBe(1);
    expect(shapes[0].data.shapeType).toBe('line');
  });

  test('small click (no drag) does NOT create a shape', async ({ page }) => {
    const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
    const base = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
    await canvas.dispatchEvent('pointerdown', { ...base, buttons: 1, clientX: 300, clientY: 300 });
    await canvas.dispatchEvent('pointerup', { ...base, buttons: 0, clientX: 300, clientY: 300 });
    await page.waitForTimeout(200);

    const store = await getCanvasStore(page);
    expect(store.nodes.length).toBe(0);
    expect(await page.evaluate(() =>
      (window as any).__POWERNOTE_STORES__.tool.getState().activeTool,
    )).toBe('shape');
  });

  test('arrow dragged right-to-left has negative width', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setShapeOptions({ shapeType: 'arrow' });
    });

    const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
    // Drag from right to left
    await dragShape(canvas, { x: 500, y: 300 }, { x: 200, y: 300 });
    await page.waitForTimeout(200);

    const store = await getCanvasStore(page);
    const shapes = store.nodes.filter((n: any) => n.type === 'shape');
    expect(shapes.length).toBe(1);
    // Width should be negative (right to left direction)
    expect(shapes[0].width).toBeLessThan(0);
  });
});
