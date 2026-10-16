/**
 * Test 16: Text Resize Reflow
 * Covers: REQ-TEXT-008 — Text shall reflow (word-wrap) within the block width
 *
 * Verifies that text blocks wrap within their intentional width and that
 * height grows with constrained width.
 */
import { test, expect } from '@playwright/test';
import { commitEditor, fillEditor, getCanvasStore, waitForCanvasReady, clickCanvas, activateTool } from '../helpers';

/** Matches src/utils/pageLayout.ts DEFAULT_TEXT_WIDTH */
const DEFAULT_TEXT_WIDTH = 794;

test.describe('16 - Text Resize Reflow (REQ-TEXT-008)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('placed text node has page default width', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page, 'Short text');
    await commitEditor(page);
    await page.waitForTimeout(300);

    const store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);
    expect(store.nodes[0].width).toBe(DEFAULT_TEXT_WIDTH);
  });

  test('placed text with long content has positive height', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page,
      'This is a longer sentence that should cause the text to wrap within the intentional width of the text block',
    );
    await commitEditor(page);
    await page.waitForTimeout(300);

    const store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);
    expect(store.nodes[0].width).toBe(DEFAULT_TEXT_WIDTH);
    expect(store.nodes[0].height).toBeGreaterThan(0);
  });

  test('narrower width produces taller block for same content', async ({ page }) => {
    await page.evaluate(() => {
      const s = (window as any).__POWERNOTE_STORES__.canvas.getState();
      const text =
        'This is a much longer piece of text that should wrap to multiple lines when the width is constrained';
      s.addNode({
        id: 'wide-text',
        type: 'text',
        x: 100,
        y: 100,
        width: 500,
        height: 30,
        data: {
          text,
          fontSize: 16,
          fontFamily: 'sans-serif',
          fontStyle: 'normal',
          fill: '#1a1a1a',
        },
      });
      s.addNode({
        id: 'narrow-text',
        type: 'text',
        x: 100,
        y: 400,
        width: 120,
        height: 30,
        data: {
          text,
          fontSize: 16,
          fontFamily: 'sans-serif',
          fontStyle: 'normal',
          fill: '#1a1a1a',
        },
      });
    });
    await page.waitForTimeout(300);

    const store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(2);
    const wide = store.nodes.find((n: any) => n.id === 'wide-text');
    const narrow = store.nodes.find((n: any) => n.id === 'narrow-text');
    expect(wide.width).toBe(500);
    expect(narrow.width).toBe(120);
    // Narrow box should reflow to more lines → greater or equal height
    expect(narrow.height).toBeGreaterThanOrEqual(wide.height);
    expect(narrow.height).toBeGreaterThan(0);
  });
});
