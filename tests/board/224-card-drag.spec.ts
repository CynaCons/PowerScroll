/**
 * Test 224: a dragged card follows the pointer and lands with a glide.
 * Covers: REQ-BOARD-034, REQ-BOARD-039
 *
 * Owner request 2026-10-20: "when I click on the card and I move and I drag it
 * across, there is no preview of the card. The card is not moving around, there
 * is just like a preview of the slot where it will land."
 */
import { expect, test, type Page } from '@playwright/test';
import { runBridge, stubBridgeUrl, waitForBridgeReady, waitForCanvasReady } from '../helpers';

async function openBoard(page: Page) {
  await stubBridgeUrl(page);
  await page.goto('/');
  await waitForCanvasReady(page);
  await waitForBridgeReady(page);
  await page.getByTestId('nav-hierarchy').click();
  await page.getByTestId('add-board-btn').click();
  await expect(page.getByTestId('board-view')).toBeVisible();
  await page.getByTestId('nav-hierarchy').click();
  const boardId = await page.evaluate(
    () => (window as any).__POWERNOTE_STORES__.workspace.getState().activePageId as string,
  );
  await runBridge(page, 'card_create', { boardId, title: 'Drag me', checklist: ['one', 'two', 'three'], actor: 'planner' });
  await runBridge(page, 'card_create', { boardId, title: 'Stay', actor: 'planner' });
  return boardId;
}

function columnOf(page: Page, boardId: string, number: number) {
  return page.evaluate(({ id, n }) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const board = ws.workspace.sections.flatMap((s: any) => s.pages).find((p: any) => p.id === id).board;
    return board.cards.find((card: any) => card.number === n).column as string;
  }, { id: boardId, n: number });
}

test('the card follows the pointer, the slot has its height, and it lands in the new column', async ({ page }) => {
  const boardId = await openBoard(page);
  const card = page.getByTestId('board-card-1');
  const box = (await card.boundingBox())!;
  const doing = (await page.getByTestId('board-column-doing').boundingBox())!;

  await page.mouse.move(box.x + 20, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 40, { steps: 4 });

  // A copy of the card is under the pointer, at the same grab offset.
  const ghost = page.getByTestId('board-drag-ghost');
  await expect(ghost).toBeVisible();
  await expect(ghost).toContainText('Drag me');
  let ghostBox = (await ghost.boundingBox())!;
  expect(Math.abs(ghostBox.x + 20 - (box.x + 60))).toBeLessThan(12);

  await page.mouse.move(doing.x + 40, doing.y + 80, { steps: 8 });
  ghostBox = (await ghost.boundingBox())!;
  expect(Math.abs(ghostBox.x + 20 - (doing.x + 40))).toBeLessThan(12);

  // The landing slot sits in the target column and is as tall as the card.
  const slot = page.getByTestId('board-column-doing').getByTestId('board-drop-slot');
  await expect(slot).toBeVisible();
  const slotBox = (await slot.boundingBox())!;
  expect(Math.abs(slotBox.height - box.height)).toBeLessThan(2);
  // The card itself is lifted out of the To do column.
  await expect(card).toBeHidden();

  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  await expect(page.getByTestId('board-column-doing')).toContainText('Drag me');
  expect(await columnOf(page, boardId, 1)).toBe('doing');
  // Releasing a drag does not open the card.
  await expect(page.getByTestId('board-card-overlay')).toHaveCount(0);
});

test('Escape during a drag puts the card back and does not open it', async ({ page }) => {
  const boardId = await openBoard(page);
  const box = (await page.getByTestId('board-card-1').boundingBox())!;
  const doing = (await page.getByTestId('board-column-doing').boundingBox())!;

  await page.mouse.move(box.x + 20, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(doing.x + 40, doing.y + 80, { steps: 8 });
  await expect(page.getByTestId('board-drag-ghost')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('board-drag-ghost')).toHaveCount(0);
  await page.mouse.up();

  await expect(page.getByTestId('board-card-1')).toBeVisible();
  expect(await columnOf(page, boardId, 1)).toBe('todo');
  await expect(page.getByTestId('board-card-overlay')).toHaveCount(0);
});

test('a plain click still opens the card', async ({ page }) => {
  await openBoard(page);
  await page.getByTestId('board-card-2').click();
  await expect(page.getByTestId('board-card-overlay')).toBeVisible();
  await expect(page.getByTestId('board-drag-ghost')).toHaveCount(0);
});

test('a card dropped between two cards lands exactly at the slot', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'Third', actor: 'planner' });
  // To do: #1 Drag me, #2 Stay, #3 Third. Drag #3 above #2.
  const stay = (await page.getByTestId('board-card-2').boundingBox())!;
  const third = (await page.getByTestId('board-card-3').boundingBox())!;
  await page.mouse.move(third.x + 20, third.y + 15);
  await page.mouse.down();
  await page.mouse.move(stay.x + 20, stay.y + 4, { steps: 8 });
  await page.mouse.up();

  const order = await page.evaluate((id) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const board = ws.workspace.sections.flatMap((s: any) => s.pages).find((p: any) => p.id === id).board;
    return board.cards.filter((card: any) => card.column === 'todo')
      .sort((a: any, b: any) => a.order - b.order).map((card: any) => card.number);
  }, boardId);
  expect(order).toEqual([1, 3, 2]);
  await expect(page.getByTestId('board-column-todo').locator('.board-card__title')).toHaveText(['Drag me', 'Third', 'Stay']);
});
