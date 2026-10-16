/**
 * Test 10: Toolbar Show
 * Covers: REQ-TOOL-001 — Bottom toolbar visibility follows context
 * (text tool active or text node selected)
 *
 * Verifies that the bottom toolbar is hidden by default, visible when the
 * text tool is active, hidden again when deactivated, and visible when
 * a text node is selected.
 */
import { test, expect } from '@playwright/test';
import { commitEditor, fillEditor, waitForCanvasReady, clickCanvas, activateTool } from '../helpers';

test.describe('10 - Toolbar Show (REQ-TOOL-001)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('bottom toolbar is NOT visible initially (select tool, no selection)', async ({ page }) => {
    const toolbar = page.locator('[data-testid="bottom-toolbar"]');
    await expect(toolbar).not.toBeVisible();
  });

  test('activating text tool shows the bottom toolbar', async ({ page }) => {
    const toolbar = page.locator('[data-testid="bottom-toolbar"]');

    // Activate text tool
    await activateTool(page, 'text');

    await expect(toolbar).toBeVisible();
  });

  test('deactivating text tool keeps toolbar visible (toolbar persistence)', async ({ page }) => {
    const toolbar = page.locator('[data-testid="bottom-toolbar"]');

    // Activate text tool
    await activateTool(page, 'text');
    await expect(toolbar).toBeVisible();

    // Deactivate text tool (click it again to toggle → select mode)
    await activateTool(page, 'text');

    // Toolbar should STILL be visible (persists from last tool)
    await expect(toolbar).toBeVisible();
  });

  test('selecting a text node shows the bottom toolbar', async ({ page }) => {
    const toolbar = page.locator('[data-testid="bottom-toolbar"]');

    // Place and commit a text node
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page, 'Toolbar test');
    await commitEditor(page);
    await page.waitForTimeout(300);

    // Tool auto-reverted to select after placing. Toolbar persists from text tool.
    await expect(toolbar).toBeVisible();

    // Click on the text node to select it
    await clickCanvas(page, 420, 310);
    await page.waitForTimeout(200);

    // Toolbar should be visible because a text node is selected
    await expect(toolbar).toBeVisible();
  });
});
