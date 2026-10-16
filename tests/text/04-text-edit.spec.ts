/**
 * Test 04: Text Edit
 * Covers: REQ-TEXT-003, REQ-TEXT-004, REQ-TEXT-047 — Commit text with Enter,
 * leave with Escape (text kept), commit on blur, and double-click to re-edit
 *
 * Verifies text editing behavior: Enter commits text, Escape keeps the text,
 * and double-clicking an existing text node re-enters edit mode.
 */
import { test, expect } from '@playwright/test';
import { commitEditor, fillEditor, getCanvasStore, textEditor, waitForCanvasReady, clickCanvas, dblClickCanvas, activateTool } from '../helpers';

test.describe('04 - Text Edit (REQ-TEXT-003, REQ-TEXT-004, REQ-TEXT-047)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('Enter commits text to store', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page, 'Hello World');
    await commitEditor(page);

    await page.waitForTimeout(200);

    const store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);
    expect(store.nodes[0].data.text).toBe('Hello World');
  });

  test('Escape exits editing mode and keeps the text', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page, 'Escape test');
    await textEditor(page).press('Escape');

    await page.waitForTimeout(200);

    // The editor should be removed (editing mode exited)
    await expect(textEditor(page)).toHaveCount(0);

    const store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);
    // Escape leaves editing like a click away: the typed text is kept (REQ-TEXT-047).
    expect(store.nodes[0].data.text).toBe('Escape test');
  });

  test('blur commits text to store', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page, 'Blur commit test');

    // Click elsewhere to blur
    await page.locator('[data-testid="topbar"]').click();

    await page.waitForTimeout(200);

    const store = await getCanvasStore(page);
    expect(store.nodes[0].data.text).toBe('Blur commit test');
  });

  test('double-click on existing text re-enters edit mode', async ({ page }) => {
    // Place and commit a text block
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page, 'Edit me');
    // Blur by clicking elsewhere — but first deactivate text tool to avoid placing new nodes
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setTool('select');
    });
    await commitEditor(page);

    await page.waitForTimeout(300);

    // Editor should be gone after commit
    await expect(textEditor(page)).toHaveCount(0);

    // Double-click at the same canvas position to re-edit
    await dblClickCanvas(page, 400, 300);

    // Editor should reappear
    await expect(textEditor(page)).toBeVisible();
  });
});
