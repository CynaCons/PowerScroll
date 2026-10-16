/**
 * Test 22: Undo/Redo
 * Covers: REQ-CANVAS-007 — Undo/redo functionality for canvas operations
 *
 * Verifies that Ctrl+Z undoes the last action, Ctrl+Shift+Z redoes it,
 * multiple undos work correctly, and undo history clears on page switch.
 */
import { test, expect } from '@playwright/test';
import { commitEditor, fillEditor, getCanvasStore, waitForCanvasReady, clickCanvas, activateTool } from '../helpers';

test.describe('22 - Undo/Redo (REQ-CANVAS-007)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('undo removes a placed text block', async ({ page }) => {
    // Place a text block
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);
    await page.waitForTimeout(200);

    // Commit the text by blurring
    await commitEditor(page);
    await page.waitForTimeout(200);

    // Verify the node exists
    let store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);

    // Undo twice: first undoes the updateNode (blur commit), second undoes addNode
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    // Node should be removed
    store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(0);
  });

  test('redo restores an undone text block', async ({ page }) => {
    // Place a text block
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);
    await page.waitForTimeout(200);

    await commitEditor(page);
    await page.waitForTimeout(200);

    let store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);

    // Undo twice: updateNode (blur commit) + addNode
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(0);

    // Redo (Ctrl+Shift+Z) — restores the addNode
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(200);

    // Node should be restored
    store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);
  });

  test('undo reverts a text placement+edit as single action', async ({ page }) => {
    // Place a text block and type "Hello" — batched as single undo entry
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page, 'Hello');
    await commitEditor(page);
    await page.waitForTimeout(200);

    let store = await getCanvasStore(page);
    expect(store.nodes[0].data.text).toBe('Hello');

    // Single undo should revert the entire placement+edit (batched)
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(0);
  });

  test('multiple undos: place 3 texts, undo 3 times → 0 nodes', async ({ page }) => {
    // Place 3 text blocks via store to avoid UI timing issues
    for (let i = 0; i < 3; i++) {
      await page.evaluate((idx) => {
        const store = (window as any).__POWERNOTE_STORES__.canvas.getState();
        store.addNode({
          id: `test-node-${idx}`,
          type: 'text',
          x: 100 + idx * 150,
          y: 200,
          width: 120,
          height: 30,
          data: { text: `Text ${idx}`, fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#1a1a1a' },
        });
      }, i);
    }
    await page.waitForTimeout(200);

    let store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(3);

    // Undo 3 times
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(0);
  });

  test('undo stack clears on page switch', async ({ page }) => {
    // Open hierarchy panel and add a second section
    await activateTool(page, 'hierarchy');
    await expect(page.locator('[data-testid="hierarchy-panel"]')).toBeVisible();
    await page.locator('[data-testid="add-section-btn"]').click();
    await page.waitForTimeout(200);

    const pageButtons = page.locator('.hierarchy-page');
    await expect(pageButtons).toHaveCount(2);

    // Navigate to the second section's page
    await pageButtons.nth(1).click();
    await page.waitForTimeout(300);

    // Place a text block on page 2
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);
    await page.waitForTimeout(200);
    await commitEditor(page);
    await page.waitForTimeout(200);

    let store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);

    // Navigate back to page 1
    await pageButtons.nth(0).click();
    await page.waitForTimeout(300);

    // Navigate forward to page 2
    await pageButtons.nth(1).click();
    await page.waitForTimeout(300);

    // The text should still be there
    store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);

    // But undo should not work (history cleared on page switch)
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1); // Still 1, undo had no effect
  });
});
