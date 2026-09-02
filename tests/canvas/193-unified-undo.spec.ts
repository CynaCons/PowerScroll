/**
 * Test 193: Unified history
 * Covers: REQ-CANVAS-011, REQ-CANVAS-040, REQ-CANVAS-041, REQ-CANVAS-042
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

test.describe('193 - unified undo history', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('unwinds nodes and strokes chronologically across tool changes, then redoes them', async ({ page }) => {
    await page.evaluate(() => {
      const S = (window as any).__POWERNOTE_STORES__;
      S.draw.getState().addStroke({ id: 'ink', points: [20, 20, 90, 80], color: '#111', strokeWidth: 2 });
      S.tool.getState().setTool('select');
      S.canvas.getState().addNode({ id: 'shape', type: 'text', x: 100, y: 100, width: 120, height: 30, data: { text: 'shape', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#111' } });
      S.canvas.getState().updateNode('shape', { x: 220 });
    });
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().nodes[0].x)).toBe(100);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => ({ n: (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.length, s: (window as any).__POWERNOTE_STORES__.draw.getState().strokes.length }))).toEqual({ n: 0, s: 0 });
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+Shift+z');
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().nodes[0].x)).toBe(220);
  });

  test('clears redo after a new change and batches group, ungroup and erase', async ({ page }) => {
    await page.evaluate(() => {
      const S = (window as any).__POWERNOTE_STORES__;
      S.canvas.getState().addNode({ id: 'a', type: 'shape', x: 0, y: 0, width: 80, height: 30, data: { shapeType: 'rect', fill: '#fff', stroke: '#111', strokeWidth: 2, strokeDash: [] } });
      S.canvas.getState().addNode({ id: 'b', type: 'shape', x: 120, y: 0, width: 80, height: 30, data: { shapeType: 'rect', fill: '#fff', stroke: '#111', strokeWidth: 2, strokeDash: [] } });
      S.canvas.setState({ selectedNodeIds: ['a', 'b'] });
      (window as any).__POWERNOTE_GROUP_OPS__.groupSelection();
      (window as any).__POWERNOTE_GROUP_OPS__.ungroupSelection();
      S.draw.getState().addStroke({ id: 'erase-a', points: [0, 0, 10, 10], color: '#111', strokeWidth: 2 });
      S.draw.getState().addStroke({ id: 'erase-b', points: [20, 20, 30, 30], color: '#111', strokeWidth: 2 });
      S.history.getState().batchStart(); S.draw.getState().deleteStroke('erase-a'); S.draw.getState().deleteStroke('erase-b'); S.history.getState().batchEnd();
    });
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.draw.getState().strokes.length)).toBe(2);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.every((n: any) => n.groupId == null))).toBe(false);
    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().addNode({ id: 'new', type: 'text', x: 0, y: 60, width: 80, height: 30, data: { text: 'new', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#111' } }));
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.history.getState().canRedo)).toBe(false);
  });

  test('page switch clears history and canUndo controls the button', async ({ page }) => {
    await expect(page.getByTestId('undo-btn')).toBeDisabled();
    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().addNode({ id: 'one', type: 'text', x: 0, y: 0, width: 80, height: 30, data: { text: 'one', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#111' } }));
    await expect(page.getByTestId('undo-btn')).toBeEnabled();
    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().loadPageNodes([]));
    await expect(page.getByTestId('undo-btn')).toBeDisabled();
  });
});
