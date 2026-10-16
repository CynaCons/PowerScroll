/**
 * Test 134: Undo button in the top bar
 * Covers: REQ-CANVAS-010, REQ-CANVAS-011
 *
 * Undo has always existed on Ctrl+Z; this is the visible control for it.
 *
 * The assertion that matters is the enabled state. The undo stacks are
 * module-level rather than store state — deliberately, since they hold node
 * snapshots that must never reach the saved file — which means React cannot see
 * them change. A button that never re-evaluates would sit permanently disabled
 * (or permanently enabled), and both look like a working button until you try.
 */
import { test, expect } from '@playwright/test';
import { commitEditor, fillEditor, getCanvasStore, waitForCanvasReady, activateTool, clickCanvas } from '../helpers';

/**
 * Places one committed text node, which is one undoable action.
 *
 * `y` is a parameter because clicking where a block already sits SELECTS it
 * instead of placing a new one, so two calls at the same point are one action.
 */
async function addBlock(page: import('@playwright/test').Page, text: string, y = 300) {
  await activateTool(page, 'text');
  await clickCanvas(page, 400, y);
  await fillEditor(page, text);
  await commitEditor(page);
}

test.describe('134 - Undo button (REQ-CANVAS-010)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('starts disabled on an untouched notebook', async ({ page }) => {
    await expect(page.getByTestId('undo-btn')).toBeDisabled();
    await expect(page.getByTestId('undo-btn')).toHaveAttribute('title', 'Nothing to undo');
  });

  test('enables itself once there is something to undo, and undoes it', async ({ page }) => {
    await addBlock(page, 'first block');

    // Enabling is the part that needs a live subscription — the stacks are
    // invisible to React, so this fails if the state is only read once.
    await expect(page.getByTestId('undo-btn')).toBeEnabled();
    expect((await getCanvasStore(page)).nodes).toHaveLength(1);

    await page.getByTestId('undo-btn').click();
    expect((await getCanvasStore(page)).nodes).toHaveLength(0);
  });

  test('disables again when the history runs out', async ({ page }) => {
    await addBlock(page, 'only block');
    await page.getByTestId('undo-btn').click();
    await expect(page.getByTestId('undo-btn')).toBeDisabled();
  });

  test('the button and Ctrl+Z unwind the same history', async ({ page }) => {
    await addBlock(page, 'one', 250);
    await addBlock(page, 'two', 420);
    expect((await getCanvasStore(page)).nodes).toHaveLength(2);

    await page.getByTestId('undo-btn').click();
    expect((await getCanvasStore(page)).nodes).toHaveLength(1);

    // Both routes go through undoOps, so a divergence between them would mean
    // two copies of the tool-routing rule had drifted apart.
    await page.keyboard.press('Control+z');
    expect((await getCanvasStore(page)).nodes).toHaveLength(0);
  });

  test('it sits to the left of zoom-to-fit', async ({ page }) => {
    const undo = await page.getByTestId('undo-btn').boundingBox();
    const fit = await page.getByTestId('zoom-fit-btn').boundingBox();
    expect(undo).not.toBeNull();
    expect(fit).not.toBeNull();
    expect(undo!.x).toBeLessThan(fit!.x);
  });
});
