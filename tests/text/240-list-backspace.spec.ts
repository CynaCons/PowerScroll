/**
 * Test 240: Backspace on the empty row Enter just made in a list.
 * Covers: REQ-TEXT-076
 *
 * Owner report 2026-10-29: at the end of a bullet row, Enter makes a new
 * bulleted row; Backspace removes the bullet; a second Backspace brought the
 * bullet back instead of removing the empty line. The second Backspace must
 * remove the line and put the caret at the end of the row Enter was pressed on.
 */
import { expect, test } from '@playwright/test';
import { textEditor, waitForCanvasReady } from '../helpers';
import { clickAway, finishedBlock, newBlock, storedText } from './text-user';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
});

test('Enter, Backspace, Backspace at the end of a bullet row comes back to the end of that row', async ({ page }) => {
  await newBlock(page, '- one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('two');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Backspace');
  await expect(textEditor(page).locator('li'), 'first Backspace removes the new bullet').toHaveCount(2);
  await page.keyboard.press('Backspace');
  await expect(textEditor(page).locator('li'), 'second Backspace does not bring a bullet back').toHaveCount(2);
  await page.keyboard.type('!');
  await clickAway(page);

  const block = finishedBlock(page, 'two!');
  await expect(block.locator('ul > li')).toHaveCount(2);
  await expect(block.locator('ul > li').nth(1)).toHaveText('two!');
  await expect(block.locator('p:not(li p)'), 'no empty line is left under the list').toHaveCount(0);
  expect(await storedText(page)).toBe('- one\n- two!');
});

test('the same on a nested row: Backspace steps out, then comes back to the end of the row above', async ({ page }) => {
  await newBlock(page, '- top');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('inner');
  await page.keyboard.press('Enter');
  await expect(textEditor(page).locator('li li')).toHaveCount(2);
  // Backspace 1 steps the empty row out one level, 2 takes its bullet off,
  // 3 removes the line. None of them ever adds a row back.
  const rows = textEditor(page).locator('li');
  for (const expected of [3, 2, 2]) {
    await page.keyboard.press('Backspace');
    await expect(rows).toHaveCount(expected);
  }
  await expect(textEditor(page).locator('li li')).toHaveCount(1);
  await page.keyboard.type('!');
  await clickAway(page);
  expect(await storedText(page)).toBe('- top\n  - inner!');
});

test('Backspace at the start of a line under a list joins it onto the last row', async ({ page }) => {
  await newBlock(page, '- one');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('after');
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await clickAway(page);
  const block = finishedBlock(page, 'oneafter');
  await expect(block.locator('ul > li')).toHaveCount(1);
  await expect(block.locator('ul > li')).toHaveText('oneafter');
});
