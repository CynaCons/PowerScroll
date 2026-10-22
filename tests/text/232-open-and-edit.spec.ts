/**
 * Test 232: opening a block puts the selection where the user expects, and
 * the size and colour controls do not throw the user out of editing.
 * Covers: REQ-TEXT-059, REQ-TEXT-060
 *
 * Audit of v0.88.1: double-clicking "Clo|sing" put the caret two lines up and
 * never selected the word; Enter or F2 on a selected block did nothing; the
 * size and colour popovers closed the editor and lost the selection.
 *
 * Contract assumed beyond the shared test ids (they exist today): the bottom
 * toolbar's font-size control is data-testid="size-trigger" opening
 * "size-popover" with preset buttons labelled like "24px"; the colour control
 * is "color-trigger" opening "color-popover" with swatch buttons titled by
 * their hex value (e.g. "#dc2626").
 */
import { expect, test, type Page } from '@playwright/test';
import { textEditor, waitForCanvasReady } from '../helpers';
import {
  addTextBlock, clickAway, finishedText, FINISHED, newBlock, rendered, selectBlock, selectedText,
  selectWordInEditor, storedData, storedText, wordCenter, wordRect,
} from './text-user';

const LINES = 'first line here\nsecond line words\nClosing line text';

/** Double-click a word of the finished block, with no other help. */
async function dblclickWord(page: Page, word: string) {
  await expect(textEditor(page)).toHaveCount(0);
  const p = await wordCenter(page, FINISHED, word);
  await page.mouse.dblclick(p.x, p.y);
  await expect(textEditor(page), 'double-click opens the block').toBeFocused();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
});

test('double-clicking a word opens the block with exactly that word selected', async ({ page }) => {
  await addTextBlock(page, 'lines', LINES, 'Closing');
  await dblclickWord(page, 'Closing');
  await expect.poll(() => selectedText(page)).toBe('Closing');
  // Typing replaces the word, where the user double-clicked.
  await page.keyboard.type('Opening');
  await clickAway(page);
  expect(await storedText(page, 'lines')).toContain('Opening line text');
  expect(await storedText(page, 'lines')).not.toContain('Closing');
});

test('double-clicking a word on the middle line selects that word', async ({ page }) => {
  await addTextBlock(page, 'lines', LINES, 'second');
  await dblclickWord(page, 'second');
  await expect.poll(() => selectedText(page)).toBe('second');
});

test('double-clicking blank space after a line puts the caret at the end of that line', async ({ page }) => {
  await addTextBlock(page, 'lines', LINES, 'second');
  await page.waitForTimeout(200);
  const r = await wordRect(page, FINISHED, 'words');
  await page.mouse.dblclick(r.left + r.width + 60, r.top + r.height / 2);
  await expect(textEditor(page), 'double-click on blank space opens the block').toBeFocused();
  await page.keyboard.type('X');
  await clickAway(page);
  expect(await finishedText(page, 'second')).toBe('first line here second line wordsX Closing line text');
  expect(await storedText(page, 'lines')).toContain('second line wordsX');
});

test('Enter on a single selected block opens it with the caret at the end', async ({ page }) => {
  await newBlock(page, 'abc def');
  await clickAway(page);
  await selectBlock(page, 'abc');
  await page.keyboard.press('Enter');
  await expect(textEditor(page), 'Enter opens the selected block').toBeFocused();
  await page.keyboard.type('!');
  await clickAway(page);
  expect(await storedText(page)).toMatch(/def!$/);
  expect(await finishedText(page, 'abc')).toBe('abc def!');
});

test('F2 on a single selected block opens it with the caret at the end', async ({ page }) => {
  await newBlock(page, 'abc def');
  await clickAway(page);
  await selectBlock(page, 'abc');
  await page.keyboard.press('F2');
  await expect(textEditor(page), 'F2 opens the selected block').toBeFocused();
  await page.keyboard.type('!');
  await clickAway(page);
  expect(await storedText(page)).toMatch(/def!$/);
});

test('changing the font size while editing keeps the editor open and the word selected', async ({ page }) => {
  await newBlock(page, 'size and colour here');
  await selectWordInEditor(page, 'colour');
  await expect.poll(() => selectedText(page)).toBe('colour');

  const toolbar = page.getByTestId('bottom-toolbar');
  await toolbar.getByTestId('size-trigger').click();
  await page.getByTestId('size-popover').getByRole('button', { name: '24px' }).click();

  await expect(textEditor(page), 'the editor stays open after a size change').toHaveCount(1);
  await expect.poll(() => selectedText(page), 'the word is still selected').toBe('colour');
  await expect.poll(async () => (await storedData(page)).fontSize).toBe(24);
  await clickAway(page);
  expect(await finishedText(page, 'size')).toBe('size and colour here');
});

test('changing the text colour while editing keeps the editor open and the word selected', async ({ page }) => {
  await newBlock(page, 'size and colour here');
  await selectWordInEditor(page, 'colour');
  await expect.poll(() => selectedText(page)).toBe('colour');

  const toolbar = page.getByTestId('bottom-toolbar');
  await toolbar.getByTestId('color-trigger').click();
  await page.getByTestId('color-popover').locator('button[title="#dc2626"]').click();

  await expect(textEditor(page), 'the editor stays open after a colour change').toHaveCount(1);
  await expect.poll(() => selectedText(page), 'the word is still selected').toBe('colour');
  await expect.poll(async () => (await storedData(page)).fill).toBe('#dc2626');
  await clickAway(page);
  expect((await rendered(page, 'size')).color).toBe('rgb(220, 38, 38)');
});
