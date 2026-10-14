/**
 * Test 207: Settings as a full overlay with a scrolling page and a side index
 * Covers: REQ-SETTINGS-021, REQ-SETTINGS-022, REQ-SETTINGS-023
 *
 * Owner request 2026-10-14: "a full view overlay, not covering the entirety of
 * the screen, but maybe 80% ... a cross at the top right to close it", laid out
 * like VS Code settings — one continuously scrolling page, not tabs.
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

test.describe('207 - Settings overlay (REQ-SETTINGS-021..023)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 880 });
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('opens at 80% of the window, centred, over a backdrop', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    const panel = page.getByTestId('settings-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('settings-overlay')).toBeVisible();

    const box = (await panel.boundingBox())!;
    expect(Math.round(box.width)).toBe(1120);
    expect(Math.round(box.height)).toBe(704);
    expect(Math.round(box.x)).toBe(140);
    expect(Math.round(box.y)).toBe(88);

    // The close cross sits in the top-right corner of the overlay.
    const close = (await page.getByTestId('settings-close').boundingBox())!;
    expect(close.x + close.width).toBeGreaterThan(box.x + box.width - 32);
    expect(close.y).toBeLessThan(box.y + 32);
  });

  test('closes by the cross, by Escape and by the backdrop; focus returns to the gear', async ({ page }) => {
    const gear = page.getByTestId('nav-settings');
    const panel = page.getByTestId('settings-panel');

    await gear.click();
    await expect(page.getByTestId('settings-close')).toBeFocused();
    await page.getByTestId('settings-close').click();
    await expect(panel).toBeHidden();
    await expect(gear).toBeFocused();

    // Escape closes the overlay and does not reach the canvas: a selected node stays selected.
    await page.evaluate(() => {
      const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
      canvas.addNode({
        id: 'keep-selected', type: 'text', x: 200, y: 200, width: 200, height: 40, layer: 3,
        data: { text: 'hello', fontSize: 16, fontFamily: 'Inter, system-ui, sans-serif', fontStyle: 'normal', fill: '#1a1a1a' },
      });
      canvas.selectNode('keep-selected', false);
    });
    await gear.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    const selected = await page.evaluate(
      () => (window as any).__POWERNOTE_STORES__.canvas.getState().selectedNodeIds,
    );
    expect(selected).toContain('keep-selected');

    // A press on the backdrop (outside the dialog) closes.
    await gear.click();
    await expect(panel).toBeVisible();
    await page.mouse.click(60, 440);
    await expect(panel).toBeHidden();

    // A press inside the dialog does not.
    await gear.click();
    await page.getByTestId('settings-panel').click({ position: { x: 600, y: 20 } });
    await expect(panel).toBeVisible();
  });

  test('Tab stays inside the overlay', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    for (let i = 0; i < 60; i++) await page.keyboard.press('Tab');
    const inside = await page.evaluate(() =>
      !!document.activeElement?.closest('[data-testid="settings-panel"]'),
    );
    expect(inside).toBe(true);
  });

  test('one scrolling page: the index scrolls to a section and follows the scroll', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    const scroll = page.getByTestId('settings-scroll');

    // Every section is on the same page — no tabs hide any of them.
    for (const id of ['look', 'input', 'saving', 'bridge', 'extensions', 'about']) {
      await expect(page.locator(`[data-section="${id}"]`)).toHaveCount(1);
    }
    await expect(page.getByTestId('settings-index-look')).toHaveAttribute('aria-current', 'true');

    // Clicking an index entry brings its section to the top of the page.
    await page.getByTestId('settings-index-bridge').click();
    await expect(page.getByTestId('settings-index-bridge')).toHaveAttribute('aria-current', 'true');
    await expect
      .poll(async () => {
        const [paneTop, headTop] = await Promise.all([
          scroll.evaluate((el) => el.getBoundingClientRect().top),
          page.locator('[data-section="bridge"]').evaluate((el) => el.getBoundingClientRect().top),
        ]);
        return Math.abs(headTop - paneTop);
      })
      .toBeLessThan(40);

    // Scrolling by hand moves the marker: back to the top marks the first section…
    await scroll.evaluate((el) => el.scrollTo({ top: 0 }));
    await expect(page.getByTestId('settings-index-look')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('settings-index-bridge')).not.toHaveAttribute('aria-current', 'true');

    // …and to the bottom marks the last one.
    await scroll.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(page.getByTestId('settings-index-about')).toHaveAttribute('aria-current', 'true');
  });

  test('fills the window less a margin at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('nav-settings').click();
    const box = (await page.getByTestId('settings-panel').boundingBox())!;
    expect(Math.round(box.width)).toBe(390 - 16);
    expect(Math.round(box.height)).toBe(844 - 16);
  });
});
