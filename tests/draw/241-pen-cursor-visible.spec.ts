/**
 * Test 241: the pen shows a crosshair cursor, wherever the pointer has been.
 * Covers: REQ-DRAW-028, REQ-DRAW-029
 *
 * Owner report 2026-10-29: "when I'm in pen mode ... I just have the normal
 * pointer and I don't really know that I'm in writing mode". Hovering a block
 * left `cursor: default` inline on the stage's div, which hid the pen cursor;
 * the default 3px pen also drew only an 8px dot. Read from the element under
 * the pointer, as the browser does.
 */
import { expect, test } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

async function cursorUnderPointer(page: import('@playwright/test').Page, x: number, y: number) {
  await page.mouse.move(x, y);
  return page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, [x, y]);
}

test('the pen cursor is a crosshair under the pointer, also after hovering a block', async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
  await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().addNode({
    id: 'hover-me', type: 'text', x: 100, y: 100, width: 300, height: 40,
    data: { text: 'hover me', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#14181A' },
  }));
  const box = (await page.locator('[data-testid="canvas-container"]').boundingBox())!;
  // Select tool: hover the block and leave it, as a user does before picking the pen.
  expect(await cursorUnderPointer(page, box.x + 200, box.y + 115)).toBe('pointer');
  await cursorUnderPointer(page, box.x + 700, box.y + 500);

  await page.evaluate(() => (window as any).__POWERNOTE_STORES__.tool.getState().setTool('draw'));
  for (const [x, y, where] of [[700, 500, 'empty canvas'], [200, 115, 'over a block']] as const) {
    const cursor = await cursorUnderPointer(page, box.x + x, box.y + y);
    expect(cursor, `pen cursor on ${where}`).toContain('data:image/svg+xml');
    const svg = decodeURIComponent(cursor.match(/data:image\/svg\+xml,([^")]+)/)![1]);
    expect(svg, 'crosshair arms').toMatch(/<path d="M/);
    expect(Number(svg.match(/width="(\d+)"/)![1]), 'big enough to see').toBeGreaterThanOrEqual(24);
  }

  await page.evaluate(() => (window as any).__POWERNOTE_STORES__.tool.getState().setTool('select'));
  expect(await cursorUnderPointer(page, box.x + 700, box.y + 500), 'select tool gets its own cursor back').not.toContain('svg');
});
