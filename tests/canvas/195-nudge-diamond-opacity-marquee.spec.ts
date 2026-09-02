/**
 * Test 195: Keyboard nudge, diamond, opacity, select-tool marquee, pan
 * Covers: REQ-CANVAS-002, REQ-CANVAS-013, REQ-CANVAS-043, REQ-CANVAS-044,
 *         REQ-SHAPE-026, REQ-SHAPE-027
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { getCanvasStore, waitForCanvasReady } from '../helpers';

const rectData = {
  shapeType: 'rect',
  fill: '#dbeafe',
  stroke: '#2563eb',
  strokeWidth: 2,
  strokeDash: [],
};

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

async function canvasBox(page: Page) {
  const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not visible');
  return { canvas, box };
}

test.describe('195 - Nudge, diamond, opacity, marquee, pan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: 0, scale: 1 });
    });
  });

  test('arrow keys nudge a rect and a stroke by 1 and by 10; Ctrl+Z reverts a press', async ({ page }) => {
    await page.evaluate((data) => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.canvas.getState().addNode({
        id: 'nudge-rect', type: 'shape', x: 100, y: 120, width: 80, height: 40, layer: 3, data,
      });
      stores.draw.getState().addStroke({
        id: 'nudge-ink', points: [300, 140, 360, 160], color: '#111827', strokeWidth: 3,
      });
      stores.canvas.getState().selectNode('nudge-rect', false);
    }, rectData);

    await page.keyboard.press('ArrowRight');
    let store = await getCanvasStore(page);
    expect(store.nodes.find((n: any) => n.id === 'nudge-rect').x).toBe(101);

    await page.keyboard.press('Control+z');
    store = await getCanvasStore(page);
    expect(store.nodes.find((n: any) => n.id === 'nudge-rect').x).toBe(100);

    await page.keyboard.press('Shift+ArrowRight');
    store = await getCanvasStore(page);
    expect(store.nodes.find((n: any) => n.id === 'nudge-rect').x).toBe(110);

    await page.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.canvas.getState().clearSelection();
      stores.draw.getState().selectStrokes(['nudge-ink']);
    });
    const before = await page.evaluate(() =>
      (window as any).__POWERNOTE_STORES__.draw.getState().strokes.find((s: any) => s.id === 'nudge-ink').points.slice(),
    );
    await page.keyboard.press('ArrowDown');
    const after1 = await page.evaluate(() =>
      (window as any).__POWERNOTE_STORES__.draw.getState().strokes.find((s: any) => s.id === 'nudge-ink').points,
    );
    expect(after1[1]).toBe(before[1] + 1);
    expect(after1[3]).toBe(before[3] + 1);

    await page.keyboard.press('Shift+ArrowDown');
    const after10 = await page.evaluate(() =>
      (window as any).__POWERNOTE_STORES__.draw.getState().strokes.find((s: any) => s.id === 'nudge-ink').points,
    );
    expect(after10[1]).toBe(before[1] + 11);
  });

  test('Ctrl+D does not switch tools', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setTool('select');
    });
    await page.keyboard.press('Control+d');
    const tool = await page.evaluate(() => (window as any).__POWERNOTE_STORES__.tool.getState().activeTool);
    expect(tool).toBe('select');
  });

  test('diamond creates, renders 4 points, and round-trips', async ({ page }) => {
    await page.evaluate(() => {
      const tool = (window as any).__POWERNOTE_STORES__.tool.getState();
      tool.setTool('shape');
      tool.setShapeOptions({ shapeType: 'diamond' });
    });
    const { canvas } = await canvasBox(page);
    await dragShape(canvas, { x: 220, y: 200 }, { x: 340, y: 320 });
    await page.waitForTimeout(200);

    const created = await page.evaluate(() => {
      const node = (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.find((n: any) => n.type === 'shape');
      const stage = (window as any).Konva.stages[0];
      const group = stage.findOne((n: any) => n.getAttr && n.getAttr('nodeId') === node.id);
      const line = group?.findOne('Line');
      return {
        shapeType: node.data.shapeType,
        points: line ? line.points() : null,
        closed: line ? line.closed() : null,
      };
    });
    expect(created.shapeType).toBe('diamond');
    expect(created.closed).toBe(true);
    expect(created.points).toHaveLength(8);

    const roundTrip = await page.evaluate(async () => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.workspace.getState().savePageNodes(stores.canvas.getState().nodes);
      const serialization = await import('/src/utils/serialization.ts');
      return serialization.deserializeWorkspace(serialization.serializeWorkspace(stores.workspace.getState().workspace));
    });
    expect(roundTrip.sections[0].pages[0].nodes[0].data.shapeType).toBe('diamond');
  });

  test('opacity set from the toolbar reaches the Konva node and round-trips', async ({ page }) => {
    await page.evaluate((data) => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.canvas.getState().addNode({
        id: 'op-shape', type: 'shape', x: 140, y: 140, width: 80, height: 60, layer: 3,
        data: { ...data },
      });
      stores.canvas.getState().selectNode('op-shape', false);
    }, rectData);
    await page.locator('[data-testid="opacity-trigger"]').click();
    await expect(page.locator('[data-testid="opacity-slider"]')).toBeVisible();
    await page.locator('[data-testid="opacity-slider"]').fill('40');
    await page.waitForTimeout(100);

    const result = await page.evaluate(async () => {
      const stores = (window as any).__POWERNOTE_STORES__;
      const node = stores.canvas.getState().nodes.find((n: any) => n.id === 'op-shape');
      const stage = (window as any).Konva.stages[0];
      const group = stage.findOne((n: any) => n.getAttr && n.getAttr('nodeId') === 'op-shape');
      stores.workspace.getState().savePageNodes(stores.canvas.getState().nodes);
      const serialization = await import('/src/utils/serialization.ts');
      const roundTrip = serialization.deserializeWorkspace(
        serialization.serializeWorkspace(stores.workspace.getState().workspace),
      );
      return {
        dataOpacity: node.data.opacity,
        konvaOpacity: group?.opacity(),
        saved: roundTrip.sections[0].pages[0].nodes[0].data.opacity,
      };
    });
    expect(result.dataOpacity).toBeCloseTo(0.4);
    expect(result.konvaOpacity).toBeCloseTo(0.4);
    expect(result.saved).toBeCloseTo(0.4);
  });

  test('select-tool background drag selects two rects and a stroke', async ({ page }) => {
    await page.evaluate((data) => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.tool.getState().setTool('select');
      stores.canvas.getState().addNode({
        id: 'mq-a', type: 'shape', x: 120, y: 120, width: 50, height: 50, layer: 3, data,
      });
      stores.canvas.getState().addNode({
        id: 'mq-b', type: 'shape', x: 200, y: 120, width: 50, height: 50, layer: 3, data,
      });
      stores.draw.getState().addStroke({
        id: 'mq-ink', points: [140, 200, 230, 200], color: '#111827', strokeWidth: 4,
      });
    }, rectData);
    await page.waitForTimeout(100);

    const { canvas, box } = await canvasBox(page);
    await dragShape(
      canvas,
      { x: box.x + 90, y: box.y + 90 },
      { x: box.x + 280, y: box.y + 230 },
    );
    await page.waitForTimeout(150);

    const selected = await page.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      return {
        nodes: stores.canvas.getState().selectedNodeIds,
        strokes: stores.draw.getState().selectedStrokeIds,
        tool: stores.tool.getState().activeTool,
      };
    });
    expect(selected.nodes).toEqual(expect.arrayContaining(['mq-a', 'mq-b']));
    expect(selected.strokes).toContain('mq-ink');
    expect(selected.tool).toBe('select');
  });

  test('Space+drag, middle-button drag, and H-tool drag pan', async ({ page }) => {
    const { box } = await canvasBox(page);
    const start = { x: box.x + 400, y: box.y + 300 };

    const beforeSpace = await getCanvasStore(page);
    await page.keyboard.down('Space');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 80, start.y + 60, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    await page.waitForTimeout(100);
    const afterSpace = await getCanvasStore(page);
    expect(afterSpace.viewport.x).toBeGreaterThan(beforeSpace.viewport.x);
    expect(afterSpace.viewport.y).toBeGreaterThan(beforeSpace.viewport.y);

    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: 0, scale: 1 });
    });
    const beforeMiddle = await getCanvasStore(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(start.x + 70, start.y + 50, { steps: 8 });
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(100);
    const afterMiddle = await getCanvasStore(page);
    expect(afterMiddle.viewport.x).toBeGreaterThan(beforeMiddle.viewport.x);
    expect(afterMiddle.viewport.y).toBeGreaterThan(beforeMiddle.viewport.y);

    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: 0, scale: 1 });
      (window as any).__POWERNOTE_STORES__.tool.getState().setTool('hand');
    });
    const beforeHand = await getCanvasStore(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 90, start.y + 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const afterHand = await getCanvasStore(page);
    expect(afterHand.viewport.x).toBeGreaterThan(beforeHand.viewport.x);
    expect(afterHand.viewport.y).toBeGreaterThan(beforeHand.viewport.y);
    const tool = await page.evaluate(() => (window as any).__POWERNOTE_STORES__.tool.getState().activeTool);
    expect(tool).toBe('hand');
  });
});
