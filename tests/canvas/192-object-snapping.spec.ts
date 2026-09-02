/**
 * Test 192: Object snapping
 * Covers: REQ-CANVAS-036, REQ-CANVAS-037, REQ-CANVAS-038, REQ-CANVAS-039
 */
import { test, expect, type Page } from '@playwright/test';
import { calculateSnap } from '../../src/components/canvas/SnapGuides';
import { waitForCanvasReady, getCanvasStore } from '../helpers';

const rectData = { shapeType: 'rect', fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 2, strokeDash: [] };

async function seed(page: Page, nodes: { id: string; x: number; y: number; width?: number; height?: number }[]) {
  await page.evaluate(({ nodes, rectData }) => {
    const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
    nodes.forEach((node: any) => canvas.addNode({
      id: node.id, type: 'shape', x: node.x, y: node.y,
      width: node.width ?? 50, height: node.height ?? 50, layer: 3, data: rectData,
    }));
  }, { nodes, rectData });
  await page.waitForTimeout(100);
}

async function dragCanvasNode(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { shiftKey?: boolean } = {},
) {
  const stage = page.locator('[data-testid="canvas-container"] .konvajs-content');
  const box = await stage.boundingBox();
  if (!box) throw new Error('Konva stage is not visible');
  // Playwright's mouse emits PointerEvents to the Konva stage container; this
  // reaches Konva's hit graph unlike synthetic React mouse events.
  await page.mouse.move(box.x + from.x, box.y + from.y);
  if (options.shiftKey) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y);
  await page.mouse.up();
  if (options.shiftKey) await page.keyboard.up('Shift');
  await page.waitForTimeout(100);
}

test.describe('192 - Object snapping', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('is on by default, Shift bypasses it, and the Settings preference persists', async ({ page }) => {
    await seed(page, [{ id: 'reference', x: 200, y: 200 }, { id: 'dragged', x: 300, y: 200 }]);
    await dragCanvasNode(page, { x: 325, y: 225 }, { x: 230, y: 225 }); // left edge misses by 5
    expect((await getCanvasStore(page)).nodes.find((node: any) => node.id === 'dragged')?.x).toBe(200);

    await page.reload();
    await waitForCanvasReady(page);
    await seed(page, [{ id: 'reference', x: 200, y: 200 }, { id: 'dragged', x: 300, y: 200 }]);
    await dragCanvasNode(page, { x: 325, y: 225 }, { x: 230, y: 225 }, { shiftKey: true });
    expect((await getCanvasStore(page)).nodes.find((node: any) => node.id === 'dragged')?.x).toBe(205);

    await page.locator('[data-testid="nav-settings"]').click();
    await page.locator('[data-testid="settings-snap-to-objects"]').uncheck();
    await page.locator('[data-testid="nav-settings"]').click();
    await seed(page, [{ id: 'reference-off', x: 200, y: 200 }, { id: 'dragged-off', x: 300, y: 200 }]);
    await dragCanvasNode(page, { x: 325, y: 225 }, { x: 230, y: 225 });
    expect((await getCanvasStore(page)).nodes.find((node: any) => node.id === 'dragged-off')?.x).toBe(205);
    await page.reload();
    await waitForCanvasReady(page);
    await page.locator('[data-testid="nav-settings"]').click();
    await expect(page.locator('[data-testid="settings-snap-to-objects"]')).not.toBeChecked();
  });

  test('uses a screen-constant threshold and equal side gaps while dragging', async ({ page }) => {
    await seed(page, [{ id: 'reference', x: 200, y: 200 }, { id: 'dragged', x: 300, y: 200 }]);
    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ scale: 0.5 }));
    // A 12-canvas-pixel miss is 6 screen pixels at 0.5x, inside the 8px threshold.
    await dragCanvasNode(page, { x: 162.5, y: 112.5 }, { x: 118.5, y: 112.5 });
    expect((await getCanvasStore(page)).nodes.find((node: any) => node.id === 'dragged')?.x).toBe(200);

    await page.evaluate(() => {
      const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
      canvas.setViewport({ x: 0, y: 0, scale: 1 });
      canvas.loadPageNodes([]);
    });
    await seed(page, [{ id: 'a', x: 100, y: 200 }, { id: 'b', x: 190, y: 200 }, { id: 'c', x: 330, y: 200 }]);
    await dragCanvasNode(page, { x: 355, y: 225 }, { x: 309, y: 225 });
    expect((await getCanvasStore(page)).nodes.find((node: any) => node.id === 'c')?.x).toBe(280);
  });

  test('calculates centre-in-gap and equal-side-gap candidates as a pure function', () => {
    const nodes = [
      { id: 'a', x: 100, y: 100, width: 50, height: 50 },
      { id: 'b', x: 190, y: 100, width: 50, height: 50 },
      { id: 'c', x: 284, y: 100, width: 50, height: 50 },
    ];
    const equal = calculateSnap(nodes[2], nodes, 8);
    expect(equal.x).toBe(280);
    expect(equal.lines.some((line) => 'kind' in line && line.axis === 'x' && line.gaps)).toBe(true);

    const centered = calculateSnap({ id: 'c', x: 156, y: 100, width: 20, height: 50 }, nodes.slice(0, 2), 8);
    expect(centered.x).toBe(160);
  });
});
