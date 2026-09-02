/**
 * Test 194: Arrow binding
 * Covers: REQ-SHAPE-021, REQ-SHAPE-022, REQ-SHAPE-023, REQ-SHAPE-024, REQ-SHAPE-025
 */
import { expect, test } from '@playwright/test';
import { anchorFor, closestPointOnOutline, fixedPointFor, recomputeBoundArrows } from '../../src/utils/arrowBinding';
import type { CanvasNode } from '../../src/types/data';
import { getCanvasStore, waitForCanvasReady } from '../helpers';

const rect: CanvasNode = {
  id: 'box', type: 'shape', x: 200, y: 200, width: 120, height: 80, layer: 3,
  data: { shapeType: 'rect', fill: '#fff', stroke: '#111', strokeWidth: 2, strokeDash: [] },
};
const arrow: CanvasNode = {
  id: 'arrow', type: 'shape', x: 80, y: 240, width: 120, height: 0, layer: 3,
  data: { shapeType: 'arrow', fill: 'transparent', stroke: '#111', strokeWidth: 2, strokeDash: [] },
};

test.describe('194 - Arrow binding', () => {
  test('pure outline helpers handle rect, ellipse, triangle, rotation, and follow', () => {
    const circle: CanvasNode = { ...rect, id: 'circle', x: 400, data: { ...rect.data, shapeType: 'circle', rotation: 30 } };
    const triangle: CanvasNode = { ...rect, id: 'triangle', x: 600, data: { ...rect.data, shapeType: 'triangle' } };
    expect(closestPointOnOutline(rect, { x: 260, y: 240 })).toEqual({ x: 260, y: 200 });
    expect(closestPointOnOutline(circle, { x: 600, y: 240 }).x).toBeGreaterThan(450);
    expect(closestPointOnOutline(triangle, { x: 660, y: 240 }).y).toBeLessThanOrEqual(280);
    const point = closestPointOnOutline(rect, { x: 260, y: 240 });
    expect(anchorFor(rect, fixedPointFor(rect, point))).toEqual(point);
    const bound: CanvasNode = { ...arrow, data: { ...arrow.data, endBinding: { elementId: 'box', fixedPoint: [0, 0.5] } } };
    const moved = recomputeBoundArrows([{ ...rect, x: 300 }, bound], ['box'])[0];
    expect(moved.x + moved.width).toBe(300);
    expect(moved.y + moved.height).toBe(240);
  });

  test('binds, follows through geometry updates, cleans up, and serializes', async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await page.evaluate(({ rect, arrow }) => {
      const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
      canvas.addNode(rect); canvas.addNode(arrow);
      canvas.updateNode('arrow', { width: 120, data: { ...(arrow.data as any), endBinding: { elementId: 'box', fixedPoint: [0, 0.5] } } });
      canvas.setArrowBinding('arrow', 'end', { elementId: 'box', fixedPoint: [0, 0.5] });
    }, { rect, arrow });
    let store = await getCanvasStore(page);
    let bound = store.nodes.find((node: any) => node.id === 'arrow');
    expect(bound.data.endBinding.elementId).toBe('box');
    expect(bound.x + bound.width).toBe(200);
    expect(store.nodes.find((node: any) => node.id === 'box').boundElements).toEqual([{ id: 'arrow', type: 'arrow' }]);

    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().updateNode('box', { x: 320, width: 200, height: 120, data: { shapeType: 'rect', fill: '#fff', stroke: '#111', strokeWidth: 2, strokeDash: [], rotation: 90 } }));
    store = await getCanvasStore(page);
    bound = store.nodes.find((node: any) => node.id === 'arrow');
    expect(Math.round(bound.x + bound.width)).toBe(420);
    expect(Math.round(bound.y + bound.height)).toBe(160);

    const roundTrip = await page.evaluate(() => {
      const modules = (window as any).__POWERNOTE_STORES__;
      const workspace = modules.workspace.getState().workspace;
      workspace.sections[0].pages[0].nodes = modules.canvas.getState().nodes;
      return JSON.parse(JSON.stringify(workspace));
    });
    expect(roundTrip.sections[0].pages[0].nodes.find((node: any) => node.id === 'arrow').data.endBinding.elementId).toBe('box');
    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().deleteNode('box'));
    store = await getCanvasStore(page);
    expect(store.nodes.find((node: any) => node.id === 'arrow').data.endBinding).toBeNull();
  });

  test('pasting an arrow alone drops its bindings', async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await page.evaluate(({ rect, arrow }) => {
      const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
      canvas.addNode(rect); canvas.addNode(arrow);
      canvas.setArrowBinding('arrow', 'end', { elementId: 'box', fixedPoint: [0, 0.5] });
      canvas.selectNode('arrow', false); canvas.copySelectedNodes(); canvas.pasteNodes();
    }, { rect, arrow });
    const store = await getCanvasStore(page);
    const pasted = store.nodes.find((node: any) => node.id !== 'arrow' && node.type === 'shape' && node.data.shapeType === 'arrow');
    expect(pasted.data.startBinding).toBeNull();
    expect(pasted.data.endBinding).toBeNull();
  });
});
