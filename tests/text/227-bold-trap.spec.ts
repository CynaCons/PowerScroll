/**
 * Test 227: Bold goes on and off exactly where the user asks, and never traps
 * the block in a bold it cannot leave.
 * Covers: REQ-TEXT-049, REQ-TEXT-050, REQ-TEXT-051, REQ-TEXT-052
 *
 * Owner report 2026-10-22: "I wanted to select a piece of text and put it in
 * bold, and then the entire text block was in bold, and I wasn't able to
 * unbold anymore. Nothing was working."
 *
 * Every assertion reads what the user sees: the computed font weight of the
 * words in the finished block, and the Bold button's pressed state. Words are
 * selected with a real double-click, the way a user selects them.
 */
import { expect, test, type Page } from '@playwright/test';
import { textEditor, waitForCanvasReady } from '../helpers';

async function canvasBox(page: Page) {
  return (await page.locator('[data-testid="canvas-container"] canvas').last().boundingBox())!;
}

/** T, click, type: a new block with `text`, still editing. */
async function newBlock(page: Page, text: string, x = 300, y = 200) {
  const box = await canvasBox(page);
  await page.keyboard.press('t');
  await page.mouse.click(box.x + x, box.y + y);
  await expect(textEditor(page)).toBeFocused();
  await page.keyboard.type(text);
}

/** The client rect of `word` inside `root` (first occurrence). */
async function wordCenter(page: Page, rootSelector: string, word: string) {
  const point = await page.evaluate(([sel, w]) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(w);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(n, i);
      range.setEnd(n, i + w.length);
      const r = range.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  }, [rootSelector, word] as const);
  expect(point, `"${word}" is on screen`).not.toBeNull();
  return point!;
}

/** Double-click a word in the live editor: the user's way of selecting it. */
async function selectWordInEditor(page: Page, word: string) {
  const p = await wordCenter(page, '[data-testid="text-editor"]', word);
  await page.mouse.dblclick(p.x, p.y);
}

/** Computed weight of `word` in the finished (not editing) block. */
async function renderedWeight(page: Page, word: string): Promise<number> {
  await expect(textEditor(page)).toHaveCount(0);
  return page.evaluate((w) => {
    for (const root of document.querySelectorAll('.powernote-markdown')) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.textContent!.includes(w)) return Number(getComputedStyle(n.parentElement!).fontWeight);
      }
    }
    return -1;
  }, word);
}

/** Leave editing by clicking empty canvas. */
async function clickAway(page: Page) {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 60, box.y + box.height - 60);
  await expect(textEditor(page)).toHaveCount(0);
}

/** Single-click a block's word: selects the block without editing it. */
async function selectBlock(page: Page, word: string) {
  const p = await wordCenter(page, '.powernote-markdown', word);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('selection-actions')).toBeVisible();
  await expect(textEditor(page)).toHaveCount(0);
}

/** Double-click a block's word to edit it. */
async function editBlock(page: Page, word: string) {
  const p = await wordCenter(page, '.powernote-markdown', word);
  await page.mouse.dblclick(p.x, p.y);
  await expect(textEditor(page)).toBeFocused();
}

const bold = (page: Page) => page.getByTestId('format-bold');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
});

test('select a word, Bold: only that word is bold; Bold again: nothing is', async ({ page }) => {
  await newBlock(page, 'hello world');
  await selectWordInEditor(page, 'world');
  await bold(page).click();
  await expect(bold(page)).toHaveAttribute('aria-pressed', 'true');
  await clickAway(page);
  expect(await renderedWeight(page, 'hello')).toBeLessThan(600);
  expect(await renderedWeight(page, 'world')).toBeGreaterThanOrEqual(600);

  await editBlock(page, 'world');
  await selectWordInEditor(page, 'world');
  await expect(bold(page)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+b');
  await expect(bold(page)).toHaveAttribute('aria-pressed', 'false');
  await clickAway(page);
  expect(await renderedWeight(page, 'world')).toBeLessThan(600);
});

test('the owner trap: Bold on a selected block, then unbold a word and then all of it', async ({ page }) => {
  await newBlock(page, 'hello world');
  await clickAway(page);
  await selectBlock(page, 'hello');

  // Bold on a selected block bolds its text, and the button says so.
  await bold(page).click();
  await expect(bold(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await renderedWeight(page, 'hello')).toBeGreaterThanOrEqual(600);
  expect(await renderedWeight(page, 'world')).toBeGreaterThanOrEqual(600);

  // Unbold one word from inside the block.
  await editBlock(page, 'world');
  await selectWordInEditor(page, 'world');
  await expect(bold(page)).toHaveAttribute('aria-pressed', 'true');
  await bold(page).click();
  await clickAway(page);
  expect(await renderedWeight(page, 'hello')).toBeGreaterThanOrEqual(600);
  expect(await renderedWeight(page, 'world')).toBeLessThan(600);

  // Bold on the selected block again: mixed, so it bolds all; once more unbolds all.
  await selectBlock(page, 'hello');
  await bold(page).click();
  expect(await renderedWeight(page, 'world')).toBeGreaterThanOrEqual(600);
  await bold(page).click();
  await expect(bold(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await renderedWeight(page, 'hello')).toBeLessThan(600);
  expect(await renderedWeight(page, 'world')).toBeLessThan(600);
});

test('Ctrl+B on a selected block bolds it and Ctrl+B again unbolds it', async ({ page }) => {
  await newBlock(page, 'plain words');
  await clickAway(page);
  await selectBlock(page, 'plain');
  await page.keyboard.press('Control+b');
  expect(await renderedWeight(page, 'words')).toBeGreaterThanOrEqual(600);
  await page.keyboard.press('Control+b');
  expect(await renderedWeight(page, 'words')).toBeLessThan(600);
});

test('Bold with nothing selected does not make the next blocks bold', async ({ page }) => {
  // Nothing to format: the button is off and changes nothing for later blocks.
  if (await bold(page).isVisible() && await bold(page).isEnabled()) await bold(page).click();
  await newBlock(page, 'fresh text');
  await clickAway(page);
  expect(await renderedWeight(page, 'fresh')).toBeLessThan(600);
});

test('a block saved with the old whole-block bold can be unbolded', async ({ page }) => {
  // Files written before the redesign may carry fontStyle "bold".
  await page.evaluate(() => {
    const stores = (window as any).__POWERNOTE_STORES__;
    stores.canvas.getState().addNode({
      id: 'legacy-bold', type: 'text', x: 300, y: 200, width: 400, height: 30,
      data: { text: 'legacy words', fontSize: 16, fontFamily: 'Inter, sans-serif', fontStyle: 'bold', fill: '#1a1a1a' },
    });
  });
  expect(await renderedWeight(page, 'legacy')).toBeGreaterThanOrEqual(600);
  await selectBlock(page, 'legacy');
  await expect(bold(page)).toHaveAttribute('aria-pressed', 'true');
  await bold(page).click();
  expect(await renderedWeight(page, 'legacy')).toBeLessThan(600);
  expect(await renderedWeight(page, 'words')).toBeLessThan(600);
});
