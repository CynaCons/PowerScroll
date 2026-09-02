/**
 * Test 188: Numbered list indentation
 * Covers: REQ-TEXT-033 — Tab/Shift+Tab nests numbered items as a child <ol>
 *         REQ-TEXT-034 — nested ordered-list markers cycle decimal / alpha / roman
 *
 * CommonMark will not nest `1. A\n  2. B` (2 spaces). The editor must indent a
 * numbered child to the parent content column (4 spaces for `1.`–`99.`) and
 * restart numbering at 1; the renderer must still nest legacy 2-space notes.
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady, activateTool, clickCanvas } from '../helpers';
import { applyListIndent, normalizeListIndents } from '../../src/utils/listIndent';
import { markdownToHtml } from '../../src/utils/renderMarkdown';

async function placeMarkdownNode(
  page: import('@playwright/test').Page,
  id: string,
  text: string,
) {
  await page.evaluate(({ id, text }) => {
    const store = (window as any).__POWERNOTE_STORES__.canvas.getState();
    store.addNode({
      id,
      type: 'text',
      x: 200,
      y: 200,
      width: 420,
      height: 220,
      data: {
        text,
        fontSize: 16,
        fontFamily: 'Inter',
        fontStyle: 'normal',
        fill: '#1a1a1a',
      },
    });
  }, { id, text });
  await page.waitForTimeout(400);
}

async function openEditorAtEnd(page: import('@playwright/test').Page, seed: string) {
  await activateTool(page, 'text');
  await clickCanvas(page, 300, 200);
  const textarea = page.locator('textarea');
  await textarea.waitFor({ state: 'visible' });
  await textarea.fill(seed);
  await page.evaluate(() => {
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
  return textarea;
}

test.describe('188 - Numbered list indent helpers (REQ-TEXT-033)', () => {
  test('applyListIndent nests a numbered sibling under its parent', () => {
    const src = '1. Parent\n2. Child';
    const result = applyListIndent(src, src.length, src.length, 'in');
    expect(result.text).toBe('1. Parent\n    1. Child');
  });

  test('applyListIndent resequences the parent list after nesting', () => {
    const src = '1. A\n2. B\n3. C';
    const atB = src.indexOf('2.');
    const result = applyListIndent(src, atB, atB, 'in');
    expect(result.text).toBe('1. A\n    1. B\n2. C');
  });

  test('applyListIndent Shift+Tab un-nests and restores parent numbering', () => {
    const src = '1. A\n    1. B\n2. C';
    const atB = src.indexOf('1. B');
    const result = applyListIndent(src, atB, atB, 'out');
    expect(result.text).toBe('1. A\n2. B\n3. C');
  });

  test('applyListIndent still adds 2 spaces to a bullet child', () => {
    const src = '- parent\n- child';
    const result = applyListIndent(src, src.length, src.length, 'in');
    expect(result.text).toBe('- parent\n  - child');
  });

  test('applyListIndent nests a bullet under a numbered parent (4 spaces)', () => {
    const src = '1. Parent\n- child';
    const result = applyListIndent(src, src.length, src.length, 'in');
    expect(result.text).toBe('1. Parent\n    - child');
  });

  test('applyListIndent nests two selected numbered items as one child list', () => {
    const src = '1. A\n2. B\n3. C\n4. D';
    const from = src.indexOf('2.');
    const to = src.indexOf('C') + 1;
    const result = applyListIndent(src, from, to, 'in');
    expect(result.text).toBe('1. A\n    1. B\n    2. C\n2. D');
  });

  test('normalizeListIndents pads a 2-space numbered child so marked nests it', () => {
    const padded = normalizeListIndents('1. First\n  2. Nested');
    expect(padded.startsWith('1. First\n')).toBe(true);
    expect(padded.split('\n')[1].match(/^ +/)?.[0].length).toBeGreaterThanOrEqual(3);
    const html = markdownToHtml('1. First\n  2. Nested');
    expect(html).toMatch(/<ol>\s*<li>First\s*<ol/i);
  });

  test('normalizeListIndents does not touch fenced code', () => {
    const src = '```\n1. A\n  2. B\n```';
    expect(normalizeListIndents(src)).toBe(src);
  });
});

test.describe('188 - Numbered list indent in the editor (REQ-TEXT-033, REQ-TEXT-034)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('Tab in the editor nests a numbered item', async ({ page }) => {
    const textarea = await openEditorAtEnd(page, '1. Parent\n2. Child');
    await textarea.press('Tab');
    expect(await textarea.inputValue()).toBe('1. Parent\n    1. Child');
  });

  test('Shift+Tab in the editor un-nests a numbered item', async ({ page }) => {
    const textarea = await openEditorAtEnd(page, '1. Parent\n    1. Child');
    await textarea.press('Shift+Tab');
    expect(await textarea.inputValue()).toBe('1. Parent\n2. Child');
  });

  test('committed nested numbered list renders as a child ol (REQ-TEXT-033)', async ({ page }) => {
    await placeMarkdownNode(page, 'nested-ol', '1. Parent\n    1. Nested A\n    2. Nested B\n2. Next');

    const md = page.locator('.powernote-markdown').first();
    await expect(md).toBeVisible();
    await expect(md.locator('ol')).toHaveCount(2);
    await expect(md.locator('ol ol li')).toHaveCount(2);
    await expect(md.locator(':scope > ol > li')).toHaveCount(2);
  });

  test('2-space numbered child still renders nested (legacy notes)', async ({ page }) => {
    await placeMarkdownNode(page, 'legacy-ol', '1. Parent\n  1. Nested');

    const md = page.locator('.powernote-markdown').first();
    await expect(md).toBeVisible();
    await expect(md.locator('ol ol li')).toHaveCount(1);
  });

  test('nested ordered lists cycle decimal / lower-alpha / lower-roman (REQ-TEXT-034)', async ({ page }) => {
    const src = [
      '1. One',
      '    1. Two',
      '        1. Three',
    ].join('\n');
    await placeMarkdownNode(page, 'ol-styles', src);

    const md = page.locator('.powernote-markdown').first();
    await expect(md).toBeVisible();

    const styles = await md.evaluate((el) => {
      const outer = el.querySelector('ol');
      const mid = el.querySelector('ol ol');
      const inner = el.querySelector('ol ol ol');
      return {
        outer: outer ? getComputedStyle(outer).listStyleType : null,
        mid: mid ? getComputedStyle(mid).listStyleType : null,
        inner: inner ? getComputedStyle(inner).listStyleType : null,
      };
    });
    expect(styles.outer).toBe('decimal');
    expect(styles.mid).toBe('lower-alpha');
    expect(styles.inner).toBe('lower-roman');
  });
});
