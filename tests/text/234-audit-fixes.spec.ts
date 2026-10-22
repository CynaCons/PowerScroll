/**
 * Test 234: fixes from the second real-input audit of the v0.89.0 editor.
 * Covers: REQ-TEXT-067, REQ-TEXT-068, REQ-TEXT-069, REQ-TEXT-070, REQ-TEXT-071,
 *         REQ-TEXT-072, REQ-TEXT-073, REQ-TEXT-074, REQ-MATH-006, REQ-TEXT-051
 *
 * Audit 2026-10-23: `$x^2$` stayed literal and a formula could not be edited;
 * Tab in a table typed into one cell; a blank line made with Enter vanished
 * after leaving; markdown pasted from a chat came out escaped; `example.com`
 * links went nowhere and Ctrl+K glued the address to the word before; after
 * picking a colour the next key was lost; Ctrl+Shift+0 on a heading pulled it
 * into the list above; checklist boxes sat out of line with bullets; the Bold
 * button lagged behind a click into bold text.
 *
 * Driven like a user (real mouse, real keyboard, paste events) and read from
 * what is on screen and what is stored.
 *
 * Contract assumed beyond the shared test ids: a formula's source editor,
 * while editing, is an input with data-testid="math-source".
 */
import { expect, test, type Page } from '@playwright/test';
import { textEditor, waitForCanvasReady } from '../helpers';
import {
  addTextBlock, caretInEditor, clickAway, EDITOR, editBlock, FINISHED, finishedBlock, finishedText, newBlock,
  paste, rendered, selectWordInEditor, storedText, wordRect,
} from './text-user';

const pressed = (page: Page, id: string) => page.getByTestId(id);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
});

// ── REQ-TEXT-067 / REQ-MATH-006: formulas ───────────────────────────────────

test('typing a closed $...$ makes a formula; $5 or $6 stays literal', async ({ page }) => {
  await newBlock(page, 'energy $E=mc^2$ costs $5 or $6 here');
  await clickAway(page);
  const block = finishedBlock(page, 'energy');
  await expect(block.locator('.katex')).toHaveCount(1);
  expect(await finishedText(page, 'energy')).toContain('costs $5 or $6 here');
  expect(await finishedText(page, 'energy')).not.toContain('$E');
  expect(await storedText(page)).toContain('$E=mc^2$');
});

test('$$...$$ on its own line makes a display formula', async ({ page }) => {
  await newBlock(page, 'above');
  await page.keyboard.press('Enter');
  await page.keyboard.type('$$a+b$$');
  await clickAway(page);
  await expect(finishedBlock(page, 'above').locator('.katex-display')).toHaveCount(1);
  expect(await storedText(page)).toContain('$$a+b$$');
});

test('clicking a formula while editing opens its source; Enter applies, Escape restores, a key never replaces it', async ({ page }) => {
  await addTextBlock(page, 'math', 'energy $E=mc^2$ here', 'energy');
  await editBlock(page, 'energy');
  const formula = page.locator(`${EDITOR} .katex`).first();
  await formula.click();
  const source = page.getByTestId('math-source');
  await expect(source, 'clicking the formula opens its LaTeX source').toBeVisible();
  await expect(source).toHaveValue('E=mc^2');
  await expect(source).toBeFocused();

  // A typed key goes into the source, never over the formula.
  await page.keyboard.press('End');
  await page.keyboard.type('+1');
  await page.keyboard.press('Escape');
  await expect(source).toBeHidden();
  await expect(page.locator(`${EDITOR} .katex`)).toHaveCount(1);
  await clickAway(page);
  expect(await storedText(page, 'math'), 'Escape restored the formula').toBe('energy $E=mc^2$ here');

  await editBlock(page, 'energy');
  await page.locator(`${EDITOR} .katex`).first().click();
  await expect(page.getByTestId('math-source')).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type('+1');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('math-source')).toBeHidden();
  await expect(page.locator(`${EDITOR} .katex`)).toHaveCount(1);
  await clickAway(page);
  expect(await storedText(page, 'math'), 'Enter applied the edited source').toBe('energy $E=mc^2+1$ here');
  await expect(finishedBlock(page, 'energy').locator('.katex')).toHaveCount(1);
});

// ── REQ-TEXT-068: tables ────────────────────────────────────────────────────

test('Tab and Shift+Tab move between cells; Tab in the last cell adds a row', async ({ page }) => {
  await addTextBlock(page, 'table', '| Name | Age |\n|------|-----|\n| Alice | 30 |', 'Alice');
  await editBlock(page, 'Alice');
  await page.keyboard.type('Alicia');
  await page.keyboard.press('Tab');
  await page.keyboard.type('31');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Bob');
  await clickAway(page);
  const block = finishedBlock(page, 'Alicia');
  await expect(block.locator('tr')).toHaveCount(3);
  await expect(block.locator('td')).toHaveText(['Alicia!', '31', 'Bob', '']);
  expect(await storedText(page, 'table')).toContain('| Alicia! | 31 |');
  expect(await storedText(page, 'table')).toContain('| Bob |');
});

// ── REQ-TEXT-069: blank lines ───────────────────────────────────────────────

test('a blank line made with Enter twice stays: same place editing and finished, survives reopening', async ({ page }) => {
  await newBlock(page, 'Para one');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Para two');
  const editingTop = (await wordRect(page, EDITOR, 'Para two')).top;
  await clickAway(page);
  const finishedTop = (await wordRect(page, FINISHED, 'Para two')).top;
  expect(Math.abs(finishedTop - editingTop), 'the blank line is kept after leaving').toBeLessThanOrEqual(2);
  const stored = await storedText(page);

  await editBlock(page, 'Para two');
  expect(Math.abs((await wordRect(page, EDITOR, 'Para two')).top - finishedTop), 'the blank line is back on reopening').toBeLessThanOrEqual(2);
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await clickAway(page);
  expect(await storedText(page), 'an edit keeps the blank line').toBe(stored.replace('Para two', 'Para two!'));
  expect(Math.abs((await wordRect(page, FINISHED, 'Para two')).top - finishedTop)).toBeLessThanOrEqual(2);
});

// ── REQ-TEXT-070: pasting markdown ──────────────────────────────────────────

test('plain text that is markdown pastes formatted; Ctrl+Shift+V pastes it as typed', async ({ page }) => {
  await newBlock(page, '');
  await paste(page, { text: '# Agent answer\n\n**Key point** and [docs](https://example.com/d)\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |' });
  await clickAway(page);
  const block = finishedBlock(page, 'Agent answer');
  await expect(block.locator('h1')).toHaveText('Agent answer');
  await expect(block.locator('strong')).toHaveText('Key point');
  await expect(block.locator('a')).toHaveAttribute('href', 'https://example.com/d');
  await expect(block.locator('ul > li')).toHaveText(['one', 'two']);
  await expect(block.locator('td')).toHaveText(['1', '2']);

  await page.keyboard.press('Escape');
  await newBlock(page, '', 300, 500);
  await page.keyboard.press('Control+Shift+v');
  await paste(page, { text: '# not a heading\n- not a row' });
  await clickAway(page);
  const plain = finishedBlock(page, 'not a heading');
  await expect(plain.locator('h1, li')).toHaveCount(0);
  expect(await finishedText(page, 'not a heading')).toBe('# not a heading - not a row');
});

test('plain text with no markdown structure still pastes as typed', async ({ page }) => {
  await newBlock(page, 'start ');
  await paste(page, { text: 'costs $5 and 2*3*4 or a_b_c' });
  await clickAway(page);
  expect(await finishedText(page, 'start')).toBe('start costs $5 and 2*3*4 or a_b_c');
  await expect(finishedBlock(page, 'start').locator('em, .katex')).toHaveCount(0);
});

// ── REQ-TEXT-071 / REQ-TEXT-051: links ──────────────────────────────────────

test('an address without a scheme is stored with https://, and the link opens', async ({ page }) => {
  await newBlock(page, 'see the docs');
  await selectWordInEditor(page, 'docs');
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('link-box-url')).toBeFocused();
  await page.keyboard.type('example.com/path');
  await page.keyboard.press('Enter');
  await clickAway(page);
  const link = finishedBlock(page, 'see the').locator('a');
  await expect(link).toHaveAttribute('href', 'https://example.com/path');
  await expect(link).toHaveText('docs');
  expect(await storedText(page)).toBe('see the [docs](https://example.com/path)');
});

test('Ctrl+K with nothing selected inserts the link as its own text, not glued to the word before', async ({ page }) => {
  await newBlock(page, 'visit today');
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('link-box-url')).toBeFocused();
  await page.keyboard.type('a.b/c');
  await page.keyboard.press('Enter');
  await clickAway(page);
  expect(await finishedText(page, 'visit')).toMatch(/^visit today \S+a\.b\/c$/);
  const link = finishedBlock(page, 'visit').locator('a');
  await expect(link).toHaveAttribute('href', 'https://a.b/c');
  await expect(link).toHaveText(/a\.b\/c$/);
});

test('the Link button is pressed with the caret inside a link', async ({ page }) => {
  await addTextBlock(page, 'linked', 'see [the docs](https://example.com) now', 'docs');
  await editBlock(page, 'docs');
  await caretInEditor(page, 'docs', 2);
  await expect(pressed(page, 'format-link')).toHaveAttribute('aria-pressed', 'true');
  await caretInEditor(page, 'now', 1);
  await expect(pressed(page, 'format-link')).toHaveAttribute('aria-pressed', 'false');
});

// ── REQ-TEXT-072: typing right after a toolbar change ───────────────────────

test('after picking a colour the next key replaces the selected word', async ({ page }) => {
  await newBlock(page, 'size and colour here');
  await selectWordInEditor(page, 'colour');
  await page.getByTestId('bottom-toolbar').getByTestId('color-trigger').click();
  await page.getByTestId('color-popover').locator('button[title="#dc2626"]').click();
  await page.keyboard.type('red');
  await clickAway(page);
  expect(await finishedText(page, 'size')).toBe('size and red here');
  expect((await rendered(page, 'red')).color).toBe('rgb(220, 38, 38)');
});

test('after picking a size the next key replaces the selected word', async ({ page }) => {
  await newBlock(page, 'size and colour here');
  await selectWordInEditor(page, 'size');
  await page.getByTestId('bottom-toolbar').getByTestId('size-trigger').click();
  await page.getByTestId('size-popover').getByRole('button', { name: '24px' }).click();
  await page.keyboard.type('big');
  await clickAway(page);
  expect(await finishedText(page, 'big')).toBe('big and colour here');
});

// ── REQ-TEXT-073: heading back to text after a list ─────────────────────────

test('Ctrl+Shift+0 on a heading after a list makes a plain paragraph, not a list row', async ({ page }) => {
  await addTextBlock(page, 'headed', '- a\n- b\n\n# Title', 'Title');
  await editBlock(page, 'Title');
  await page.keyboard.press('Control+Shift+Digit0');
  await clickAway(page);
  const block = finishedBlock(page, 'Title');
  await expect(block.locator('li')).toHaveText(['a', 'b']);
  await expect(block.locator('h1')).toHaveCount(0);
  const para = block.locator('p').filter({ hasText: 'Title' });
  await expect(para).toHaveCount(1);
  expect(await para.evaluate((p) => p.closest('li') === null)).toBe(true);
});

// ── REQ-TEXT-074: checklist rows line up with bullets ───────────────────────

test('a checklist row lines up with bullet rows: box where the bullet is, text at the same x', async ({ page }) => {
  await addTextBlock(page, 'rows', '- apples\n- [ ] tickets\n1. alpha', 'apples');
  const apples = await wordRect(page, FINISHED, 'apples');
  const tickets = await wordRect(page, FINISHED, 'tickets');
  expect(Math.abs(apples.left - tickets.left), 'text starts at the same x').toBeLessThanOrEqual(1);
  const box = (await page.locator(`${FINISHED} input[type="checkbox"]`).boundingBox())!;
  const list = (await page.locator(`${FINISHED} ul`).first().boundingBox())!;
  expect(box.x, 'the box sits inside the list indent').toBeGreaterThanOrEqual(list.x);
  expect(box.x + box.width, 'the box ends before the text').toBeLessThanOrEqual(tickets.left + 1);
  expect(box.x + box.width, 'the box sits next to the text, where the bullet is').toBeGreaterThanOrEqual(tickets.left - 10);
});

// ── REQ-TEXT-051: the toolbar follows a click without delay ─────────────────

test('clicking into a bold word presses Bold at once', async ({ page }) => {
  await addTextBlock(page, 'state', 'plain and **strong** words', 'plain');
  await editBlock(page, 'plain');
  await caretInEditor(page, 'strong', 3);
  await expect(pressed(page, 'format-bold')).toHaveAttribute('aria-pressed', 'true', { timeout: 150 });
  await caretInEditor(page, 'plain', 2);
  await expect(pressed(page, 'format-bold')).toHaveAttribute('aria-pressed', 'false', { timeout: 150 });
  await expect(textEditor(page)).toBeFocused();
});
