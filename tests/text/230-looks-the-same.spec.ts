/**
 * Test 230: a block looks the same while editing as when finished, and
 * checklist rows are checkboxes in both states.
 * Covers: REQ-TEXT-054, REQ-TEXT-063
 *
 * Audit of v0.88.1: opening a block made it grow from 259 to 319 px, text
 * below a blank line jumped 38 px, `# ` shifted a heading 22 px, markers
 * (`**`, `<u>`, `- [ ]`) showed, and checklist rows showed a bullet and a box.
 *
 * Measured like a user would see it: the on-screen rectangles of words before
 * and after editing starts, the visible text of the editor, and the computed
 * list style of checklist rows.
 *
 * Contract assumed beyond the shared test ids: while editing, a checklist
 * row's box is an `input[type=checkbox]` or an element with role="checkbox"
 * inside the editor.
 */
import { expect, test, type Page } from '@playwright/test';
import { textEditor, waitForCanvasReady } from '../helpers';
import { addTextBlock, clickAway, editBlock, EDITOR, FINISHED, storedText, wordRect } from './text-user';

const RICH = [
  '# Trip plan',
  '',
  'This paragraph is long enough to wrap across more than one line inside the block, with **boldword**, *italicword* and <u>underword</u> words in it.',
  '',
  '- apples',
  '- pears',
  '',
  '1. alpha',
  '2. bravo',
  '',
  '- [ ] tickets',
  '- [x] passport',
  '',
  '> quoted line',
  '',
  'See [the site](https://example.com) at ending.',
].join('\n');

const WORDS = ['Trip', 'paragraph', 'wrap', 'boldword', 'italicword', 'underword', 'apples', 'pears',
  'alpha', 'bravo', 'tickets', 'passport', 'quoted', 'site', 'ending'];

/** Rects of all WORDS inside `root`. */
async function rects(page: Page, root: string) {
  const out: Record<string, { left: number; top: number }> = {};
  for (const w of WORDS) {
    const r = await wordRect(page, root, w);
    out[w] = { left: r.left, top: r.top };
  }
  return out;
}

/** Height of the finished block, or of the block being edited. */
async function blockHeight(page: Page, isEditing: boolean) {
  return page.evaluate(([editing, ed, fin]) => {
    const el = editing
      ? (() => { const e = document.querySelector(ed as string)!; return e.closest(fin as string) ?? e; })()
      : document.querySelector(fin as string)!;
    return el.getBoundingClientRect().height;
  }, [isEditing, EDITOR, FINISHED] as const);
}

/** For each checklist row under `root`: has a box, and shows no bullet/number. */
async function checklistRows(page: Page, root: string) {
  return page.evaluate((sel) => {
    const rootEl = document.querySelector(sel);
    if (!rootEl) return [];
    const boxes = rootEl.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
    return Array.from(boxes).map((box) => {
      const li = box.closest('li');
      if (!li) return { text: box.parentElement?.textContent?.trim() ?? '', bullet: false };
      const cs = getComputedStyle(li);
      const marker = getComputedStyle(li, '::marker');
      const bullet = cs.display === 'list-item' && cs.listStyleType !== 'none'
        && marker.content !== 'none' && marker.content !== '""';
      return { text: li.textContent!.trim(), bullet };
    });
  }, root);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
  await addTextBlock(page, 'rich', RICH, 'paragraph', { x: 300, y: 40, width: 420 });
});

test('opening a block for editing moves no word by more than 2 px and keeps its height', async ({ page }) => {
  const before = await rects(page, FINISHED);
  const heightBefore = await blockHeight(page, false);

  await editBlock(page, 'wrap');

  const moved = async () => {
    const after = await rects(page, EDITOR);
    const off: string[] = [];
    for (const w of WORDS) {
      const dx = Math.abs(after[w].left - before[w].left);
      const dy = Math.abs(after[w].top - before[w].top);
      if (dx > 2 || dy > 2) off.push(`${w} moved ${dx.toFixed(0)},${dy.toFixed(0)}`);
    }
    return off;
  };
  await expect.poll(moved, 'no word moves when editing starts').toEqual([]);
  await expect.poll(async () => Math.abs((await blockHeight(page, true)) - heightBefore), 'block height while editing')
    .toBeLessThanOrEqual(2);

  await clickAway(page);
  const after = await rects(page, FINISHED);
  for (const w of WORDS) {
    expect(Math.abs(after[w].top - before[w].top), `${w} back in place`).toBeLessThanOrEqual(2);
  }
});

test('the editor shows no markdown markers', async ({ page }) => {
  await editBlock(page, 'wrap');
  const text = await textEditor(page).innerText();
  for (const marker of ['# Trip', '**', '<u>', '[ ]', '[x]', '](', '> quoted', '1. alpha', '- apples']) {
    expect(text, `"${marker}" is not shown while editing`).not.toContain(marker);
  }
  for (const w of ['Trip plan', 'boldword', 'underword', 'tickets', 'quoted line', 'the site']) {
    expect(text).toContain(w);
  }
});

test('checklist rows show a checkbox and no bullet, finished and while editing', async ({ page }) => {
  const finished = await checklistRows(page, FINISHED);
  expect(finished.map((r) => r.text)).toEqual(['tickets', 'passport']);
  expect(finished.filter((r) => r.bullet), 'finished checklist rows have no bullet').toEqual([]);

  await editBlock(page, 'wrap');
  const live = await checklistRows(page, EDITOR);
  expect(live.map((r) => r.text), 'checklist rows have a box while editing').toEqual(['tickets', 'passport']);
  expect(live.filter((r) => r.bullet), 'checklist rows have no bullet while editing').toEqual([]);
});

test('clicking a checkbox in the finished block ticks and unticks it', async ({ page }) => {
  const box = page.locator(`${FINISHED} li`).filter({ hasText: 'tickets' }).locator('input[type="checkbox"]');
  await expect(box).not.toBeChecked();
  await box.click();
  await expect.poll(() => storedText(page, 'rich')).toMatch(/\[x\] tickets/);
  await expect(page.locator(`${FINISHED} li`).filter({ hasText: 'tickets' }).locator('input[type="checkbox"]')).toBeChecked();
  await page.locator(`${FINISHED} li`).filter({ hasText: 'tickets' }).locator('input[type="checkbox"]').click();
  await expect.poll(() => storedText(page, 'rich')).toMatch(/\[ \] tickets/);
});

test('clicking a checkbox while editing ticks it, and it stays ticked after leaving', async ({ page }) => {
  await editBlock(page, 'wrap');
  const box = page.locator(`${EDITOR} li`).filter({ hasText: 'tickets' })
    .locator('input[type="checkbox"], [role="checkbox"]').first();
  await expect(box, 'the checklist row has a box while editing').toBeVisible();
  await box.click();
  await expect(textEditor(page), 'ticking does not close the editor').toHaveCount(1);
  await clickAway(page);
  await expect.poll(() => storedText(page, 'rich')).toMatch(/\[x\] tickets/);
  await expect(page.locator(`${FINISHED} li`).filter({ hasText: 'tickets' }).locator('input[type="checkbox"]')).toBeChecked();
});
