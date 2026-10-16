/**
 * Test 21: Text intentional width (was auto-width)
 * Covers: REQ-TEXT-007, REQ-TEXT-020 — width is intentional (page default /
 * user-resized); height auto-sizes to content. Width must not shrink to content
 * after commit.
 */
import { test, expect } from '@playwright/test';
import { commitEditor, fillEditor, getCanvasStore, waitForCanvasReady, activateTool, clickCanvas } from '../helpers';

/** Matches src/utils/pageLayout.ts DEFAULT_TEXT_WIDTH / A4_WIDTH */
const DEFAULT_TEXT_WIDTH = 794;

test.describe('21 - Text Intentional Width (REQ-TEXT-007, REQ-TEXT-020)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('short text keeps page default width after commit', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page, 'Hi');
    await commitEditor(page);
    await page.waitForTimeout(200);

    const store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);
    // Must not shrink to content — stays page width
    expect(store.nodes[0].width).toBe(DEFAULT_TEXT_WIDTH);
  });

  test('long text keeps page default width and has positive height', async ({ page }) => {
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page,
      'This is a longer piece of text that should wrap within the page-wide block rather than growing the box to content',
    );
    await commitEditor(page);
    await page.waitForTimeout(200);

    const store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);
    expect(store.nodes[0].width).toBe(DEFAULT_TEXT_WIDTH);
    expect(store.nodes[0].height).toBeGreaterThan(0);
  });

  test('width can exceed the old 800px content cap after resize', async ({ page }) => {
    await page.evaluate(() => {
      const s = (window as any).__POWERNOTE_STORES__.canvas.getState();
      s.addNode({
        id: 'wide-text',
        type: 'text',
        x: 100,
        y: 100,
        width: 900,
        height: 30,
        data: {
          text: 'A'.repeat(80),
          fontSize: 16,
          fontFamily: 'sans-serif',
          fontStyle: 'normal',
          fill: '#1a1a1a',
        },
      });
    });
    await page.waitForTimeout(200);

    const store = await getCanvasStore(page);
    const node = store.nodes.find((n: any) => n.id === 'wide-text');
    // Intentional width must be preserved (no shrink/cap to ~800)
    expect(node.width).toBe(900);
  });
});
