/**
 * Test 218: typing in a card is saved when the card closes, not per letter.
 * Covers: REQ-BOARD-029
 *
 * Owner report 2026-10-14: "while I was typing, I just noticed that on every
 * letter, it created a new entry in the history of that task ... whatever the
 * user types should be saved whenever the user closes the window ... but not
 * on every letter."
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

function cardEvents(page: Page, boardId: string) {
  return page.evaluate((id) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const board = ws.workspace.sections.flatMap((s: any) => s.pages).find((p: any) => p.id === id).board;
    return board.events.map((event: any) => ({ type: event.type, actor: event.actor }));
  }, boardId);
}

test('typing title, description and assignee writes no history until the card closes', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'Draft me', actor: 'feature-1' });
  const before = (await cardEvents(page, boardId)).length;

  await page.getByTestId('board-card-1').click();
  const overlay = page.getByTestId('board-card-overlay');
  const title = overlay.getByLabel('Card title');
  await title.fill('');
  await title.pressSequentially('Typed letter by letter');
  await overlay.locator('.board-description').click();
  await overlay.getByLabel('Description').pressSequentially('Some notes');
  await overlay.getByLabel('Assignee').fill('');
  await overlay.getByLabel('Assignee').pressSequentially('Ada');
  await overlay.getByLabel('Assignee').press('Enter');

  // The owner's symptom: one history entry per letter. Now: none while typing.
  expect((await cardEvents(page, boardId)).length).toBe(before);
  await expect(overlay.locator('.board-history li')).toHaveCount(1);
  await expect(title).toHaveValue('Typed letter by letter');

  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  const added = (await cardEvents(page, boardId)).slice(before);
  expect(added).toEqual([
    { type: 'updated', actor: 'you' },
    { type: 'claimed', actor: 'Ada' },
  ]);
  const card = page.getByTestId('board-card-1');
  await expect(card).toContainText('Typed letter by letter');
  await expect(card).toContainText('Ada');

  // Reopening and closing without changes writes nothing.
  await card.click();
  await overlay.getByLabel('Close card').click();
  await expect(overlay).toHaveCount(0);
  expect((await cardEvents(page, boardId)).length).toBe(before + 2);
});

test('archive saves pending text first; old per-letter runs read as one line', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'Old card', actor: 'feature-1' });
  // A board edited before the fix: five adjacent edits by the same actor.
  for (const title of ['O', 'Ol', 'Old', 'Old c', 'Old card 2']) {
    await runBridge(page, 'card_update', { boardId, card: 1, title, actor: 'feature-1' });
  }
  await expect(page.getByTestId('board-activity').locator('li')).toHaveCount(2);

  await page.getByTestId('board-card-1').click();
  const overlay = page.getByTestId('board-card-overlay');
  await expect(overlay.locator('.board-history li')).toHaveCount(2);
  await overlay.getByLabel('Card title').fill('Saved before archive');
  await overlay.getByTestId('card-archive').click();
  await expect(overlay).toHaveCount(0);

  const types = (await cardEvents(page, boardId)).slice(-2).map((event) => event.type);
  expect(types).toEqual(['updated', 'archived']);
  const title = await page.evaluate((id) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const board = ws.workspace.sections.flatMap((s: any) => s.pages).find((p: any) => p.id === id).board;
    return board.cards[0].title;
  }, boardId);
  expect(title).toBe('Saved before archive');
});
