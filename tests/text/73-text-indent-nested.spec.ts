/**
 * Test 73: Tab/Shift+Tab Nested Bullet/Checkbox Indentation
 * Covers: Tab indents bullets and checkboxes, Shift+Tab un-indents
 */
import { test, expect } from '@playwright/test';
import { expectEditorValue, fillEditor, selectInEditor, textEditor, waitForCanvasReady, getCanvasStore, activateTool, clickCanvas } from '../helpers';

test.describe('73 - Text Indent for Nested Lists', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('Tab on a bullet line indents it (nesting)', async ({ page }) => {
    // Place a text block
    await activateTool(page, 'text');
    await clickCanvas(page, 300, 200);

    // Type two bullets
    await fillEditor(page, '- parent\n- child');
    await page.waitForTimeout(100);

    // Move cursor to end of line 2 (on "child")
    await selectInEditor(page, '- parent\n- child'.length);

    // Press Tab
    await textEditor(page).press('Tab');
    await page.waitForTimeout(100);

    // Verify the second line is now indented
    await expectEditorValue(page, '- parent\n  - child');
  });

  test('Tab on a checkbox line indents it', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 300, 200);

    await fillEditor(page, '- [ ] task\n- [ ] subtask');
    await page.waitForTimeout(100);

    // Cursor at end of line 2
    await selectInEditor(page, '- [ ] task\n- [ ] subtask'.length);

    await textEditor(page).press('Tab');
    await page.waitForTimeout(100);

    await expectEditorValue(page, '- [ ] task\n  - [ ] subtask');
  });

  test('Shift+Tab on an indented line un-indents it', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 300, 200);

    await fillEditor(page, '- parent\n  - indented');
    await page.waitForTimeout(100);

    await selectInEditor(page, '- parent\n  - indented'.length);

    await textEditor(page).press('Shift+Tab');
    await page.waitForTimeout(100);

    await expectEditorValue(page, '- parent\n- indented');
  });

  test('Tab at the middle of a line indents the line (cursor-agnostic)', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 300, 200);

    await fillEditor(page, '- item');
    await page.waitForTimeout(100);

    // Cursor in the middle of "item"
    await selectInEditor(page, 4); // After "- it"

    await textEditor(page).press('Tab');
    await page.waitForTimeout(100);

    await expectEditorValue(page, '  - item');
  });
});
