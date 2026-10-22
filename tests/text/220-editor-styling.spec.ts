/**
 * Test 220: the text-block editor shows formatting while you type.
 * Covers: REQ-TEXT-038, REQ-TEXT-039, REQ-TEXT-040
 *
 * Owner 2026-10-16: "make this a modern robust text editing feature". The text
 * stays markdown, but while editing bold is bold, headings are large and the
 * markers are dimmed; undo is the editor's own history; double-click puts the
 * caret under the pointer instead of selecting everything.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  activateTool, clickCanvas, commitEditor, editorSelection, expectEditorValue, fillEditor,
  getCanvasStore, textEditor, waitForCanvasReady,
} from '../helpers';

async function newBlock(page: Page) {
  await page.goto('/');
  await waitForCanvasReady(page);
  await activateTool(page, 'text');
  await clickCanvas(page, 400, 300);
  await expect(textEditor(page)).toBeFocused();
}

/** Computed style of the element in the editor whose own text is exactly `text`. */
function spanStyle(page: Page, text: string) {
  return page.evaluate((t) => {
    const el = [...document.querySelectorAll('[data-testid="text-editor"] *')].find((s) => s.textContent === t);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { weight: cs.fontWeight, size: parseFloat(cs.fontSize), style: cs.fontStyle, color: cs.color };
  }, text);
}

test('bold, italic and headings are drawn styled while editing, no markers shown', async ({ page }) => {
  // REQ-TEXT-054 (supersedes REQ-TEXT-038): the editor shows the block as it
  // will render, with no markdown markers; the stored text stays markdown.
  await newBlock(page);
  await page.keyboard.type('# Plan');
  await page.keyboard.press('Enter');
  // A closed `**bold**` formats as typed (REQ-TEXT-056); a single `*` never does, so italic comes from Ctrl+I.
  await page.keyboard.type('**bold** and ');
  await page.keyboard.press('Control+i');
  await page.keyboard.type('soft');
  await page.keyboard.press('Control+i');

  const body = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-testid="text-editor"]')!).fontSize));
  const heading = await spanStyle(page, 'Plan');
  expect(heading!.size).toBeGreaterThan(body * 1.5);
  expect(Number(heading!.weight)).toBeGreaterThanOrEqual(700);
  expect(Number((await spanStyle(page, 'bold'))!.weight)).toBeGreaterThanOrEqual(700);
  expect((await spanStyle(page, 'soft'))!.style).toBe('italic');

  // No markers on screen; the text is still markdown underneath.
  expect(await textEditor(page).innerText()).not.toMatch(/[#*]/);
  await expectEditorValue(page, '# Plan\n\n**bold** and *soft*');

  await commitEditor(page);
  const md = page.locator('.powernote-markdown').first();
  await expect(md.locator('h1')).toHaveText('Plan');
  await expect(md.locator('strong')).toHaveText('bold');
  await expect(md.locator('em')).toHaveText('soft');
});

test('undo and redo step through edits, a format command is one step', async ({ page }) => {
  await newBlock(page);
  await page.keyboard.type('hello world');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Control+b');
  await expectEditorValue(page, '**hello world**');
  await page.keyboard.press('Control+z');
  await expectEditorValue(page, 'hello world');
  await page.keyboard.press('Control+y');
  await expectEditorValue(page, '**hello world**');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expectEditorValue(page, '');
});

test('opening an existing block does not select all: one key cannot wipe it', async ({ page }) => {
  await newBlock(page);
  await fillEditor(page, 'Keep this sentence');
  await commitEditor(page);
  const box = await page.locator('.powernote-markdown').first().boundingBox();

  // Double-click near the end of the line: the caret lands there, nothing is selected.
  // The rendered block lets pointer events through to the canvas, so click by coordinates.
  await page.mouse.dblclick(box!.x + box!.width - 10, box!.y + box!.height / 2);
  await expect(textEditor(page)).toBeFocused();
  const [from, to] = await editorSelection(page);
  expect(from).toBe(to);
  await page.keyboard.type('!');
  await commitEditor(page);
  const store = await getCanvasStore(page);
  expect(store.nodes[0].data.text).toContain('Keep this sentence');
  expect(store.nodes[0].data.text.length).toBe('Keep this sentence'.length + 1);
});
