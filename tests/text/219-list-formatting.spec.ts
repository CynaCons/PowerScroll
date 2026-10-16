/**
 * Test 219: formatting a list row keeps the list; a lone dash never makes a heading.
 * Covers: REQ-TEXT-035, REQ-TEXT-036, REQ-TEXT-037
 *
 * Owner report 2026-10-16: "I make a list and sometimes in that list, one row
 * needs to be turned into a title so I edit the text block, select the row and
 * hit CTRL-B. The results are disastrous ... it destroys the list. Also, if I
 * have a list and the last element is a new row with just "-" somehow the
 * previous row becomes bold and big??"
 */
import { expect, test, type Page } from '@playwright/test';
import { activateTool, clickCanvas, commitEditor, expectEditorValue, fillEditor, selectInEditor, textEditor, waitForCanvasReady } from '../helpers';

type Step = string | { press: string };

async function editBlock(page: Page, steps: Step[]) {
  await page.goto('/');
  await waitForCanvasReady(page);
  await activateTool(page, 'text');
  await clickCanvas(page, 400, 300);
  await expect(textEditor(page)).toBeFocused();
  for (const step of steps) {
    if (typeof step === 'string') await page.keyboard.type(step);
    else await page.keyboard.press(step.press);
  }
}

async function commit(page: Page) {
  await commitEditor(page);
  const rendered = page.locator('.powernote-markdown').first();
  await expect(rendered).toBeVisible();
  return rendered;
}

const LIST: Step[] = ['- one', { press: 'Enter' }, 'two', { press: 'Enter' }, 'three'];

test('Ctrl+B on a selected list row bolds the row and keeps the list', async ({ page }) => {
  await editBlock(page, [...LIST, { press: 'ArrowUp' }, { press: 'Home' }, { press: 'Shift+End' }]);
  await page.keyboard.press('Control+b');
  await expectEditorValue(page, '- one\n- **two**\n- three');

  const rendered = await commit(page);
  await expect(rendered.locator('ul > li')).toHaveCount(3);
  await expect(rendered.locator('ul > li').nth(1).locator('strong')).toHaveText('two');
  await expect(rendered).not.toContainText('**');
  await expect(rendered).not.toContainText('- two');
});

test('a row selected with its line break, then the whole list, stays a list', async ({ page }) => {
  // Shift+Down from the row start also takes the newline: the old code broke every later row.
  await editBlock(page, [...LIST, { press: 'ArrowUp' }, { press: 'Home' }, { press: 'Shift+ArrowDown' }]);
  await page.keyboard.press('Control+b');
  await expectEditorValue(page, '- one\n- **two**\n- three');

  // Pressing again with the row still selected removes the bold.
  await page.keyboard.press('Control+b');
  await expectEditorValue(page, '- one\n- two\n- three');

  // Every row at once: each is bolded inside its own bullet.
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  await expectEditorValue(page, '- **one**\n- **two**\n- **three**');
  await page.keyboard.press('Control+i');
  await expectEditorValue(page, '- ***one***\n- ***two***\n- ***three***');

  const rendered = await commit(page);
  await expect(rendered.locator('ul > li')).toHaveCount(3);
  await expect(rendered.locator('li strong')).toHaveCount(3);
  await expect(rendered.locator('li em')).toHaveCount(3);
  await expect(rendered).not.toContainText('*');
});

test('a word selected with its trailing space is bolded without the space', async ({ page }) => {
  await editBlock(page, ['hello world']);
  await selectInEditor(page, 0, 6);
  await page.keyboard.press('Control+b');
  await expectEditorValue(page, '**hello** world');
  const rendered = await commit(page);
  await expect(rendered.locator('strong')).toHaveText('hello');
});

test('Tab on a new empty bullet does not turn the row above into a heading', async ({ page }) => {
  // The owner's second symptom: '- two\n  - ' rendered "two" big and bold.
  await editBlock(page, [...LIST.slice(0, 3), { press: 'Enter' }, { press: 'Tab' }]);
  await expectEditorValue(page, '- one\n- two\n  - ');
  const rendered = await commit(page);
  await expect(rendered.locator('h1, h2, h3, h4, h5, h6')).toHaveCount(0);
  await expect(rendered.locator('ul > li').nth(1)).toContainText('two');
  await expect(rendered.locator('ul ul > li')).toHaveCount(1);
});

test('dash and equals lines under text stay text, a rule, or an empty row', async ({ page }) => {
  for (const [typed, check] of [
    ['- one\n- two\n--', 'text'],
    ['one\ntwo\n-', 'row'],
    ['Notes\n===', 'text'],
    ['Notes\n---', 'rule'],
  ] as const) {
    await editBlock(page, []);
    await fillEditor(page, typed);
    const rendered = await commit(page);
    await expect(rendered.locator('h1, h2, h3, h4, h5, h6')).toHaveCount(0);
    if (check === 'rule') await expect(rendered.locator('hr')).toHaveCount(1);
    if (check === 'row') await expect(rendered.locator('ul > li')).toHaveCount(1);
    if (check === 'text') await expect(rendered).toContainText(typed.split('\n').pop()!);
  }
});
