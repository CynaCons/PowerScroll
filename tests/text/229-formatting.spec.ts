/**
 * Test 229: every format command switches cleanly on and off, the toolbar
 * tells the truth, and typed characters stay as typed.
 * Covers: REQ-TEXT-049, REQ-TEXT-050, REQ-TEXT-051, REQ-TEXT-052, REQ-TEXT-053, REQ-TEXT-055, REQ-TEXT-056, REQ-TEXT-062
 *
 * Owner 2026-10-22 (v0.89.0 redesign): "think from the user perspective,
 * cover all the standard use cases." Audit of v0.88.1: `****` after Ctrl+A
 * and Ctrl+B twice, `wo****rld` at a caret, `hello** new**`, broken markers
 * across a bold edge, Bold never pressed in bold text, two selected blocks
 * ignore Bold, `2*3*4` turns italic, no Ctrl+Shift+Z redo.
 *
 * Driven like a user: words are selected by real double-click or drag, and
 * every assertion reads what is on screen (computed style, visible text,
 * aria-pressed) - never the editor engine.
 */
import { expect, test, type Page } from '@playwright/test';
import { textEditor, waitForCanvasReady } from '../helpers';
import {
  addTextBlock, canvasBox, caretInEditor, clickAway, dragSelectInEditor, EDITOR, editBlock, editorText,
  finishedBlock, finishedText, newBlock, rendered, renderedWeight, selectBlock, selectWordInEditor,
  styleIn, type WordStyle,
} from './text-user';

const FORMATS: Array<{ name: string; key: string; button: string; on: (s: WordStyle) => boolean }> = [
  { name: 'bold', key: 'Control+b', button: 'format-bold', on: (s) => s.weight >= 600 },
  { name: 'italic', key: 'Control+i', button: 'format-italic', on: (s) => s.italic },
  { name: 'underline', key: 'Control+u', button: 'format-underline', on: (s) => s.decorations.includes('underline') },
  { name: 'strikethrough', key: 'Control+Shift+x', button: 'format-strike', on: (s) => s.decorations.includes('line-through') },
  { name: 'code', key: 'Control+e', button: 'format-code', on: (s) => s.mono },
];

const bold = (page: Page) => page.getByTestId('format-bold');

/** Text nodes outside headings that render bold in the finished blocks. */
async function boldOutsideHeadings(page: Page): Promise<string[]> {
  await expect(textEditor(page)).toHaveCount(0);
  return page.evaluate(() => {
    const out: string[] = [];
    for (const root of document.querySelectorAll('.powernote-markdown')) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent!.trim()) continue;
        const el = n.parentElement!;
        if (el.closest('h1,h2,h3,h4,h5,h6')) continue;
        if (Number(getComputedStyle(el).fontWeight) >= 600) out.push(n.textContent!);
      }
    }
    return out;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
});

for (const f of FORMATS) {
  test(`${f.name}: on a double-clicked word, then off, with no stray characters`, async ({ page }) => {
    await newBlock(page, 'alpha beta gamma');
    await selectWordInEditor(page, 'beta');
    await page.keyboard.press(f.key);
    await clickAway(page);
    expect(f.on(await rendered(page, 'beta')), `"beta" is ${f.name}`).toBe(true);
    expect(f.on(await rendered(page, 'alpha')), `"alpha" is not ${f.name}`).toBe(false);
    expect(f.on(await rendered(page, 'gamma')), `"gamma" is not ${f.name}`).toBe(false);
    expect(await finishedText(page, 'alpha')).toBe('alpha beta gamma');

    // Off with the toolbar, then on and off again with the key.
    await editBlock(page, 'beta');
    await selectWordInEditor(page, 'beta');
    await page.getByTestId(f.button).click();
    await page.keyboard.press(f.key);
    await page.keyboard.press(f.key);
    await clickAway(page);
    expect(f.on(await rendered(page, 'beta')), `"beta" is no longer ${f.name}`).toBe(false);
    expect(await finishedText(page, 'alpha')).toBe('alpha beta gamma');
  });
}

test('Ctrl+A over a heading, paragraph, list and blank line, Ctrl+B twice: nothing bold, text unchanged', async ({ page }) => {
  await addTextBlock(page, 'mixed', '# Title here\n\nSome paragraph text\n\n- first item\n- second item\n\n\nlast line', 'paragraph');
  const before = await finishedText(page, 'paragraph');
  await editBlock(page, 'paragraph');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+b');
  await clickAway(page);
  expect(await boldOutsideHeadings(page), 'no bold text left outside the heading').toEqual([]);
  expect(await finishedText(page, 'paragraph')).toBe(before);
  expect(await finishedText(page, 'paragraph')).not.toMatch(/[*~`]/);
});

test('Bold across the edge of a bold word, then Bold again: clean text, no markers', async ({ page }) => {
  await addTextBlock(page, 'edge', 'The **important** point', 'point');
  await editBlock(page, 'point');
  // From "Th|e" to "imp|ortant": half plain, half bold.
  await dragSelectInEditor(page, 'The', 2, 'important', 3);
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+b');
  await clickAway(page);
  expect(await finishedText(page, 'point')).toBe('The important point');
  expect(await renderedWeight(page, 'point')).toBeLessThan(600);
  expect(await renderedWeight(page, 'ortant')).toBeGreaterThanOrEqual(600);
});

test('Ctrl+B with the caret mid-word shows nothing; typing next is bold', async ({ page }) => {
  await newBlock(page, 'hello world');
  await caretInEditor(page, 'world', 2);
  await page.keyboard.press('Control+b');
  await expect.poll(() => editorText(page), 'Ctrl+B at a caret inserts nothing visible').toBe('hello world');
  await page.keyboard.type('NEW');
  await clickAway(page);
  expect(await finishedText(page, 'hello')).toBe('hello woNEWrld');
  expect(await renderedWeight(page, 'NEW')).toBeGreaterThanOrEqual(600);
  expect(await renderedWeight(page, 'hello')).toBeLessThan(600);
});

test('Ctrl+B at the end then typing: the new words are bold, no asterisks', async ({ page }) => {
  await newBlock(page, 'hello world');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' new');
  await clickAway(page);
  expect(await finishedText(page, 'hello')).toBe('hello world new');
  expect(await renderedWeight(page, 'new')).toBeGreaterThanOrEqual(600);
  expect(await renderedWeight(page, 'hello')).toBeLessThan(600);
});

test('Ctrl+B then Ctrl+B before typing cancels: the typed text is plain', async ({ page }) => {
  await newBlock(page, 'hello world');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' tail');
  await clickAway(page);
  expect(await finishedText(page, 'hello')).toBe('hello world tail');
  expect(await renderedWeight(page, 'tail')).toBeLessThan(600);
});

test('typed *, _, #, <, $, [ and \\ inside a sentence stay as typed after leaving and reopening', async ({ page }) => {
  const typed = 'calc 2*3*4 and a_b_c then # not heading and <b>x</b> cost $5 or $6 see [x] back\\slash';
  await newBlock(page, typed);
  await clickAway(page);
  expect(await finishedText(page, 'calc')).toBe(typed);
  await expect(finishedBlock(page, 'calc').locator('em, strong, b, i, h1, code, .katex')).toHaveCount(0);

  await editBlock(page, 'calc');
  await clickAway(page);
  expect(await finishedText(page, 'calc')).toBe(typed);
  await expect(finishedBlock(page, 'calc').locator('em, strong, b, i, h1, code, .katex')).toHaveCount(0);
});

test('the format buttons show the state at the caret (aria-pressed)', async ({ page }) => {
  await addTextBlock(page, 'state', '# Heading line\n\nplain and **strong** words\n\n- listed row\n\n1. numbered row', 'plain');
  await editBlock(page, 'plain');
  const pressed = (id: string) => page.getByTestId(id);

  await caretInEditor(page, 'strong', 3);
  await expect(pressed('format-bold')).toHaveAttribute('aria-pressed', 'true');
  await caretInEditor(page, 'plain', 2);
  await expect(pressed('format-bold')).toHaveAttribute('aria-pressed', 'false');

  await caretInEditor(page, 'Heading', 3);
  await expect(pressed('format-heading')).toHaveAttribute('aria-pressed', 'true');
  await expect(pressed('format-list-bullet')).toHaveAttribute('aria-pressed', 'false');

  await caretInEditor(page, 'listed', 3);
  await expect(pressed('format-list-bullet')).toHaveAttribute('aria-pressed', 'true');
  await expect(pressed('format-heading')).toHaveAttribute('aria-pressed', 'false');

  await caretInEditor(page, 'numbered', 3);
  await expect(pressed('format-list-number')).toHaveAttribute('aria-pressed', 'true');
  await expect(pressed('format-list-bullet')).toHaveAttribute('aria-pressed', 'false');

  await caretInEditor(page, 'words', 2);
  await expect(pressed('format-list-number')).toHaveAttribute('aria-pressed', 'false');
  await expect(pressed('format-heading')).toHaveAttribute('aria-pressed', 'false');
});

test('two selected blocks: toolbar Bold bolds both, Bold again unbolds both', async ({ page }) => {
  await newBlock(page, 'first block', 300, 150);
  await page.keyboard.press('Escape');
  await expect(textEditor(page)).toHaveCount(0);
  await newBlock(page, 'second block', 300, 400);
  await clickAway(page);
  await selectBlock(page, 'first');
  await selectBlock(page, 'second', true);

  await expect(bold(page), 'Bold is offered for two selected blocks').toBeVisible();
  await bold(page).click();
  for (const w of ['first', 'second']) await expect.poll(() => renderedWeight(page, w), `"${w}" bold`).toBeGreaterThanOrEqual(600);
  await expect(bold(page)).toHaveAttribute('aria-pressed', 'true');

  await bold(page).click();
  for (const w of ['first', 'second']) await expect.poll(() => renderedWeight(page, w), `"${w}" plain`).toBeLessThan(600);
  await expect(bold(page)).toHaveAttribute('aria-pressed', 'false');
});

test('Ctrl+B on a single selected block bolds it; a word can then be unbolded; Ctrl+B again unbolds all', async ({ page }) => {
  await newBlock(page, 'plain words');
  await clickAway(page);
  await selectBlock(page, 'plain');
  await page.keyboard.press('Control+b');
  await expect.poll(() => renderedWeight(page, 'words')).toBeGreaterThanOrEqual(600);
  await expect(bold(page)).toHaveAttribute('aria-pressed', 'true');

  // The owner trap: unbold one word from inside the block.
  await editBlock(page, 'words');
  await selectWordInEditor(page, 'words');
  await page.keyboard.press('Control+b');
  await clickAway(page);
  expect(await renderedWeight(page, 'words')).toBeLessThan(600);
  expect(await renderedWeight(page, 'plain')).toBeGreaterThanOrEqual(600);

  // Mixed: Ctrl+B bolds all; again unbolds all.
  await selectBlock(page, 'plain');
  await page.keyboard.press('Control+b');
  await expect.poll(() => renderedWeight(page, 'words')).toBeGreaterThanOrEqual(600);
  await page.keyboard.press('Control+b');
  await expect.poll(() => renderedWeight(page, 'words')).toBeLessThan(600);
  expect(await renderedWeight(page, 'plain')).toBeLessThan(600);
  expect(await finishedText(page, 'plain')).toBe('plain words');
});

test('Bold with no block and no text selected does not make the next block bold', async ({ page }) => {
  await page.keyboard.press('t');
  await expect(bold(page)).toBeVisible();
  if (await bold(page).isEnabled()) await bold(page).click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 300, box.y + 200);
  await expect(textEditor(page)).toBeFocused();
  await page.keyboard.type('fresh text');
  await clickAway(page);
  expect(await renderedWeight(page, 'fresh')).toBeLessThan(600);
});

test('typed HTML shows as text and never runs', async ({ page }) => {
  const typed = 'see <img src=x onerror="window.__xss=1"> here';
  await newBlock(page, typed);
  await clickAway(page);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__xss), 'no script ran').toBeUndefined();
  expect(await finishedText(page, 'see')).toBe(typed);
});

test('undo and redo while editing: Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z, one step per command', async ({ page }) => {
  const two = async () => {
    const w = (await styleIn(page, EDITOR, 'two'))?.weight;
    return w === undefined ? 'missing' : w >= 600 ? 'bold' : 'plain';
  };
  await newBlock(page, 'one two');
  await page.keyboard.type(' three');
  await selectWordInEditor(page, 'two');
  await page.keyboard.press('Control+b');
  await expect.poll(two).toBe('bold');

  await page.keyboard.press('Control+z');
  await expect.poll(two, 'Ctrl+Z undoes the bold').toBe('plain');
  expect(await editorText(page)).toContain('three');
  await page.keyboard.press('Control+y');
  await expect.poll(two, 'Ctrl+Y redoes it').toBe('bold');

  await page.keyboard.press('Control+z');
  await expect.poll(two).toBe('plain');
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(two, 'Ctrl+Shift+Z redoes it').toBe('bold');

  // Back past the bold, then the typing.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect.poll(() => editorText(page), 'Ctrl+Z steps back through typing').not.toContain('three');
  await page.keyboard.press('Control+y');
  await expect.poll(() => editorText(page), 'Ctrl+Y brings the typing back').toContain('three');
});
