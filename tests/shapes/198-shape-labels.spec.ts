/**
 * Test 198: Shape labels
 * Covers: REQ-SHAPE-030, REQ-SHAPE-031, REQ-SHAPE-032
 */
import { expect, test } from '@playwright/test';
import { getCanvasStore, waitForCanvasReady } from '../helpers';

async function shapeScreenCenter(page: import('@playwright/test').Page, id: string) {
  await page.waitForFunction((nodeId) => {
    const stage = (window as any).Konva.stages[0];
    const group = stage?.findOne((n: any) => n.getAttr?.('nodeId') === nodeId);
    const node = (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.find((item: any) => item.id === nodeId);
    return Boolean(
      group && node
      && Math.abs(group.x() - node.x) < 0.01
      && Math.abs(group.y() - node.y) < 0.01
      && Math.abs(group.rotation() - (node.data.rotation ?? 0)) < 0.01,
    );
  }, id);
  return page.evaluate((nodeId) => {
    const stage = (window as any).Konva.stages[0];
    const group = stage.findOne((n: any) => n.getAttr?.('nodeId') === nodeId);
    const point = group.getAbsoluteTransform().point({ x: group.width() / 2, y: group.height() / 2 });
    const rect = stage.container().getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  }, id);
}

async function labelAndShapeCenters(page: import('@playwright/test').Page, id: string) {
  return page.evaluate((nodeId) => {
    const stage = (window as any).Konva.stages[0];
    const group = stage.findOne((n: any) => n.getAttr?.('nodeId') === nodeId);
    const label = group.findOne('.shape-label');
    const labelCenter = label.getAbsoluteTransform().point({ x: label.width() / 2, y: label.height() / 2 });
    const shapeCenter = group.getAbsoluteTransform().point({ x: group.width() / 2, y: group.height() / 2 });
    return { labelCenter, shapeCenter };
  }, id);
}

async function waitForLabel(page: import('@playwright/test').Page, id: string) {
  await page.waitForFunction((nodeId) => {
    const stage = (window as any).Konva.stages[0];
    const group = stage?.findOne((n: any) => n.getAttr?.('nodeId') === nodeId);
    return Boolean(group?.findOne('.shape-label'));
  }, id);
}

test.describe('198 - Shape labels', () => {
  test('edits, positions, grows, persists, and retains group isolation', async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await page.evaluate(() => {
      const S = (window as any).__POWERNOTE_STORES__;
      const canvas = S.canvas.getState();
      const shapeData = (shapeType: string) => ({ shapeType, fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 2, strokeDash: [] });
      canvas.addNode({ id: 'rect', type: 'shape', x: 180, y: 150, width: 120, height: 60, layer: 3, data: shapeData('rect') });
      canvas.addNode({ id: 'circle', type: 'shape', x: 380, y: 150, width: 120, height: 80, layer: 3, data: shapeData('circle') });
      canvas.addNode({ id: 'arrow', type: 'shape', x: 580, y: 150, width: 120, height: 60, layer: 3, data: shapeData('arrow') });
      canvas.addNode({ id: 'grouped', type: 'shape', x: 180, y: 310, width: 120, height: 60, layer: 3, groupId: 'g1', data: shapeData('rect') });
      S.history.getState().clear();
    });

    const rectCenter = await shapeScreenCenter(page, 'rect');
    await page.mouse.dblclick(rectCenter.x, rectCenter.y);
    const editor = page.getByTestId('shape-label-editor');
    await expect(editor).toBeVisible();
    await editor.type('Hello world');
    await editor.evaluate((el: HTMLTextAreaElement) => el.blur());
    await expect(editor).toBeHidden();
    expect((await getCanvasStore(page)).nodes.find((node: any) => node.id === 'rect').data.label.text).toBe('Hello world');
    await waitForLabel(page, 'rect');
    let centers = await labelAndShapeCenters(page, 'rect');
    expect(centers.labelCenter.x).toBeCloseTo(centers.shapeCenter.x, 0);
    expect(centers.labelCenter.y).toBeCloseTo(centers.shapeCenter.y, 0);

    await page.keyboard.press('Control+z');
    expect((await getCanvasStore(page)).nodes.find((node: any) => node.id === 'rect').data.label).toBeUndefined();
    await page.keyboard.press('Control+Shift+z');
    expect((await getCanvasStore(page)).nodes.find((node: any) => node.id === 'rect').data.label.text).toBe('Hello world');

    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().selectNode('rect', false));
    await page.keyboard.press('Enter');
    await expect(editor).toBeVisible();
    await editor.press('Control+a');
    await editor.press('Delete');
    await editor.evaluate((el: HTMLTextAreaElement) => el.blur());
    await page.waitForFunction(() => !(window as any).__POWERNOTE_STORES__.canvas.getState().nodes.find((node: any) => node.id === 'rect').data.label);
    expect((await getCanvasStore(page)).nodes.find((node: any) => node.id === 'rect').data.label).toBeUndefined();

    await page.evaluate(() => {
      const store = (window as any).__POWERNOTE_STORES__.canvas;
      const rect = store.getState().nodes.find((node: any) => node.id === 'rect');
      store.getState().updateNode('rect', { x: rect.x + 200, data: { ...rect.data, label: { text: 'Move me' } } });
      const moved = store.getState().nodes.find((node: any) => node.id === 'rect');
      store.getState().updateNode('rect', { data: { ...moved.data, rotation: 45 } });
    });
    await waitForLabel(page, 'rect');
    centers = await labelAndShapeCenters(page, 'rect');
    expect(centers.labelCenter.x).toBeCloseTo(centers.shapeCenter.x, 0);
    expect(centers.labelCenter.y).toBeCloseTo(centers.shapeCenter.y, 0);

    await page.evaluate(() => {
      const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
      canvas.updateNode('rect', { x: 180, y: 150, width: 120, height: 60, data: { ...canvas.nodes.find((node: any) => node.id === 'rect').data, rotation: 0, label: undefined } });
    });
    const before = (await getCanvasStore(page)).nodes.find((node: any) => node.id === 'rect');
    const resetCenter = await shapeScreenCenter(page, 'rect');
    await page.mouse.dblclick(resetCenter.x, resetCenter.y);
    await editor.type('This label wraps across enough words to need more room than sixty pixels');
    await editor.evaluate((el: HTMLTextAreaElement) => el.blur());
    const grown = (await getCanvasStore(page)).nodes.find((node: any) => node.id === 'rect');
    expect(grown.height).toBeGreaterThan(before.height);
    expect(grown).toMatchObject({ x: before.x, y: before.y, width: before.width });

    await page.evaluate(() => {
      const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
      canvas.updateNode('circle', { data: { ...canvas.nodes.find((node: any) => node.id === 'circle').data, label: { text: 'Circle' } } });
    });
    await waitForLabel(page, 'circle');
    centers = await labelAndShapeCenters(page, 'circle');
    expect(centers.labelCenter.x).toBeCloseTo(centers.shapeCenter.x, 0);
    expect(centers.labelCenter.y).toBeCloseTo(centers.shapeCenter.y, 0);
    const arrowCenter = await shapeScreenCenter(page, 'arrow');
    await page.mouse.dblclick(arrowCenter.x, arrowCenter.y);
    await expect(editor).toBeHidden();

    const roundTrip = await page.evaluate(() => {
      const S = (window as any).__POWERNOTE_STORES__;
      const workspace = S.workspace.getState().workspace;
      workspace.sections[0].pages[0].nodes = S.canvas.getState().nodes;
      return JSON.parse(JSON.stringify(workspace));
    });
    expect(roundTrip.sections[0].pages[0].nodes.find((node: any) => node.id === 'circle').data.label.text).toBe('Circle');

    const groupedCenter = await shapeScreenCenter(page, 'grouped');
    await page.mouse.dblclick(groupedCenter.x, groupedCenter.y);
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.group.getState().editingGroupId)).toBe('g1');
    await expect(editor).toBeHidden();
  });
});
