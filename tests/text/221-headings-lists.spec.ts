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

test('Ctrl+Alt+2 / Ctrl+Shift+2 turn a list row into a title that splits the list; back to text is a plain paragraph', async ({ page }) => {
  await editing(page, LIST);
  // Selection offsets count the visible text (the markers take no characters).
  await selectInEditor(page, 'Call the bank\nWee'.length);
  await page.keyboard.press('Control+Alt+2');
  // The heading splits the list; blocks are separated by a blank line (REQ-TEXT-064 dialect).
  await expectEditorValue(page, '- Call the bank\n\n## Weekend\n\n- Clean the bike');

  // Back to text between list rows: an ordinary paragraph, never a row of a neighbour (REQ-TEXT-073).
  const SPLIT = '- Call the bank\n\nWeekend\n\n- Clean the bike';
  await page.keyboard.press('Control+Alt+0');
  await expectEditorValue(page, SPLIT);

  // Ctrl+Shift+digit does the same on every keyboard layout; the level a line
  // already has turns it back to text.
  await page.keyboard.press('Control+Shift+Digit1');
  await expectEditorValue(page, '- Call the bank\n\n# Weekend\n\n- Clean the bike');
  await page.keyboard.press('Control+Shift+Digit1');
  await expectEditorValue(page, SPLIT);
  await page.keyboard.press('Control+Shift+Digit3');
  await expectEditorValue(page, '- Call the bank\n\n### Weekend\n\n- Clean the bike');
  await page.keyboard.press('Control+Shift+Digit0');
  await expectEditorValue(page, SPLIT);

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
  // The heading takes its own line; blocks are separated by a blank line (REQ-TEXT-064 dialect).
  await expectEditorValue(page, '# Plan\n\nbody');
  await expect(textEditor(page)).toBeFocused();
  await page.getByTestId('format-heading').click();
  await page.getByTestId('format-heading-3').click();
  await expectEditorValue(page, '### Plan\n\nbody');
  await page.getByTestId('format-heading').click();
  await page.getByTestId('format-heading-0').click();
  await expectEditorValue(page, 'Plan\n\nbody');
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
  // The same command again takes the markers off: the rows become paragraphs.
  await page.keyboard.press('Control+Shift+9');
  await expectEditorValue(page, 'eggs\n\nmilk\n\nbread');

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
  // Selection offsets count the visible text ("eggs\nmilk"); boxes take no characters.
  await selectInEditor(page, 2);
  await page.keyboard.press('Control+Enter');
  await expectEditorValue(page, '- [x] eggs\n- [ ] milk');
  await page.keyboard.press('Control+Enter');
  await expectEditorValue(page, '- [ ] eggs\n- [ ] milk');

  await selectInEditor(page, 7);
  await page.keyboard.press('Alt+ArrowUp');
  await expectEditorValue(page, '- [ ] milk\n- [ ] eggs');

  await fillEditor(page, '- one\n- two');
  await selectInEditor(page, 4);
  await page.keyboard.press('Backspace');
  // The row leaves the list and becomes a paragraph under it.
  await expectEditorValue(page, '- one\n\ntwo');
  // An ordinary Backspace still deletes a character.
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await expectEditorValue(page, '- one\n\ntw');
});

test('Enter continues lists, numbers count up, an empty row ends the list', async ({ page }) => {
  await editing(page, '');
  await page.keyboard.type('1. first');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second');
  await page.keyboard.press('Enter');
  await expectEditorValue(page, '1. first\n2. second\n3. ');
  // Enter on the empty row ends the list: what follows is a paragraph below it.
  // The empty row the caret now sits in is a kept blank line (REQ-TEXT-069).
  await page.keyboard.press('Enter');
  await expectEditorValue(page, '1. first\n2. second\n\n<br>');
  await page.keyboard.type('after');
  await page.keyboard.press('Enter');
  await expectEditorValue(page, '1. first\n2. second\n\nafter\n\n<br>');
});
