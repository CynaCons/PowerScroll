/**
 * Test 238: swim lanes by label.
 * Covers: REQ-BOARD-043, REQ-BOARD-044, REQ-BOARD-045
 *
 * Owner request 2026-10-23: "I probably need swim lanes ... by feature tag ...
 * that we can assign to tickets. We probably need swim lanes per category."
 * Owner's choices: a card with several labels shows in each of its lanes;
 * lanes are always on.
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
  return page.evaluate(() => (window as any).__POWERNOTE_STORES__.workspace.getState().activePageId as string);
}

const create = (page: Page, boardId: string, title: string, labels: string[], column = 'todo') =>
  runBridge(page, 'card_create', { boardId, title, labels, column, actor: 'planner' });

function cardOf(page: Page, boardId: string, number: number) {
  return page.evaluate(({ id, n }) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const board = ws.workspace.sections.flatMap((s: any) => s.pages).find((p: any) => p.id === id).board;
    const card = board.cards.find((item: any) => item.number === n);
    return { column: card.column as string, labels: card.labels as string[] };
  }, { id: boardId, n: number });
}

const lane = (page: Page, column: string, key: string) =>
  page.getByTestId(`board-column-${column}`).locator(`[data-board-lane="${key}"]`);

test('a board without labels has no lanes', async ({ page }) => {
  const boardId = await openBoard(page);
  await create(page, boardId, 'Plain', []);
  await expect(page.getByTestId('board-lane-title')).toHaveCount(0);
  await expect(page.getByTestId('board-column-todo')).toContainText('Plain');
});

test('cards sit in one lane per label, in first-used order, rows aligned across columns', async ({ page }) => {
  const boardId = await openBoard(page);
  await create(page, boardId, 'Parser', ['engine']);
  await create(page, boardId, 'Screens', ['ui'], 'doing');
  await create(page, boardId, 'Shared model', ['engine', 'ui']);
  await create(page, boardId, 'Loose', []);

  await expect(page.getByTestId('board-lane-title')).toHaveText([/engine/, /ui/, /No label/]);
  await expect(lane(page, 'todo', 'engine').locator('.board-card__title')).toHaveText(['Parser', 'Shared model']);
  await expect(lane(page, 'todo', 'ui').locator('.board-card__title')).toHaveText(['Shared model']);
  await expect(lane(page, 'doing', 'ui').locator('.board-card__title')).toHaveText(['Screens']);
  await expect(lane(page, 'todo', '__none__').locator('.board-card__title')).toHaveText(['Loose']);

  // The column header counts each card once.
  await expect(page.getByTestId('board-column-todo').locator('.board-column__count')).toHaveText('3');

  // A lane's row lines up across the four columns.
  const todoUi = (await lane(page, 'todo', 'ui').boundingBox())!;
  const doneUi = (await lane(page, 'done', 'ui').boundingBox())!;
  expect(Math.abs(todoUi.y - doneUi.y)).toBeLessThan(2);
  expect(Math.abs(todoUi.height - doneUi.height)).toBeLessThan(2);

  // Collapsing a lane hides its cards in every column and keeps its count.
  await page.getByRole('button', { name: 'Collapse engine lane' }).click();
  await expect(lane(page, 'todo', 'engine').locator('.board-card__title')).toHaveCount(0);
  await expect(page.getByTestId('board-lane-title').first()).toContainText('2');
  await expect(lane(page, 'todo', 'ui').locator('.board-card__title')).toHaveText(['Shared model']);
  await page.getByRole('button', { name: 'Expand engine lane' }).click();
  await expect(lane(page, 'todo', 'engine').locator('.board-card__title')).toHaveCount(2);

  // With a label filter on, only the chosen labels' lanes show.
  await page.getByTestId('board-label-filter').click();
  await page.getByRole('option', { name: /^ui/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('board-lane-title')).toHaveText([/ui/]);
});

test('dragging a card into another lane swaps that lane\'s label', async ({ page }) => {
  const boardId = await openBoard(page);
  await create(page, boardId, 'Parser', ['engine', 'urgent']);
  await create(page, boardId, 'Screens', ['ui'], 'doing');

  const card = lane(page, 'todo', 'engine').getByTestId('board-card-1');
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 40, { steps: 4 });
  // Measured once the drag has started: the card has left its lanes by then.
  const target = (await lane(page, 'doing', 'ui').boundingBox())!;
  await page.mouse.move(target.x + 40, target.y + target.height - 6, { steps: 10 });
  await expect(lane(page, 'doing', 'ui').getByTestId('board-drop-slot')).toBeVisible();
  await page.mouse.up();

  await expect.poll(() => cardOf(page, boardId, 1)).toEqual({ column: 'doing', labels: ['urgent', 'ui'] });
  await expect(lane(page, 'doing', 'ui').locator('.board-card__title')).toHaveText(['Screens', 'Parser']);
  await expect(page.locator('[data-board-lane="engine"]')).toHaveCount(0);
});
