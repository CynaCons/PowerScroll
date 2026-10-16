/**
 * Test 05: Text Drag
 * Covers: REQ-TEXT-006 — Drag a text block to reposition it on the canvas
 *
 * Verifies that after placing and committing a text block, dragging it
 * updates its position in the canvas store.
 */
import { test, expect } from '@playwright/test';
import { commitEditor, fillEditor, getCanvasStore, waitForCanvasReady, clickCanvas, activateTool } from '../helpers';

test.describe('05 - Text Drag (REQ-TEXT-006)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('dragging a text block updates its position in the store', async ({ page }) => {
    // Place and commit a text block
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page, 'Drag me');
    await commitEditor(page);

    await page.waitForTimeout(300);

    // Read position from store
    let store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);
    const initialX = store.nodes[0].x;
    const initialY = store.nodes[0].y;

    // Get the canvas bounding box to compute viewport coordinates
    const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // The node was placed at canvas-relative (400, 300), which is approximately
    // at viewport (box.x + 400, box.y + 300) when viewport offset is (0,0)
    const nodeScreenX = box!.x + 400;
    const nodeScreenY = box!.y + 300;

    // Drag the text block 100px right and 50px down
    await page.mouse.move(nodeScreenX, nodeScreenY);
    await page.mouse.down();
    await page.mouse.move(nodeScreenX + 100, nodeScreenY + 50, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(300);

    // Verify position changed
    store = await getCanvasStore(page);
    expect(store.nodes[0].x).not.toEqual(initialX);
    expect(store.nodes[0].y).not.toEqual(initialY);
  });
});
