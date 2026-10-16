/**
 * Test 221: headings and list commands in the text-block editor.
 * Covers: REQ-TEXT-041, REQ-TEXT-042, REQ-TEXT-043, REQ-TEXT-044
 *
 * Owner 2026-10-16: "one row needs to be turned into a title" in a list, and
 * "make this a modern robust text editing feature".
 */
import { expect, test, type Page } from '@playwright/test';
import {
  activateTool, clickCanvas, commitEditor, expectEditorValue, fillEditor, selectInEditor,
  textEditor, waitForCanvasReady,
} from '../helpers';

const LIST = '- Call the bank\n- Weekend\n- Clean the bike';
const ROW = LIST.indexOf('Weekend');

async function editing(page: Page, text: string) {
  await page.goto('/');
  await waitForCanvasReady(page);
  await activateTool(page, 'text');
  await clickCanvas(page, 400, 300);
  await expect(textEditor(page)).toBeFocused();
  await fillEditor(page, text);
}

test('Ctrl+Alt+2 / Ctrl+Shift+2 turn a list row into a title that splits the list; back to text restores the bullet', async ({ page }) => {
  await editing(page, LIST);
  await selectInEditor(page, ROW + 3);
  await page.keyboard.press('Control+Alt+2');
  await expectEditorValue(page, '- Call the bank\n## Weekend\n- Clean the bike');

  // Back to text between list rows: the bullet comes back.
  await page.keyboard.press('Control+Alt+0');
  await expectEditorValue(page, LIST);

  // Ctrl+Shift+digit does the same on every keyboard layout; the level a line
  // already has turns it back to text.
  await page.keyboard.press('Control+Shift+Digit1');
  await expectEditorValue(page, '- Call the bank\n# Weekend\n- Clean the bike');
  await page.keyboard.press('Control+Shift+Digit1');
  await expectEditorValue(page, LIST);
  await page.keyboard.press('Control+Shift+Digit3');
  await expectEditorValue(page, '- Call the bank\n### Weekend\n- Clean the bike');
  await page.keyboard.press('Control+Shift+Digit0');
  await expectEditorValue(page, LIST);

  await page.keyboard.press('Control+Shift+Digit2');
  await commitEditor(page);
  const md = page.locator('.powernote-markdown').first();
  await expect(md.locator('ul')).toHaveCount(2);
  await expect(md.locator('h2')).toHaveText('Weekend');
  await expect(md.locator('li')).toHaveCount(2);
});

test('the toolbar heading menu sets H1/H2/H3 and Text', async ({ page }) => {
  await editing(page, 'Plan\nbody');
  await selectInEditor(page, 1);
  await page.getByTestId('format-heading').click();
  await page.getByTestId('format-heading-1').click();
  await expectEditorValue(page, '# Plan\nbody');
  await expect(textEditor(page)).toBeFocused();
  await page.getByTestId('format-heading').click();
  await page.getByTestId('format-heading-3').click();
  await expectEditorValue(page, '### Plan\nbody');
  await page.getByTestId('format-heading').click();
  await page.getByTestId('format-heading-0').click();
  await expectEditorValue(page, 'Plan\nbody');
});

test('Ctrl+Shift+8 / 7 / 9 switch selected lines between bullets, numbers and a checklist', async ({ page }) => {
  await editing(page, 'eggs\nmilk\nbread');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+Shift+8');
  await expectEditorValue(page, '- eggs\n- milk\n- bread');
  await page.keyboard.press('Control+Shift+7');
  await expectEditorValue(page, '1. eggs\n2. milk\n3. bread');
  await page.keyboard.press('Control+Shift+9');
  await expectEditorValue(page, '- [ ] eggs\n- [ ] milk\n- [ ] bread');
  // The same command again takes the markers off.
  await page.keyboard.press('Control+Shift+9');
  await expectEditorValue(page, 'eggs\nmilk\nbread');

  // Toolbar buttons do the same.
  await page.keyboard.press('Control+a');
  await page.getByTestId('format-list-number').click();
  await expectEditorValue(page, '1. eggs\n2. milk\n3. bread');
  await page.getByTestId('format-list-bullet').click();
  await expectEditorValue(page, '- eggs\n- milk\n- bread');
  await page.getByTestId('format-list-task').click();
  await expectEditorValue(page, '- [ ] eggs\n- [ ] milk\n- [ ] bread');
});

test('Ctrl+Enter ticks a checkbox, Alt+Up moves a row, Backspace on a marker drops the bullet', async ({ page }) => {
  await editing(page, '- [ ] eggs\n- [ ] milk');
  await selectInEditor(page, 8);
  await page.keyboard.press('Control+Enter');
  await expectEditorValue(page, '- [x] eggs\n- [ ] milk');
  await page.keyboard.press('Control+Enter');
  await expectEditorValue(page, '- [ ] eggs\n- [ ] milk');

  await selectInEditor(page, 19);
  await page.keyboard.press('Alt+ArrowUp');
  await expectEditorValue(page, '- [ ] milk\n- [ ] eggs');

  await fillEditor(page, '- one\n- two');
  await selectInEditor(page, 8);
  await page.keyboard.press('Backspace');
  await expectEditorValue(page, '- one\ntwo');
  // An ordinary Backspace still deletes a character.
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await expectEditorValue(page, '- one\ntw');
});

test('Enter continues lists, numbers count up, an empty row ends the list', async ({ page }) => {
  await editing(page, '');
  await page.keyboard.type('1. first');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second');
  await page.keyboard.press('Enter');
  await expectEditorValue(page, '1. first\n2. second\n3. ');
  await page.keyboard.press('Enter');
  await expectEditorValue(page, '1. first\n2. second\n');
  await page.keyboard.type('after');
  await page.keyboard.press('Enter');
  await expectEditorValue(page, '1. first\n2. second\nafter\n');
});
