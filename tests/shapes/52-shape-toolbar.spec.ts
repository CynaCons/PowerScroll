/**
 * Test 52: Shape Toolbar
 * Covers: REQ-SHAPE-004, REQ-SHAPE-005, REQ-SHAPE-006, REQ-SHAPE-007,
 *         REQ-SHAPE-012
 *
 * Verifies that the ShapeToolbar appears when the shape tool is active,
 * contains shape type selectors and styling controls, and that shape options
 * propagate correctly through the tool store.
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

test.describe('52 - Shape Toolbar (REQ-SHAPE-004..007, 012)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('shape toolbar appears when shape tool is activated (REQ-SHAPE-012)', async ({ page }) => {
    // Toolbar should not be visible initially (select tool active)
    await expect(page.locator('[data-testid="shape-toolbar"]')).not.toBeVisible();

    // Activate shape tool via NavRail
    await page.click('[data-testid="nav-shape-tool"]');
    await page.waitForTimeout(200);

    // Shape toolbar should now be visible
    await expect(page.locator('[data-testid="shape-toolbar"]')).toBeVisible();
  });

  test('shape toolbar has all six shape type buttons (REQ-SHAPE-012)', async ({ page }) => {
    await page.click('[data-testid="nav-shape-tool"]');
    await page.waitForTimeout(200);

    for (const type of ['rect', 'circle', 'triangle', 'diamond', 'arrow', 'line']) {
      await expect(page.locator(`[data-testid="shape-type-${type}"]`)).toBeVisible();
    }
  });

  test('shape toolbar has fill toggle control (REQ-SHAPE-004)', async ({ page }) => {
    await page.click('[data-testid="nav-shape-tool"]');
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid="shape-fill-toggle"]')).toBeVisible();
  });

  test('clicking shape type button updates tool store (REQ-SHAPE-012)', async ({ page }) => {
    await page.click('[data-testid="nav-shape-tool"]');
    await page.waitForTimeout(200);

    // Click circle shape type
    await page.click('[data-testid="shape-type-circle"]');
    await page.waitForTimeout(100);

    const toolState = await page.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      return stores.tool.getState().shapeOptions;
    });

    expect(toolState.shapeType).toBe('circle');
  });

  test('shape options default values are correct', async ({ page }) => {
    const shapeOptions = await page.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      return stores.tool.getState().shapeOptions;
    });

    expect(shapeOptions.shapeType).toBe('rect');
    expect(shapeOptions.fill).toBe('transparent');
    expect(shapeOptions.stroke).toBe('#1a1a1a');
    expect(shapeOptions.strokeWidth).toBe(2);
    expect(shapeOptions.strokeDash).toEqual([]);
  });

  test('shape toolbar appears when a shape node is selected (REQ-SHAPE-012)', async ({ page }) => {
    // Add a shape node
    await page.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.canvas.getState().addNode({
        id: 'toolbar-shape-1',
        type: 'shape',
        x: 300,
        y: 300,
        width: 120,
        height: 80,
        layer: 3,
        data: {
          shapeType: 'rect',
          fill: 'transparent',
          stroke: '#1a1a1a',
          strokeWidth: 2,
          strokeDash: [],
        },
      });
    });

    // Toolbar should not be visible yet (select tool, nothing selected)
    await expect(page.locator('[data-testid="shape-toolbar"]')).not.toBeVisible();

    // Select the shape node
    await page.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.canvas.getState().selectNode('toolbar-shape-1', false);
    });
    await page.waitForTimeout(200);

    // Shape toolbar should now be visible
    await expect(page.locator('[data-testid="shape-toolbar"]')).toBeVisible();
  });

  test('toggling shape tool off keeps toolbar visible (persistence)', async ({ page }) => {
    // Activate shape tool
    await page.click('[data-testid="nav-shape-tool"]');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid="shape-toolbar"]')).toBeVisible();

    // Click shape tool again to toggle off (back to select)
    await page.click('[data-testid="nav-shape-tool"]');
    await page.waitForTimeout(200);

    // Toolbar persists in select mode (shows last creation tool's toolbar)
    await expect(page.locator('[data-testid="shape-toolbar"]')).toBeVisible();
  });

  test('shape type buttons cycle through all types correctly', async ({ page }) => {
    await page.click('[data-testid="nav-shape-tool"]');
    await page.waitForTimeout(200);

    const types = ['rect', 'circle', 'triangle', 'diamond', 'arrow', 'line'];

    for (const type of types) {
      await page.click(`[data-testid="shape-type-${type}"]`);
      await page.waitForTimeout(100);

      const shapeType = await page.evaluate(() => {
        const stores = (window as any).__POWERNOTE_STORES__;
        return stores.tool.getState().shapeOptions.shapeType;
      });

      expect(shapeType).toBe(type);
    }
  });
});
