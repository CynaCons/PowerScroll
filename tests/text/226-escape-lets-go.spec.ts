/**
 * Test 226: Escape after placing a text block lets go of it.
 * Covers: REQ-TEXT-048
 *
 * Owner report 2026-10-22: "after adding a text element, like it was empty, I
 * just wanted to place it press escape and move it around ... when I was trying
 * to press escape, it was not unselecting it, it was staying focused on it, and
 * I was not able to easily move it around."
 */
import { expect, test, type Page } from '@playwright/test';
import { fillEditor, getCanvasStore, textEditor, waitForCanvasReady } from '../helpers';

async function canvasBox(page: Page) {
  return (await page.locator('[data-testid="canvas-container"] canvas').last().boundingBox())!;
}

async function placeWithT(page: Page, x: number, y: number) {
  const box = await canvasBox(page);
  await page.keyboard.press('t');
  await page.mouse.click(box.x + x, box.y + y);
  await expect(textEditor(page)).toBeFocused();
  return box;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
});

test('T, click, Escape: the empty block stays, nothing is selected, the keyboard is back on the canvas', async ({ page }) => {
  await placeWithT(page, 400, 300);
  await page.keyboard.press('Escape');

  await expect(textEditor(page)).toHaveCount(0);
  // The empty block stays where it was placed.
  const store = await getCanvasStore(page);
  expect(store.nodes).toHaveLength(1);
  expect(store.nodes[0].data.text).toBe('');
  // Let go: no selection, no selection bar, no formatting bar for it.
  expect(store.selectedNodeIds).toEqual([]);
  await expect(page.getByTestId('selection-actions')).toHaveCount(0);
  // Canvas shortcuts work straight away: T arms the text tool again.
  await page.keyboard.press('t');
  await expect.poll(() => page.evaluate(
    () => (window as any).__POWERNOTE_STORES__.tool.getState().activeTool,
  )).toBe('text');
});

test('after Escape the block moves with a drag from where the pointer already is', async ({ page }) => {
  const box = await placeWithT(page, 400, 300);
  await page.keyboard.press('Escape');

  await page.mouse.move(box.x + 404, box.y + 304);
  await page.mouse.down();
  await page.mouse.move(box.x + 504, box.y + 454, { steps: 10 });
  await page.mouse.up();

  const node = (await getCanvasStore(page)).nodes[0];
  expect(Math.round(node.x)).toBe(500);
  expect(Math.round(node.y)).toBe(450);
  expect(node.data.text).toBe('');
  await expect(textEditor(page)).toHaveCount(0);
});

test('Escape on a typed block keeps the text and lets go of it too', async ({ page }) => {
  await placeWithT(page, 400, 300);
  await fillEditor(page, 'Kept text');
  await page.keyboard.press('Escape');

  await expect(textEditor(page)).toHaveCount(0);
  const store = await getCanvasStore(page);
  expect(store.nodes[0].data.text).toBe('Kept text');
  expect(store.selectedNodeIds).toEqual([]);
});

test('clicking away still commits and keeps the block selected', async ({ page }) => {
  await placeWithT(page, 400, 300);
  await fillEditor(page, 'Blur text');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  await expect(textEditor(page)).toHaveCount(0);
  const store = await getCanvasStore(page);
  expect(store.nodes[0].data.text).toBe('Blur text');
  expect(store.selectedNodeIds).toHaveLength(1);
});
