/**
 * Test 199: Arrow binding controls
 * Covers: REQ-SHAPE-033, REQ-SHAPE-034
 * Cmd is the macOS equivalent of Control; only Control is testable here.
 */
import { expect, test, type Page } from '@playwright/test';
import { closestPointOnOutline } from '../../src/utils/arrowBinding';
import type { CanvasNode } from '../../src/types/data';
import { getCanvasStore, waitForCanvasReady } from '../helpers';

const shapeData = (shapeType: 'rect' | 'circle' | 'triangle' | 'diamond') => ({
  shapeType, fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 2, strokeDash: [],
});
const arrowData = { shapeType: 'arrow' as const, fill: 'transparent', stroke: '#111827', strokeWidth: 2, strokeDash: [] };

function target(id: string, shapeType: 'rect' | 'circle' | 'triangle' | 'diamond', x: number, y: number): CanvasNode {
  return { id, type: 'shape', x, y, width: 120, height: 100, layer: 3, data: shapeData(shapeType) };
}

async function stageBox(page: Page) {
  const box = await page.locator('[data-testid="canvas-container"] .konvajs-content').boundingBox();
  if (!box) throw new Error('Konva stage is not visible');
  return box;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, control = false) {
  const box = await stageBox(page);
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  if (control) await page.keyboard.down('Control');
  await page.mouse.move(box.x + to.x, box.y + to.y);
  await page.mouse.up();
  if (control) await page.keyboard.up('Control');
}

async function seed(page: Page, nodes: CanvasNode[]) {
  await page.evaluate((nodes) => {
    const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
    canvas.loadPageNodes([]);
    nodes.forEach((node: any) => canvas.addNode(node));
  }, nodes);
}

async function selectArrow(page: Page, id = 'arrow') {
  await page.evaluate((id) => (window as any).__POWERNOTE_STORES__.canvas.getState().selectNode(id, false), id);
  await expect.poll(() => page.evaluate((id) => {
    const stage = (window as any).Konva.stages[0];
    return stage?.findOne((node: any) => node.getAttr?.('nodeId') === id)?.find('Circle').length ?? 0;
  }, id)).toBeGreaterThanOrEqual(2);
}

async function hintPosition(page: Page) {
  return page.evaluate(() => {
    const stage = (window as any).Konva.stages[0];
    const anchor = stage?.findOne('.binding-hint-anchor');
    const rect = stage?.findOne('.binding-hint-rect');
    if (!anchor || !rect) return null;
    return anchor.getAbsolutePosition();
  });
}

test.describe('199 - Arrow binding controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('Control suppresses binding while creating an arrow, while an unmodified creation binds', async ({ page }) => {
    const rect = target('rect', 'rect', 400, 200);
    await seed(page, [rect]);
    await page.evaluate(() => {
      const tool = (window as any).__POWERNOTE_STORES__.tool.getState();
      tool.setShapeOptions({ shapeType: 'arrow' });
      tool.setTool('shape');
    });

    await drag(page, { x: 180, y: 250 }, { x: 396, y: 250 }, true);
    let arrows = (await getCanvasStore(page)).nodes.filter((node: any) => node.data.shapeType === 'arrow');
    expect(arrows).toHaveLength(1);
    expect(arrows[0].data.startBinding).toBeNull();
    expect(arrows[0].data.endBinding).toBeNull();
    expect(arrows[0].x + arrows[0].width).toBeCloseTo(396, 1);
    expect(arrows[0].y + arrows[0].height).toBeCloseTo(250, 1);

    await page.evaluate(() => {
      const tool = (window as any).__POWERNOTE_STORES__.tool.getState();
      tool.setShapeOptions({ shapeType: 'arrow' });
      tool.setTool('shape');
    });
    await drag(page, { x: 180, y: 320 }, { x: 396, y: 250 });
    arrows = (await getCanvasStore(page)).nodes.filter((node: any) => node.data.shapeType === 'arrow');
    expect(arrows).toHaveLength(2);
    const bound = arrows[1];
    expect(bound.data.endBinding?.elementId).toBe('rect');
    expect(bound.x + bound.width).toBeCloseTo(400, 1);
    expect(bound.y + bound.height).toBeCloseTo(250, 1);
  });

  test('Control unbinds an existing endpoint without showing a hint', async ({ page }) => {
    const first = target('first', 'rect', 400, 200);
    const second = target('second', 'rect', 650, 200);
    const arrow: CanvasNode = {
      id: 'arrow', type: 'shape', x: 180, y: 250, width: 220, height: 0, layer: 3,
      data: { ...arrowData, endBinding: { elementId: 'first', fixedPoint: [0, 0.5] } },
    };
    await seed(page, [first, second, arrow]);
    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().setArrowBinding('arrow', 'end', { elementId: 'first', fixedPoint: [0, 0.5] }));
    await selectArrow(page);

    const box = await stageBox(page);
    await page.mouse.move(box.x + 400, box.y + 250);
    await page.mouse.down();
    await page.keyboard.down('Control');
    await page.mouse.move(box.x + 646, box.y + 250);
    await expect.poll(() => page.evaluate(() => (window as any).Konva.stages[0].find('.binding-hint-rect').length)).toBe(0);
    await expect.poll(() => page.evaluate(() => (window as any).Konva.stages[0].find('.binding-hint-anchor').length)).toBe(0);
    await page.mouse.up();
    await page.keyboard.up('Control');

    const changed = (await getCanvasStore(page)).nodes.find((node: any) => node.id === 'arrow')!;
    expect(changed.data.endBinding).toBeNull();
    expect(changed.x + changed.width).toBeCloseTo(646, 1);
    expect(changed.y + changed.height).toBeCloseTo(250, 1);
  });

  test('endpoint hints show the release anchor for rect, circle, triangle, and diamond', async ({ page }) => {
    const cases = [
      ['rect', 400, 250], ['circle', 580, 250], ['triangle', 760, 250], ['diamond', 940, 250],
    ] as const;

    for (const [shapeType, x, y] of cases) {
      const node = target(shapeType, shapeType, x, 200);
      const arrow: CanvasNode = { id: 'arrow', type: 'shape', x: 180, y, width: 120, height: 0, layer: 3, data: arrowData };
      await seed(page, [node, arrow]);
      await selectArrow(page);

      const pointer = { x: x - 4, y };
      const expected = closestPointOnOutline(node, pointer);
      const box = await stageBox(page);
      await page.mouse.move(box.x + 300, box.y + y);
      await page.mouse.down();
      await page.mouse.move(box.x + pointer.x, box.y + pointer.y);
      await expect.poll(() => hintPosition(page)).not.toBeNull();
      const position = await hintPosition(page);
      expect(position!.x).toBeCloseTo(expected.x, 1);
      expect(position!.y).toBeCloseTo(expected.y, 1);

      if (shapeType === 'rect') {
        await page.keyboard.down('Control');
        await page.mouse.move(box.x + pointer.x, box.y + pointer.y);
        await expect.poll(() => hintPosition(page)).toBeNull();
        await page.keyboard.up('Control');
        await page.mouse.move(box.x + pointer.x, box.y + pointer.y);
        await expect.poll(() => hintPosition(page)).not.toBeNull();
      }

      await page.mouse.up();
      const changed = (await getCanvasStore(page)).nodes.find((item: any) => item.id === 'arrow')!;
      expect(changed.x + changed.width).toBeCloseTo(expected.x, 1);
      expect(changed.y + changed.height).toBeCloseTo(expected.y, 1);
    }
  });
});
