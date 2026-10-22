/**
 * Test 84: Extended inline formatting (strike / code / underline)
 * Covers: REQ-TEXT-025, REQ-TEXT-026, REQ-TEXT-027, REQ-TOOL-007
 *
 * Extends v0.22.4 partial bold/italic with Strike/Code/Underline toolbar
 * buttons and shortcuts. Toolbar clicks must not commit the edit.
 */
import { test, expect } from '@playwright/test';
import { commitEditor, editorValue, fillEditor, getCanvasStore, selectInEditor, textEditor, waitForCanvasReady, clickCanvas, activateTool } from '../helpers';

test.describe('84 - Extended inline formatting (REQ-TEXT-025..027, REQ-TOOL-007)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);

    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page, 'Hello brave world');
  });

  test('toolbar Bold click on a partial selection does not commit the edit', async ({ page }) => {
    await selectInEditor(page, 6, 11);

    await page.locator('[data-testid="format-bold"]').click();

    // Editor must still be open (no commit-on-click)
    await expect(textEditor(page)).toBeVisible();
    expect(await editorValue(page)).toBe('Hello **brave** world');
  });

  test('strike, code, underline buttons each wrap the selection appropriately', async ({ page }) => {
    await selectInEditor(page, 6, 11);
    await page.locator('[data-testid="format-strike"]').click();
    expect(await editorValue(page)).toBe('Hello ~~brave~~ world');

    // Reset by selecting the wrapped region and unwrapping
    await fillEditor(page, 'Hello brave world');
    await selectInEditor(page, 6, 11);
    await page.locator('[data-testid="format-code"]').click();
    expect(await editorValue(page)).toBe('Hello `brave` world');

    await fillEditor(page, 'Hello brave world');
    await selectInEditor(page, 6, 11);
    await page.locator('[data-testid="format-underline"]').click();
    expect(await editorValue(page)).toBe('Hello <u>brave</u> world');
  });

  test('Ctrl+U / Ctrl+E / Ctrl+Shift+X wrap the selection', async ({ page }) => {
    await selectInEditor(page, 6, 11);
    await page.keyboard.press('Control+u');
    expect(await editorValue(page)).toBe('Hello <u>brave</u> world');

    await fillEditor(page, 'Hello brave world');
    await selectInEditor(page, 6, 11);
    await page.keyboard.press('Control+e');
    expect(await editorValue(page)).toBe('Hello `brave` world');

    await fillEditor(page, 'Hello brave world');
    await selectInEditor(page, 6, 11);
    await page.keyboard.press('Control+Shift+x');
    expect(await editorValue(page)).toBe('Hello ~~brave~~ world');
  });

  test('clicking Bold with the editor closed bolds all the text of the selected block', async ({ page }) => {
    // REQ-TEXT-050/052: no whole-block style; the text itself is formatted.
    // Commit the edit so the editor closes but the node stays selected
    await commitEditor(page);
    await page.waitForTimeout(200);

    let store = await getCanvasStore(page);
    expect(store.nodes[0].data.fontStyle).toBe('normal');

    await page.locator('[data-testid="format-bold"]').click();
    await page.waitForTimeout(150);

    store = await getCanvasStore(page);
    expect(store.nodes[0].data.fontStyle).toBe('normal');
    expect(store.nodes[0].data.text).toBe('**Hello brave world**');
  });
});
