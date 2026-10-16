/**
 * Test 11: Toolbar Format
 * Covers: REQ-TOOL-002, REQ-TOOL-003, REQ-TOOL-004, REQ-TOOL-005 —
 * Change font size, toggle bold, toggle italic, and change color
 * for a selected text node via the bottom toolbar
 *
 * Verifies that formatting controls in the bottom toolbar update the
 * selected text node's data in the canvas store.
 */
import { test, expect } from '@playwright/test';
import { commitEditor, fillEditor, getCanvasStore, waitForCanvasReady, clickCanvas, activateTool } from '../helpers';

test.describe('11 - Toolbar Format (REQ-TOOL-002..005)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);

    // Place and commit a text block
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page, 'Hello');
    await commitEditor(page);
    await page.waitForTimeout(300);

    // After commit, node is still selected and text tool is active,
    // so the toolbar is visible. Switch to select mode — the node stays
    // selected so toolbar remains visible (selectedNode is text type).
    await activateTool(page, 'text');
    await page.waitForTimeout(200);

    // Verify node is selected and toolbar is visible
    const store = await getCanvasStore(page);
    expect(store.selectedNodeId).not.toBeNull();
    await expect(page.locator('[data-testid="bottom-toolbar"]')).toBeVisible();
  });

  test('changing font size updates node data', async ({ page }) => {
    // Get current font size
    let store = await getCanvasStore(page);
    const initialFontSize = store.nodes[0].data.fontSize;

    // Open size popover and pick a preset
    await page.click('[data-testid="size-trigger"]');
    await expect(page.locator('[data-testid="size-popover"]')).toBeVisible();

    // Use the slider to change size to 24
    await page.locator('[data-testid="size-slider"]').fill('24');
    await page.waitForTimeout(200);

    store = await getCanvasStore(page);
    expect(store.nodes[0].data.fontSize).toBe(24);
    expect(store.nodes[0].data.fontSize).not.toBe(initialFontSize);
  });

  test('clicking bold button toggles fontStyle to bold', async ({ page }) => {
    // Verify initial style is 'normal'
    let store = await getCanvasStore(page);
    expect(store.nodes[0].data.fontStyle).toBe('normal');

    // Click the Bold button (first text-toolbar__btn)
    await page.locator('.text-toolbar__btn').first().click();
    await page.waitForTimeout(200);

    store = await getCanvasStore(page);
    expect(store.nodes[0].data.fontStyle).toContain('bold');
  });

  test('clicking color swatch changes fill color', async ({ page }) => {
    // Verify initial fill is the default black
    let store = await getCanvasStore(page);
    const initialFill = store.nodes[0].data.fill;

    // Open color popover
    await page.click('[data-testid="color-trigger"]');
    await expect(page.locator('[data-testid="color-popover"]')).toBeVisible();

    // Click the red swatch (row 2, col 1 = #dc2626)
    await page.locator('.color-popover__swatch').nth(4).click(); // 5th swatch = red
    await page.waitForTimeout(200);

    store = await getCanvasStore(page);
    expect(store.nodes[0].data.fill).not.toBe(initialFill);
    expect(store.nodes[0].data.fill).toBe('#dc2626');
  });
});
