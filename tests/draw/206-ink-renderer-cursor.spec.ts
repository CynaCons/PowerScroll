/**
 * Test 206: raw ink renderer and native pen cursor
 *
 * Covers: REQ-DRAW-025, REQ-DRAW-026, REQ-DRAW-027, REQ-DRAW-028.
 */
import { expect, test, type Page } from '@playwright/test';
import { disableFSA, waitForCanvasReady } from '../helpers';

async function pointerStroke(
  page: Page,
  pointerType: 'mouse' | 'pen',
  points: Array<[number, number]>,
  pressures: number[] = [],
) {
  await page.evaluate(({ pointerType, points, pressures }) => {
    const canvas = document.querySelector('[data-testid="canvas-container"] canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const event = (type: string, index: number, buttons: number) => new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: pointerType === 'pen' ? 2061 : 2060,
      pointerType, isPrimary: true, buttons, pressure: pressures[index] ?? 0.5,
      clientX: rect.left + points[index][0], clientY: rect.top + points[index][1],
    });
    canvas.dispatchEvent(event('pointerdown', 0, 1));
    for (let index = 1; index < points.length; index++) canvas.dispatchEvent(event('pointermove', index, 1));
    canvas.dispatchEvent(event('pointerup', points.length - 1, 0));
  }, { pointerType, points, pressures });
}

function cursorDetails(cursor: string) {
  const encoded = cursor.match(/data:image\/svg\+xml,([^\"]+)/)?.[1];
  const svg = encoded ? decodeURIComponent(encoded) : '';
  const hotspot = cursor.match(/\)\s+(\d+)\s+(\d+),\s*crosshair$/);
  return { cursor, svg, hotspot: hotspot?.slice(1).map(Number) };
}

test.describe('206 - Ink renderer and cursor', () => {
  test('retains raw mouse input, renders pen pressure, loads baked lines, and updates the native cursor at zoom', async ({ page }) => {
    await disableFSA(page);
    await page.goto('/');
    await waitForCanvasReady(page);
    await page.evaluate(() => {
      const tool = (window as any).__POWERNOTE_STORES__.tool.getState();
      tool.setTool('draw');
      tool.setDrawOptions({ color: '#b4552d', strokeWidth: 10, isErasing: false });
    });

    const initialCursor = cursorDetails(await page.locator('[data-testid="canvas-container"]').evaluate(
      (element) => (element as HTMLElement).style.cursor,
    ));
    expect(initialCursor.cursor).toContain('data:image/svg+xml,');
    expect(initialCursor.cursor).toContain('crosshair');
    expect(initialCursor.svg).toContain('r="5"');
    expect(initialCursor.hotspot?.[0]).toBe(initialCursor.hotspot?.[1]);

    await pointerStroke(page, 'mouse', [[200, 200], [240, 220], [280, 200]]);
    await pointerStroke(page, 'pen', [[200, 260], [240, 280], [280, 260]], [0.2, 0.6, 1]);

    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.draw.getState().addStroke({
        id: 'legacy-baked', points: [200, 320, 240, 340, 280, 320], pressures: [0.2, 0.6, 1],
        baked: true, color: '#b4552d', strokeWidth: 10,
      });
    });

    const result = await page.evaluate(() => {
      const strokes = (window as any).__POWERNOTE_STORES__.draw.getState().strokes;
      const stage = (window as any).Konva?.stages?.[0];
      const lines = Array.from(stage?.find('.stroke-group') ?? []).map((line: any) => ({
        points: line.points(), tension: line.tension(), closed: line.closed(), hasFill: Boolean(line.fill()),
      }));
      return { strokes, lines };
    });

    expect(result.strokes[0]).toMatchObject({ points: [200, 200, 240, 220, 280, 200] });
    expect(result.strokes[0].pressures).toBeUndefined();
    expect(result.strokes[0].baked).toBeUndefined();
    expect(result.strokes[1].pressures).toHaveLength(3);
    expect(result.strokes[1].pressures[0]).toBeCloseTo(0.2, 5);
    expect(result.strokes[1].pressures[1]).toBeCloseTo(0.6, 5);
    expect(result.strokes[1].pressures[2]).toBe(1);
    expect(result.strokes[1].baked).toBeUndefined();
    expect(result.lines[0]).toMatchObject({ points: result.strokes[0].points, tension: 0.3, closed: false, hasFill: false });
    expect(result.lines[1]).toMatchObject({ closed: true, hasFill: true });
    expect(result.lines[2]).toMatchObject({ points: result.strokes[2].points, tension: 0.3, closed: false, hasFill: false });

    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().setZoom(2));
    await expect.poll(async () => cursorDetails(await page.locator('[data-testid="canvas-container"]').evaluate(
      (element) => (element as HTMLElement).style.cursor,
    )).svg).toContain('r="10"');
  });
});
