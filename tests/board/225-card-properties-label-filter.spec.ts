/**
 * Test 225: card properties menus and the board's label filter.
 * Covers: REQ-BOARD-035, REQ-BOARD-036, REQ-BOARD-037, REQ-BOARD-038
 *
 * Owner request 2026-10-20: "the menu to change the assignee, the status, needs
 * a visual improvement ... I need to be able to filter for the different labels
 * ... And it needs to be well integrated for UI and UX."
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
  const cards: Array<[string, string[]]> = [
    ['Login with passkeys', ['Feature']],
    ['Crash on empty notebook', ['Bug']],
    ['Paste loses list indent', ['Bug', 'Editor']],
    ['Tidy settings code', []],
  ];
  for (const [title, labels] of cards) {
    await runBridge(page, 'card_create', { boardId, title, labels, actor: 'planner' });
  }
  await runBridge(page, 'card_claim', { boardId, card: 2, actor: 'auth-agent' });
  return boardId;
}

function cardState(page: Page, boardId: string, number: number) {
  return page.evaluate(({ id, n }) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const board = ws.workspace.sections.flatMap((s: any) => s.pages).find((p: any) => p.id === id).board;
    const card = board.cards.find((item: any) => item.number === n);
    return {
      column: card.column as string,
      assignee: card.assignee as string | undefined,
      labels: card.labels as string[],
      events: board.events.filter((event: any) => event.cardId === card.id).map((event: any) => event.type) as string[],
    };
  }, { id: boardId, n: number });
}

test('status, assignee and labels are menus in the Details panel', async ({ page }) => {
  const boardId = await openBoard(page);
  await page.getByTestId('board-card-1').click();
  const overlay = page.getByTestId('board-card-overlay');
  const details = overlay.getByTestId('card-properties');
  await expect(details).toContainText('Status');
  await expect(details).toContainText('Assignee');
  await expect(details).toContainText('Labels');
  await expect(overlay.locator('select, datalist')).toHaveCount(0);

  // Status: the current column is ticked; arrows + Enter pick another; Escape closes only the menu.
  await overlay.getByLabel('Status').click();
  await expect(overlay.getByRole('option', { name: 'To do' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(overlay.getByRole('option', { name: 'In progress' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(overlay.getByRole('listbox')).toHaveCount(0);
  await expect(overlay).toBeVisible();
  await expect(overlay.getByLabel('Status')).toBeFocused();
  await overlay.getByLabel('Status').click();
  await overlay.getByRole('option', { name: 'In progress' }).click();
  await expect(overlay.getByLabel('Status')).toContainText('In progress');
  expect((await cardState(page, boardId, 1)).column).toBe('doing');

  // Assignee: names on the board are offered; picking one is one claim.
  await overlay.getByLabel('Assignee', { exact: true }).click();
  await expect(overlay.getByRole('option', { name: /auth-agent/ })).toBeVisible();
  await expect(overlay.getByRole('option', { name: /planner/ })).toBeVisible();
  await overlay.getByRole('option', { name: /auth-agent/ }).click();
  let state = await cardState(page, boardId, 1);
  expect(state.assignee).toBe('auth-agent');
  expect(state.events.filter((type) => type === 'claimed')).toHaveLength(1);
  await expect(overlay.getByLabel('Assignee', { exact: true })).toContainText('auth-agent');

  await overlay.getByLabel('Assignee', { exact: true }).click();
  await overlay.getByRole('option', { name: 'Unassign' }).click();
  expect((await cardState(page, boardId, 1)).assignee).toBeUndefined();
  await expect(overlay.getByLabel('Assignee', { exact: true })).toContainText('Unassigned');

  // Labels: the board's other labels are offered; a typed one is created; x removes.
  await overlay.getByLabel('Add label').click();
  await overlay.getByRole('option', { name: 'Bug' }).click();
  await overlay.getByLabel('Label name').fill('Auth');
  await overlay.getByLabel('Label name').press('Enter');
  await page.keyboard.press('Escape');
  expect((await cardState(page, boardId, 1)).labels).toEqual(['Feature', 'Bug', 'Auth']);
  await overlay.getByRole('button', { name: 'Remove label Feature' }).click();
  state = await cardState(page, boardId, 1);
  expect(state.labels).toEqual(['Bug', 'Auth']);

  // A click outside a menu closes it without closing the card.
  await overlay.getByLabel('Status').click();
  await overlay.getByLabel('Card title').click();
  await expect(overlay.getByRole('listbox')).toHaveCount(0);
  await expect(overlay).toBeVisible();
});

test('the label filter shows only cards with the chosen labels and clears with x', async ({ page }) => {
  await openBoard(page);
  const count = page.getByTestId('board-card-count');
  await expect(count).toHaveText('Board · 4 cards');

  await page.getByTestId('board-label-filter').click();
  const options = page.getByRole('listbox', { name: 'Labels' }).getByRole('option');
  await expect(options).toHaveText(['Bug2', 'Editor1', 'Feature1']);
  await page.getByRole('option', { name: /Bug/ }).click();
  await expect(page.getByRole('option', { name: /Bug/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('board-card-2')).toBeVisible();
  await expect(page.getByTestId('board-card-3')).toBeVisible();
  await expect(page.getByTestId('board-card-1')).toHaveCount(0);
  await expect(page.getByTestId('board-card-4')).toHaveCount(0);
  await expect(count).toHaveText('Board · 2 of 4 cards');
  await expect(page.getByTestId('board-column-todo').locator('.board-column__count')).toHaveText('2');
  await expect(page.getByTestId('board-label-filter')).toContainText('Bug');

  // Any of several labels.
  await page.getByTestId('board-label-filter').click();
  await page.getByRole('option', { name: /Feature/ }).click();
  await page.keyboard.press('Escape');
  await expect(count).toHaveText('Board · 3 of 4 cards');

  // Combined with Needs me: nothing is waiting, so nothing shows.
  await page.getByTestId('board-filter-needs-me').click();
  await expect(count).toHaveText('Board · 0 of 4 cards');
  await page.getByRole('button', { name: 'All', exact: true }).click();

  await page.getByTestId('board-label-filter-clear').click();
  await expect(count).toHaveText('Board · 4 cards');
  await expect(page.getByTestId('board-card-4')).toBeVisible();
});

test('a label has the same colour on every card and in the filter', async ({ page }) => {
  await openBoard(page);
  // Lanes show a card once per label (REQ-BOARD-043): count the cards in the Bug lane.
  const colours = await page.locator('[data-board-lane="Bug"] .board-card .board-label', { hasText: 'Bug' }).evaluateAll(
    (nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor),
  );
  expect(colours).toHaveLength(2);
  expect(colours[0]).toBe(colours[1]);
  const feature = await page.locator('.board-card .board-label', { hasText: 'Feature' }).first()
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(feature).not.toBe(colours[0]);

  await page.getByTestId('board-label-filter').click();
  const inMenu = await page.getByRole('option', { name: /Bug/ }).locator('.board-label')
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(inMenu).toBe(colours[0]);
});

test('a drag while filtered keeps hidden cards in their order', async ({ page }) => {
  const boardId = await openBoard(page);
  await page.getByTestId('board-label-filter').click();
  await page.getByRole('option', { name: /Bug/ }).click();
  await page.keyboard.press('Escape');

  // Shown in To do: #2, #3 (hidden: #1 before them, #4 after). Drag #3 above #2.
  const second = (await page.getByTestId('board-card-2').boundingBox())!;
  const third = (await page.getByTestId('board-card-3').boundingBox())!;
  await page.mouse.move(third.x + 20, third.y + 15);
  await page.mouse.down();
  await page.mouse.move(second.x + 20, second.y + 4, { steps: 8 });
  await page.mouse.up();

  const order = await page.evaluate((id) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const board = ws.workspace.sections.flatMap((s: any) => s.pages).find((p: any) => p.id === id).board;
    return board.cards.filter((card: any) => card.column === 'todo')
      .sort((a: any, b: any) => a.order - b.order).map((card: any) => card.number);
  }, boardId);
  expect(order).toEqual([1, 3, 2, 4]);
});
