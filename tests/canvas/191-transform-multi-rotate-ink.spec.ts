/**
 * Test 191: multi-transform, modifiers, rotation and freehand ink
 * Covers: REQ-CANVAS-031, REQ-CANVAS-032, REQ-CANVAS-033, REQ-CANVAS-034,
 *         REQ-CANVAS-035, REQ-SHAPE-010
 */
import { test, expect, type Page } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

async function seed(page: Page, strokesOnly = false) {
  await page.evaluate(({ strokesOnly }) => {
    const stores = (window as any).__POWERNOTE_STORES__;
    stores.canvas.setState({ nodes: [], selectedNodeIds: [] });
    if (!strokesOnly) {
      for (const [id, x] of [['transform-a', 180], ['transform-b', 380]] as const) {
        stores.canvas.getState().addNode({
          id, type: 'shape', x, y: 180, width: 100, height: 60, layer: 3,
          data: { shapeType: 'rect', fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 2, strokeDash: [] },
        });
      }
      stores.canvas.setState({ selectedNodeIds: ['transform-a', 'transform-b'] });
    }
    stores.draw.setState({
      strokes: [{ id: 'transform-ink', points: [230, 310, 330, 330], color: '#111827', strokeWidth: 4 }],
      selectedStrokeIds: ['transform-ink'],
    });
  }, { strokesOnly });
  await page.waitForTimeout(100);
}

/** Dispatch real PointerEvents to Konva's stage container (not synthetic mouse events). */
async function dragAnchor(page: Page, anchor: string, dx: number, dy: number, modifiers: { shiftKey?: boolean; altKey?: boolean } = {}) {
  const point = await page.evaluate(({ anchor }) => {
    const stage = (window as any).Konva.stages[0];
    const transformer = stage.findOne('Transformer');
    const handle = transformer.findOne(`.${anchor}`);
    if (!handle) throw new Error(`Missing ${anchor} anchor`);
    const handleRect = handle.getClientRect();
    const rect = stage.container().getBoundingClientRect();
    return { x: rect.left + handleRect.x + handleRect.width / 2, y: rect.top + handleRect.y + handleRect.height / 2 };
  }, { anchor });
  if (modifiers.shiftKey) await page.keyboard.down('Shift');
  if (modifiers.altKey) await page.keyboard.down('Alt');
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 4 });
  await page.mouse.up();
  if (modifiers.shiftKey) await page.keyboard.up('Shift');
  if (modifiers.altKey) await page.keyboard.up('Alt');
  await page.waitForTimeout(100);
}

async function dragRotationTo45(page: Page) {
  const move = await page.evaluate(() => {
    const stage = (window as any).Konva.stages[0];
    const handle = stage.findOne('Transformer').findOne('.rotater');
    const h = handle.getClientRect();
    const t = stage.findOne('Transformer').findOne('.back').getClientRect();
    const box = stage.container().getBoundingClientRect();
    const x = h.x + h.width / 2;
    const y = h.y + h.height / 2;
    const cx = t.x + t.width / 2;
    const cy = t.y + t.height / 2;
    const angle = Math.PI / 2;
    const vx = x - cx;
    const vy = y - cy;
    return { x: box.left + x, y: box.top + y, dx: vx * Math.cos(angle) - vy * Math.sin(angle) - vx, dy: vx * Math.sin(angle) + vy * Math.cos(angle) - vy };
  });
  await page.mouse.move(move.x, move.y);
  await page.mouse.down();
  await page.mouse.move(move.x + move.dx, move.y + move.dy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

test.describe('191 - Transformer completeness', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('multi-resize transforms two shapes and ink in one undo frame', async ({ page }) => {
    await seed(page);
    const before = await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().strokes[0].points);
    await dragAnchor(page, 'bottom-right', 120, 60);
    const scaled = await page.evaluate(() => {
      const s = (window as any).__POWERNOTE_STORES__;
      return { nodes: s.canvas.getState().nodes, points: s.draw.getState().strokes[0].points };
    });
    expect(scaled.nodes.find((n: any) => n.id === 'transform-a').width).toBeGreaterThan(100);
    expect(scaled.nodes.find((n: any) => n.id === 'transform-b').width).toBeGreaterThan(100);
    expect(scaled.points).not.toEqual(before);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().strokes[0].points)).toEqual(before);
  });

  test('Shift preserves the selection ratio and Alt preserves its centre', async ({ page }) => {
    await seed(page);
    const before = await page.evaluate(() => {
      const t = (window as any).Konva.stages[0].findOne('Transformer').getClientRect();
      return { ratio: t.width / t.height, x: t.x + t.width / 2, y: t.y + t.height / 2 };
    });
    await dragAnchor(page, 'bottom-right', 90, 15, { shiftKey: true });
    const ratio = await page.evaluate(() => {
      const n = (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.find((node: any) => node.id === 'transform-a');
      return n.width / n.height;
    });
    expect(ratio).toBeCloseTo(100 / 60, 1);
    await seed(page);
    await page.keyboard.down('Alt');
    await dragAnchor(page, 'bottom-right', 80, 50, { altKey: true });
    await page.keyboard.up('Alt');
    const after = await page.evaluate(() => {
      const t = (window as any).Konva.stages[0].findOne('Transformer').getClientRect();
      return { x: t.x + t.width / 2, y: t.y + t.height / 2 };
    });
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  test('rotation snaps and survives serialized workspace data', async ({ page }) => {
    await seed(page);
    await dragRotationTo45(page);
    const rotation = await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().nodes[0].data.rotation);
    expect(Math.abs(rotation % 45)).toBeLessThan(0.1);
    const roundTrip = await page.evaluate(async () => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.workspace.getState().savePageNodes(stores.canvas.getState().nodes);
      const serialization = await import('/src/utils/serialization.ts');
      const workspace = stores.workspace.getState().workspace;
      return serialization.deserializeWorkspace(serialization.serializeWorkspace(workspace));
    });
    expect(roundTrip.sections[0].pages[0].nodes[0].data.rotation).toBe(rotation);
  });

  test('a stroke-only lasso selection has resize handles and transforms', async ({ page }) => {
    await seed(page, true);
    const before = await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().strokes[0].points);
    await dragAnchor(page, 'bottom-right', 80, 40);
    const after = await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().strokes[0].points);
    expect(after).not.toEqual(before);
  });
});
