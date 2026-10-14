/**
 * Test 190: restored raw-point ink renderer
 *
 * Covers: REQ-DRAW-025.
 */
import { expect, test } from '@playwright/test';
import { buildInkOutline } from '../../src/utils/inkOutline';
import { disableFSA, waitForCanvasReady } from '../helpers';

test.describe('190 - Raw-point ink renderer (REQ-DRAW-025)', () => {
  test('the pen ribbon follows recorded samples without mutating them', () => {
    const points = [0, 0, 25, 0, 50, 0, 75, 0, 100, 0];
    const pressures = [0.1, 0.3, 0.5, 0.75, 1];
    const originalPoints = [...points];
    const originalPressures = [...pressures];

    const outline = buildInkOutline(points, pressures, 10);

    expect(outline).not.toBeNull();
    expect(outline!.length).toBe(points.length * 2);
    expect(points).toEqual(originalPoints);
    expect(pressures).toEqual(originalPressures);
  });

  test('a pressure-less stroke is a round, tensioned Konva Line', async ({ page }) => {
    await disableFSA(page);
    await page.goto('/');
    await waitForCanvasReady(page);
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.draw.getState().addStroke({
        id: 'mouse-line', points: [100, 100, 150, 120, 200, 100], color: '#123456', strokeWidth: 6,
      });
    });

    const rendered = await page.evaluate(() => {
      const stage = (window as any).Konva?.stages?.[0];
      const line = stage?.findOne('.stroke-group');
      return line && {
        kind: line.getClassName(), points: line.points(), tension: line.tension(),
        lineCap: line.lineCap(), lineJoin: line.lineJoin(), closed: line.closed(),
      };
    });

    expect(rendered).toEqual({
      kind: 'Line', points: [100, 100, 150, 120, 200, 100], tension: 0.3,
      lineCap: 'round', lineJoin: 'round', closed: false,
    });
  });
});
