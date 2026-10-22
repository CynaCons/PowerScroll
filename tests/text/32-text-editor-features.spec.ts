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

  test('Shift+Tab un-nests the current list row', async ({ page }) => {
    // REQ-TEXT-058: Tab/Shift+Tab nest and un-nest list rows; on an ordinary
    // line Tab changes nothing visible (never an indent that becomes code).
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await expect(textEditor(page)).toBeVisible();

    await fillEditor(page, '- parent\n- child');
    await textEditor(page).press('Tab'); // nests "child" under "parent"
    await page.waitForTimeout(100);

    let value = await editorValue(page);
    expect(value).toBe('- parent\n  - child');

    // Now Shift+Tab to un-nest it
    await textEditor(page).press('Shift+Tab');
    await page.waitForTimeout(100);

    value = await editorValue(page);
    expect(value).toBe('- parent\n- child');

    // Tab on an ordinary line: nothing visible changes.
    await fillEditor(page, 'plain');
    await textEditor(page).press('Tab');
    await textEditor(page).pressSequentially(' words');
    expect(await editorValue(page)).toBe('plain words');
  });
});
