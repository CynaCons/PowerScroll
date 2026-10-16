/**
 * Test 75: Tab/Shift+Tab Multi-line Selection
 * Covers: selecting multiple lines and indenting/unindenting all at once
 */
import { test, expect } from '@playwright/test';
import { expectEditorValue, fillEditor, selectInEditor, textEditor, waitForCanvasReady, activateTool, clickCanvas } from '../helpers';

test.describe('75 - Tab Multi-line Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('Tab indents all selected lines', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 300, 200);

    const text = '- item1\n- item2\n- item3';
    await fillEditor(page, text);
    await page.waitForTimeout(100);

    // Select all three lines
    await selectInEditor(page, 0, text.length);

    await textEditor(page).press('Tab');
    await page.waitForTimeout(100);

    await expectEditorValue(page, '  - item1\n  - item2\n  - item3');
  });

  test('Shift+Tab un-indents all selected lines', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 300, 200);

    const text = '  - item1\n  - item2\n  - item3';
    await fillEditor(page, text);
    await page.waitForTimeout(100);

    await selectInEditor(page, 0, text.length);

    await textEditor(page).press('Shift+Tab');
    await page.waitForTimeout(100);

    await expectEditorValue(page, '- item1\n- item2\n- item3');
  });

  test('Tab indents checkbox lines in multi-line selection', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 300, 200);

    const text = '- [ ] todo1\n- [x] done\n- [ ] todo2';
    await fillEditor(page, text);
    await page.waitForTimeout(100);

    // Select the middle 2 lines (from start of line 2 to end of line 3)
    await selectInEditor(page, text.indexOf('\n') + 1, text.length);

    await textEditor(page).press('Tab');
    await page.waitForTimeout(100);

    await expectEditorValue(page, '- [ ] todo1\n  - [x] done\n  - [ ] todo2');
  });

  test('Shift+Tab on line with no indent is a no-op', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 300, 200);

    const text = '- unindented';
    await fillEditor(page, text);
    await page.waitForTimeout(100);

    await selectInEditor(page, text.length);

    await textEditor(page).press('Shift+Tab');
    await page.waitForTimeout(100);

    await expectEditorValue(page, '- unindented');
  });

  test('Tab removes any selected text and replaces with indent (standard behavior)', async ({ page }) => {
    // When text is selected on a single line, Tab should indent the line
    await activateTool(page, 'text');
    await clickCanvas(page, 300, 200);

    await fillEditor(page, '- item');
    await page.waitForTimeout(100);

    // Select "item" (partial single line)
    await selectInEditor(page, 2, 6); // "item"

    await textEditor(page).press('Tab');
    await page.waitForTimeout(100);

    // Single-line partial selection: indent whole line
    await expectEditorValue(page, '  - item');
  });
});
