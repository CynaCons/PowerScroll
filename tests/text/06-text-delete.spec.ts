/**
 * Test 06: Text Delete
 * Covers: REQ-TEXT-009, REQ-TEXT-010 — Delete a selected text node with
 * Delete key, and toggle text tool with T keyboard shortcut
 *
 * Verifies that pressing Delete removes the selected node from the store,
 * and that the T key toggles the text tool on and off.
 */
import { test, expect } from '@playwright/test';
import { commitEditor, fillEditor, getCanvasStore, getToolStore, waitForCanvasReady, clickCanvas, activateTool } from '../helpers';

test.describe('06 - Text Delete (REQ-TEXT-009, REQ-TEXT-010)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('Delete key removes selected text node', async ({ page }) => {
    // Place and commit a text block
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page, 'Delete me');
    await commitEditor(page);

    await page.waitForTimeout(300);

    // Verify the node exists
    let store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);

    // Switch back to select tool so clicking selects instead of placing
    await activateTool(page, 'text');
    await page.waitForTimeout(200);

    // The node is still selected after toggling tools. Verify.
    store = await getCanvasStore(page);
    expect(store.selectedNodeId).not.toBeNull();

    // Press Delete to remove the selected node
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);

    // Verify the node is removed
    store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(0);
    expect(store.selectedNodeId).toBeNull();
  });

  test('T key toggles text tool', async ({ page }) => {
    // Initially, tool should be 'select'
    let toolStore = await getToolStore(page);
    expect(toolStore.activeTool).toBe('select');

    // Press T to activate text tool
    await page.keyboard.press('t');
    await page.waitForTimeout(100);

    toolStore = await getToolStore(page);
    expect(toolStore.activeTool).toBe('text');

    // Press T again to toggle back to select
    await page.keyboard.press('t');
    await page.waitForTimeout(100);

    toolStore = await getToolStore(page);
    expect(toolStore.activeTool).toBe('select');
  });
});
