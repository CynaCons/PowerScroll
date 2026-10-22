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

    // REQ-TEXT-058: Tab nests the selected rows under the row above them.
    const text = '- top\n- item1\n- item2\n- item3';
    await fillEditor(page, text);
    await page.waitForTimeout(100);

    // Select the three rows under "top" (offsets count the visible text)
    await selectInEditor(page, 'top\n'.length, 'top\nitem1\nitem2\nitem3'.length);

    await textEditor(page).press('Tab');
    await page.waitForTimeout(100);

    await expectEditorValue(page, '- top\n  - item1\n  - item2\n  - item3');
  });

  test('Shift+Tab un-indents all selected lines', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 300, 200);

    const text = '- top\n  - item1\n  - item2\n  - item3';
    await fillEditor(page, text);
    await page.waitForTimeout(100);

    await selectInEditor(page, 'top\n'.length, 'top\nitem1\nitem2\nitem3'.length);

    await textEditor(page).press('Shift+Tab');
    await page.waitForTimeout(100);

    await expectEditorValue(page, '- top\n- item1\n- item2\n- item3');
  });

  test('Tab indents checkbox lines in multi-line selection', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 300, 200);

    const text = '- [ ] todo1\n- [x] done\n- [ ] todo2';
    await fillEditor(page, text);
    await page.waitForTimeout(100);

    // Select the last 2 rows (offsets count the visible text: "todo1\ndone\ntodo2")
    await selectInEditor(page, 'todo1\n'.length, 'todo1\ndone\ntodo2'.length);

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

    await fillEditor(page, '- parent\n- item');
    await page.waitForTimeout(100);

    // Select "item" (partial single row; offsets count the visible text)
    await selectInEditor(page, 'parent\n'.length, 'parent\nitem'.length);

    await textEditor(page).press('Tab');
    await page.waitForTimeout(100);

    // Single-row partial selection: the whole row nests, the text stays (REQ-TEXT-058)
    await expectEditorValue(page, '- parent\n  - item');
  });
});
