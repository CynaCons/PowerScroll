/**
 * Test 32: Text Editor Features
 * Covers: REQ-TEXT-017, REQ-TEXT-018 — Auto-continue bullet lists on Enter,
 * and Shift+Tab to unindent
 *
 * Verifies that pressing Enter after a bullet line auto-continues the list,
 * and that Shift+Tab removes indentation from the current line.
 */
import { test, expect } from '@playwright/test';
import { editorValue, fillEditor, textEditor, waitForCanvasReady, clickCanvas, activateTool } from '../helpers';

test.describe('32 - Text Editor Features (REQ-TEXT-017, REQ-TEXT-018)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('Enter auto-continues bullet list', async ({ page }) => {
    // Place a text and enter edit mode
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await expect(textEditor(page)).toBeVisible();

    // Type a bullet item and press Enter
    await fillEditor(page, '');
    await textEditor(page).press('End'); // ensure cursor at end
    await textEditor(page).pressSequentially('- first');
    await textEditor(page).press('Enter');
    await page.waitForTimeout(100);

    // The editor should now contain "- first\n- "
    const value = await editorValue(page);
    expect(value).toContain('- first');
    expect(value).toContain('\n- '); // Auto-continued bullet
  });

  test('Shift+Tab removes indent from current line', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await expect(textEditor(page)).toBeVisible();

    // Type an indented line: first indent with Tab, then type content
    await fillEditor(page, '');
    await textEditor(page).press('Tab'); // adds 2 spaces
    await textEditor(page).pressSequentially('indented');
    await page.waitForTimeout(100);

    let value = await editorValue(page);
    expect(value).toMatch(/^\s{2}indented/); // starts with 2 spaces

    // Now Shift+Tab to remove the indent
    await textEditor(page).press('Shift+Tab');
    await page.waitForTimeout(100);

    value = await editorValue(page);
    expect(value).toBe('indented'); // indent removed
  });
});
