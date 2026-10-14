/**
 * Covers: REQ-BOARD-026, REQ-AGENT-077, REQ-AGENT-078
 */
import { expect, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  disableFSA,
  getWorkspaceStore,
  runBridge,
  runBridgeExpectingError,
  stubBridgeUrl,
  waitForBridgeReady,
  waitForCanvasReady,
} from '../helpers';

async function openBoard(page: import('@playwright/test').Page) {
  await stubBridgeUrl(page);
  await page.goto('/');
  await waitForCanvasReady(page);
  await waitForBridgeReady(page);
  await page.getByTestId('nav-hierarchy').click();
  await page.getByTestId('add-board-btn').click();
  await expect(page.getByTestId('board-view')).toBeVisible();
  const state = await getWorkspaceStore(page);
  const boardId = state.workspace.sections
    .flatMap((section) => section.pages)
    .find((item) => item.kind === 'board')?.id as string;
  return boardId;
}

test('Clear done with confirm archives all done cards; cancel does nothing', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'Ship A', actor: 'you', column: 'done' });
  await runBridge(page, 'card_create', { boardId, title: 'Ship B', actor: 'you', column: 'done' });
  await runBridge(page, 'card_create', { boardId, title: 'Still open', actor: 'you', column: 'todo' });

  await expect(page.getByTestId('board-column-done')).toContainText('Ship A');
  await expect(page.locator('.board-view__header p')).toHaveText('Board · 3 cards');
  await page.getByTestId('board-clear-done').click();
  const confirm = page.getByTestId('board-clear-done-confirm');
  await expect(confirm).toContainText('Archive 2 done cards?');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByTestId('board-column-done')).toContainText('Ship A');
  await expect(page.locator('.board-view__header p')).toHaveText('Board · 3 cards');

  await page.getByTestId('board-clear-done').click();
  await page.getByTestId('board-clear-done-confirm').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByTestId('board-column-done')).not.toContainText('Ship A');
  await expect(page.getByTestId('board-column-done')).not.toContainText('Ship B');
  await expect(page.locator('.board-view__header p')).toHaveText('Board · 1 cards');
  await expect(page.getByTestId('board-view')).toContainText('You archived #1');
  await expect(page.getByTestId('board-view')).toContainText('You archived #2');
  await expect(page.getByTestId('board-archived-toggle')).toHaveText('Archived (2)');
});

test('overlay Archive hides the card and Archived list can restore it', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'Parked', actor: 'you', column: 'doing' });
  await page.getByTestId('board-card-1').click();
  await expect(page.getByTestId('board-card-overlay')).toBeVisible();
  await page.getByTestId('card-archive').click();
  await expect(page.getByTestId('board-card-overlay')).toHaveCount(0);
  await expect(page.getByTestId('board-card-1')).toHaveCount(0);
  await expect(page.locator('.board-view__header p')).toHaveText('Board · 0 cards');

  await page.getByTestId('board-archived-toggle').click();
  const list = page.getByTestId('board-archived-list');
  await expect(list).toContainText('#1');
  await expect(list).toContainText('Parked');
  await page.getByTestId('board-restore-1').click();
  await expect(page.getByTestId('board-card-1')).toBeVisible();
  await expect(page.getByTestId('board-column-doing')).toContainText('Parked');
  await expect(page.getByTestId('board-archived-list')).toHaveCount(0);
});

test('board_read omits archived unless include_archived; moveCard throws ARCHIVED', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'Keep', actor: 'you' });
  await runBridge(page, 'card_create', { boardId, title: 'Hide', actor: 'you' });
  await runBridge(page, 'card_archive', { boardId, card: 2, actor: 'you' });

  const live = await runBridge<{ cards: Array<{ number: number }> }>(page, 'board_read', { boardId });
  expect(live.cards.map((card) => card.number)).toEqual([1]);

  const all = await runBridge<{ cards: Array<{ number: number; archivedAt?: number }> }>(
    page,
    'board_read',
    { boardId, include_archived: true },
  );
  expect(all.cards.map((card) => card.number).sort()).toEqual([1, 2]);
  expect(all.cards.find((card) => card.number === 2)?.archivedAt).toBeTruthy();

  const got = await runBridge<{ card: { number: number; archivedAt?: number } }>(page, 'card_get', {
    boardId,
    card: 2,
  });
  expect(got.card.archivedAt).toBeTruthy();

  const err = await runBridgeExpectingError(page, 'card_move', {
    boardId,
    card: 2,
    to: 'done',
    actor: 'you',
  });
  expect(err.code).toBe('ARCHIVED');

  const updateErr = await runBridgeExpectingError(page, 'card_update', {
    boardId,
    card: 2,
    title: 'Nope',
    actor: 'you',
  });
  expect(updateErr.code).toBe('ARCHIVED');
});

test('save and reopen keeps archived cards archived and restorable', async ({ page }) => {
  await disableFSA(page);
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'Done deal', actor: 'you', column: 'done' });
  await runBridge(page, 'card_archive', { boardId, card: 1, actor: 'you' });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('save-btn').click(),
  ]);
  const file = path.join(process.cwd(), 'test-results', 'board-archive-persist.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await download.saveAs(file);

  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  await expect.poll(async () => {
    const state = await getWorkspaceStore(page);
    return state.workspace.sections
      .flatMap((section) => section.pages)
      .some((item) => item.kind === 'board');
  }).toBe(true);

  const state = await getWorkspaceStore(page);
  const boardPage = state.workspace.sections
    .flatMap((section) => section.pages)
    .find((item) => item.kind === 'board')!;
  expect(boardPage.board?.cards[0].archivedAt).toBeTruthy();
  expect(boardPage.board?.cards[0].title).toBe('Done deal');

  await page.getByTestId('nav-hierarchy').click();
  await page.getByTestId(`page-${boardPage.id}`).locator('.hierarchy-page__nav').click();
  await expect(page.getByTestId('board-view')).toBeVisible();
  await expect(page.getByTestId('board-card-1')).toHaveCount(0);
  await page.getByTestId('board-archived-toggle').click();
  await expect(page.getByTestId('board-archived-list')).toContainText('Done deal');
  await page.getByTestId('board-restore-1').click();
  await expect(page.getByTestId('board-column-done')).toContainText('Done deal');
});
