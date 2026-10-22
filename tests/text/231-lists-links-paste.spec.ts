/**
 * Test 231: line-start shortcuts, lists, the link box, paste and copy.
 * Covers: REQ-TEXT-057, REQ-TEXT-058, REQ-TEXT-061, REQ-TEXT-065, REQ-TEXT-066
 *
 * Audit of v0.88.1: text typed after ending a list landed inside the last
 * item, Tab twice on a plain line made a code block, Home + Backspace in a
 * numbered row joined two rows, Ctrl+K inserted `[w](https://)` instead of
 * asking for an address, pasted plain `*b*` turned italic.
 *
 * Driven like a user (real keys, real double-clicks, real paste/copy events)
 * and read from the finished block's tags and visible text.
 *
 * Contract (new in v0.89.0, REQ-TEXT-061): the link box is an element with
 * data-testid="link-box" holding an input with data-testid="link-box-url";
 * it takes the keyboard focus when it opens.
 */
import { expect, test } from '@playwright/test';
import { textEditor, waitForCanvasReady } from '../helpers';
import {
  addTextBlock, clickAway, editBlock, finishedBlock, finishedText, newBlock, paste, renderedWeight,
  selectWordInEditor,
} from './text-user';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
});

const SHORTCUTS: Array<{ typed: string; name: string; tag: string }> = [
  { typed: '# ', name: 'heading 1', tag: 'h1' },
  { typed: '## ', name: 'heading 2', tag: 'h2' },
  { typed: '- ', name: 'bulleted list', tag: 'ul > li' },
  { typed: '1. ', name: 'numbered list', tag: 'ol > li' },
  { typed: '[ ] ', name: 'checklist row', tag: 'li input[type="checkbox"]' },
  { typed: '> ', name: 'quote', tag: 'blockquote' },
];

for (const s of SHORTCUTS) {
  test(`typing "${s.typed}" at the start of a line makes a ${s.name}; Ctrl+Z right after keeps the characters`, async ({ page }) => {
    await newBlock(page, `${s.typed}made`, 300, 150);
    await clickAway(page);
    await expect(finishedBlock(page, 'made').locator(s.tag), `"${s.typed}" makes a ${s.name}`).toHaveCount(1);
    expect(await finishedText(page, 'made')).toBe('made');

    await page.keyboard.press('Escape');
    await newBlock(page, s.typed, 300, 420);
    await page.keyboard.press('Control+z');
    await page.keyboard.type('kept');
    await clickAway(page);
    await expect(finishedBlock(page, 'kept').locator(s.tag), 'Ctrl+Z turned the shortcut back').toHaveCount(0);
    expect(await finishedText(page, 'kept')).toBe(`${s.typed}kept`);
  });
}

test('Enter continues a list; Enter on an empty row ends it and the next text is a paragraph below it', async ({ page }) => {
  await newBlock(page, '- one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('two');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('after list');
  await clickAway(page);

  const block = finishedBlock(page, 'after list');
  await expect(block.locator('ul > li')).toHaveCount(2);
  await expect(block.locator('ul > li').nth(1)).toHaveText('two');
  const para = block.locator('p').filter({ hasText: 'after list' });
  await expect(para, '"after list" is a paragraph').toHaveCount(1);
  expect(await para.evaluate((p) => p.closest('ul, ol, li') === null), '"after list" is not inside the list').toBe(true);
});

test('Tab twice on a plain line then typing makes no code block', async ({ page }) => {
  // A line indented by Tab must never turn into a code block, wherever it is.
  await newBlock(page, '');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('indented words');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('after blank');
  await expect(textEditor(page), 'Tab keeps the editor open').toBeFocused();
  await clickAway(page);
  const block = finishedBlock(page, 'indented words');
  await expect(block.locator('pre, code'), 'no code block').toHaveCount(0);
  await expect(block).toContainText('after blank');
});

test('Tab nests a list row and Shift+Tab un-nests it', async ({ page }) => {
  await newBlock(page, '- parent');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('child');
  await clickAway(page);
  const nested = () => finishedBlock(page, 'parent').locator('li li').filter({ hasText: 'child' });
  await expect(nested(), 'Tab nests "child" under "parent"').toHaveCount(1);

  await editBlock(page, 'child');
  await page.keyboard.press('Shift+Tab');
  await clickAway(page);
  await expect(nested(), 'Shift+Tab un-nests "child"').toHaveCount(0);
  await expect(finishedBlock(page, 'parent').locator('ul > li')).toHaveCount(2);
});

test('Home then Backspace in a numbered row removes its number and never joins rows', async ({ page }) => {
  await addTextBlock(page, 'steps', '1. step one\n2. step two\n3. step three', 'three');
  await editBlock(page, 'three');
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await clickAway(page);

  const block = finishedBlock(page, 'step one');
  await expect(block.locator('ol > li'), 'the third row lost its number').toHaveCount(2);
  const two = block.locator('li').filter({ hasText: 'step two' });
  await expect(two).not.toContainText('three');
  await expect(block).toContainText('step three');
  expect(await finishedText(page, 'step one')).not.toMatch(/two\s*3\.|twostep/);
});

test('Ctrl+K on a selected word opens the link box; an address and Enter make it a link', async ({ page }) => {
  await newBlock(page, 'see the docs');
  await selectWordInEditor(page, 'docs');
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('link-box'), 'Ctrl+K opens the link box').toBeVisible();
  await expect(page.getByTestId('link-box-url')).toBeFocused();
  await page.keyboard.type('https://example.com/docs');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('link-box')).toBeHidden();
  await clickAway(page);
  const link = finishedBlock(page, 'see the').locator('a');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText('docs');
  await expect(link).toHaveAttribute('href', 'https://example.com/docs');
  expect(await finishedText(page, 'see the')).toBe('see the docs');
});

test('Escape in the link box cancels: no link, text unchanged', async ({ page }) => {
  await newBlock(page, 'see the docs');
  await selectWordInEditor(page, 'docs');
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('link-box'), 'Ctrl+K opens the link box').toBeVisible();
  await page.keyboard.type('https://nope.example');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('link-box')).toBeHidden();
  await clickAway(page);
  await expect(finishedBlock(page, 'see the').locator('a')).toHaveCount(0);
  expect(await finishedText(page, 'see the')).toBe('see the docs');
});

test('pasting plain text keeps * as typed', async ({ page }) => {
  await newBlock(page, 'start ');
  await paste(page, { text: 'a *b* c and 2*3*4' });
  await clickAway(page);
  expect(await finishedText(page, 'start')).toBe('start a *b* c and 2*3*4');
  await expect(finishedBlock(page, 'start').locator('em, i')).toHaveCount(0);
});

test('pasting formatted HTML keeps bold and the list', async ({ page }) => {
  await newBlock(page, '');
  await paste(page, { html: '<b>boldpart</b><ul><li>listpart</li></ul>', text: 'boldpart\nlistpart' });
  await clickAway(page);
  expect(await renderedWeight(page, 'boldpart')).toBeGreaterThanOrEqual(600);
  await expect(finishedBlock(page, 'boldpart').locator('ul > li')).toHaveText(['listpart']);
});

test('a URL pasted over a selected word makes it a link', async ({ page }) => {
  await newBlock(page, 'read this');
  await selectWordInEditor(page, 'this');
  await paste(page, { text: 'https://example.org/page' });
  await clickAway(page);
  const link = finishedBlock(page, 'read').locator('a');
  await expect(link).toHaveText('this');
  await expect(link).toHaveAttribute('href', 'https://example.org/page');
  expect(await finishedText(page, 'read')).toBe('read this');
});

test('copy from the editor puts plain text and HTML with the bold on the clipboard', async ({ page }) => {
  await addTextBlock(page, 'copy', 'copy **strongword** text', 'strongword');
  await page.evaluate(() => {
    (window as any).__copied = null;
    window.addEventListener('copy', (e) => {
      const cd = (e as ClipboardEvent).clipboardData;
      (window as any).__copied = { plain: cd?.getData('text/plain') ?? '', html: cd?.getData('text/html') ?? '' };
    });
  });
  await editBlock(page, 'strongword');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  const copied = await page.waitForFunction(() => (window as any).__copied).then((h) => h.jsonValue()) as { plain: string; html: string };
  expect(copied.html, 'the HTML flavour carries the bold').toMatch(/<(strong|b)\b[^>]*>\s*strongword/);
  expect(copied.plain.replace(/\s+/g, ' ').trim(), 'the plain flavour is the visible text').toBe('copy strongword text');
});
