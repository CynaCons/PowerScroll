/**
 * Shared helpers for the text-block acceptance tests (T229-T232).
 *
 * Everything here drives the app the way a user does: real mouse, real
 * keyboard, and reads what is on screen (computed styles, visible text,
 * aria-pressed). Nothing reaches into the editor engine, so the same tests
 * hold for the CodeMirror editor of v0.88 and the ProseMirror one of v0.89.
 *
 * Helpers copied from T227 (newBlock, wordCenter, selectWordInEditor,
 * clickAway, selectBlock, editBlock) keep their behaviour.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { textEditor } from '../helpers';

export const EDITOR = '[data-testid="text-editor"]';
export const FINISHED = '.powernote-markdown';

export async function canvasBox(page: Page) {
  return (await page.locator('[data-testid="canvas-container"] canvas').last().boundingBox())!;
}

/** T, click, type: a new block with `text`, still editing. */
export async function newBlock(page: Page, text: string, x = 300, y = 200) {
  const box = await canvasBox(page);
  await page.keyboard.press('t');
  await page.mouse.click(box.x + x, box.y + y);
  await expect(textEditor(page)).toBeFocused();
  if (text) await page.keyboard.type(text);
}

/**
 * A text block written straight into the store as markdown, as a file or an
 * agent would. Waits until `word` shows in a finished block.
 */
export async function addTextBlock(
  page: Page,
  id: string,
  text: string,
  word: string,
  opts: { x?: number; y?: number; width?: number } = {},
) {
  await page.evaluate(({ id, text, x, y, width }) => {
    const stores = (window as any).__POWERNOTE_STORES__;
    stores.canvas.getState().addNode({
      id, type: 'text', x, y, width, height: 30,
      data: { text, fontSize: 16, fontFamily: 'Inter, sans-serif', fontStyle: 'normal', fill: '#1a1a1a' },
    });
  }, { id, text, x: opts.x ?? 300, y: opts.y ?? 200, width: opts.width ?? 400 });
  await expect(page.locator(FINISHED).filter({ hasText: word }).first()).toBeVisible();
  // Height auto-sizes a moment after the first paint; let it settle.
  await expect.poll(async () => {
    const a = await page.locator(FINISHED).filter({ hasText: word }).first().boundingBox();
    await page.waitForTimeout(100);
    const b = await page.locator(FINISHED).filter({ hasText: word }).first().boundingBox();
    return Math.abs((a?.height ?? 0) - (b?.height ?? -1)) + Math.abs((a?.y ?? 0) - (b?.y ?? -1));
  }).toBeLessThan(0.5);
}

/** The client rect of `word` (first occurrence) inside any element matching `rootSelector`. */
export async function wordRect(page: Page, rootSelector: string, word: string) {
  const rect = await page.evaluate(([sel, w]) => {
    for (const root of document.querySelectorAll(sel)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.textContent!.indexOf(w);
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(n, i);
        range.setEnd(n, i + w.length);
        const r = range.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      }
    }
    return null;
  }, [rootSelector, word] as const);
  expect(rect, `"${word}" is on screen`).not.toBeNull();
  return rect!;
}

/** The centre of `word` inside `rootSelector`. */
export async function wordCenter(page: Page, rootSelector: string, word: string) {
  const r = await wordRect(page, rootSelector, word);
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** The point just before character `offset` of `word` (the caret spot a click there makes). */
export async function charPoint(page: Page, rootSelector: string, word: string, offset: number) {
  const point = await page.evaluate(([sel, w, off]) => {
    for (const root of document.querySelectorAll(sel as string)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.textContent!.indexOf(w as string);
        if (i < 0) continue;
        const range = document.createRange();
        const at = i + (off as number);
        if (at < n.textContent!.length) {
          range.setStart(n, at);
          range.setEnd(n, at + 1);
          const r = range.getBoundingClientRect();
          return { x: r.left + 0.5, y: r.top + r.height / 2 };
        }
        range.setStart(n, at - 1);
        range.setEnd(n, at);
        const r = range.getBoundingClientRect();
        return { x: r.right - 0.5, y: r.top + r.height / 2 };
      }
    }
    return null;
  }, [rootSelector, word, offset] as const);
  expect(point, `"${word}" is on screen`).not.toBeNull();
  return point!;
}

/** Double-click a word in the live editor: the user's way of selecting it. */
export async function selectWordInEditor(page: Page, word: string) {
  const p = await wordCenter(page, EDITOR, word);
  await page.mouse.dblclick(p.x, p.y);
}

/** Single-click inside the live editor at character `offset` of `word` (puts the caret there). */
export async function caretInEditor(page: Page, word: string, offset: number) {
  const p = await charPoint(page, EDITOR, word, offset);
  await page.mouse.click(p.x, p.y);
}

/** Drag-select in the live editor from char `fromOff` of `fromWord` to char `toOff` of `toWord`. */
export async function dragSelectInEditor(page: Page, fromWord: string, fromOff: number, toWord: string, toOff: number) {
  const a = await charPoint(page, EDITOR, fromWord, fromOff);
  const b = await charPoint(page, EDITOR, toWord, toOff);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

export interface WordStyle {
  weight: number;
  italic: boolean;
  /** text-decoration-line of the word's element and every ancestor up to the block. */
  decorations: string[];
  mono: boolean;
  color: string;
}

/** Computed style of the text node holding `word` inside `rootSelector`. */
export async function styleIn(page: Page, rootSelector: string, word: string): Promise<WordStyle | null> {
  return page.evaluate(([sel, w]) => {
    for (const root of document.querySelectorAll(sel)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent!.includes(w)) continue;
        const el = n.parentElement!;
        const cs = getComputedStyle(el);
        const decorations: string[] = [];
        for (let a: Element | null = el; a; a = a.parentElement) {
          for (const d of getComputedStyle(a).textDecorationLine.split(/\s+/)) {
            if (d && d !== 'none' && !decorations.includes(d)) decorations.push(d);
          }
          if (a === root) break;
        }
        return {
          weight: Number(cs.fontWeight),
          italic: cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique'),
          decorations,
          mono: /mono|consolas|courier|menlo/i.test(cs.fontFamily),
          color: cs.color,
        };
      }
    }
    return null;
  }, [rootSelector, word] as const);
}

/** Computed style of `word` in a finished (not editing) block. */
export async function rendered(page: Page, word: string): Promise<WordStyle> {
  await expect(textEditor(page)).toHaveCount(0);
  const s = await styleIn(page, FINISHED, word);
  expect(s, `"${word}" is shown in a finished block`).not.toBeNull();
  return s!;
}

/** Computed weight of `word` in the finished (not editing) block. */
export async function renderedWeight(page: Page, word: string): Promise<number> {
  return (await rendered(page, word)).weight;
}

/** Computed style of `word` in the live editor. */
export async function editing(page: Page, word: string): Promise<WordStyle> {
  const s = await styleIn(page, EDITOR, word);
  expect(s, `"${word}" is shown in the editor`).not.toBeNull();
  return s!;
}

/** The finished block that shows `word`. */
export function finishedBlock(page: Page, word: string): Locator {
  return page.locator(FINISHED).filter({ hasText: word }).first();
}

const squash = (s: string) => s.replace(/​/g, '').replace(/\s+/g, ' ').trim();

/** The visible text of the finished block showing `word`, whitespace collapsed. */
export async function finishedText(page: Page, word: string): Promise<string> {
  await expect(textEditor(page)).toHaveCount(0);
  return squash(await finishedBlock(page, word).innerText());
}

/** The visible text of the live editor, whitespace collapsed. */
export async function editorText(page: Page): Promise<string> {
  return squash(await textEditor(page).innerText());
}

/** The stored markdown of the block with `id` (or of the only/last text block). */
export async function storedText(page: Page, id?: string): Promise<string> {
  return page.evaluate((nodeId) => {
    const nodes = (window as any).__POWERNOTE_STORES__.canvas.getState().nodes as any[];
    const texts = nodes.filter((n) => n.type === 'text');
    const node = nodeId ? texts.find((n) => n.id === nodeId) : texts[texts.length - 1];
    return node?.data?.text ?? '';
  }, id);
}

/** The stored data of the block with `id` (or the last text block). */
export async function storedData(page: Page, id?: string): Promise<Record<string, any>> {
  return page.evaluate((nodeId) => {
    const nodes = (window as any).__POWERNOTE_STORES__.canvas.getState().nodes as any[];
    const texts = nodes.filter((n) => n.type === 'text');
    const node = nodeId ? texts.find((n) => n.id === nodeId) : texts[texts.length - 1];
    return node?.data ?? {};
  }, id);
}

/** Leave editing by clicking empty canvas (the block stays selected). */
export async function clickAway(page: Page) {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 60, box.y + box.height - 60);
  await expect(textEditor(page)).toHaveCount(0);
}

/** Single-click a block's word: selects the block without editing it. */
export async function selectBlock(page: Page, word: string, additive = false) {
  await expect(textEditor(page)).toHaveCount(0);
  await page.waitForTimeout(200);
  const p = await wordCenter(page, FINISHED, word);
  if (additive) await page.keyboard.down('Control');
  await page.mouse.click(p.x, p.y);
  if (additive) await page.keyboard.up('Control');
  await expect(page.getByTestId('selection-actions')).toBeVisible();
  await expect(textEditor(page)).toHaveCount(0);
}

/**
 * Double-click a block's word to edit it. A block that just grew takes a
 * moment to resize its click area (60 ms on v0.88), so this waits a beat
 * first, the way a person would not double-click within a frame of leaving.
 */
export async function editBlock(page: Page, word: string) {
  await expect(textEditor(page)).toHaveCount(0);
  await page.waitForTimeout(200);
  const p = await wordCenter(page, FINISHED, word);
  await page.mouse.dblclick(p.x, p.y);
  await expect(textEditor(page)).toBeFocused();
}

/** The text of the document selection (what the user sees highlighted). */
export async function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString() ?? '');
}

/** Paste through a real paste event on the editor carrying the given flavours. */
export async function paste(page: Page, data: { html?: string; text: string }) {
  await page.evaluate(({ html, text }) => {
    const dt = new DataTransfer();
    if (html) dt.setData('text/html', html);
    dt.setData('text/plain', text);
    const target = document.activeElement && (document.activeElement as HTMLElement).closest('[data-testid="text-editor"]')
      ? document.activeElement
      : document.querySelector('[data-testid="text-editor"]')!;
    target!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
}
