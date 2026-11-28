/**
 * Test 256: the board's Recent filter.
 * Covers: REQ-BOARD-073
 *
 * Owner request 2026-11-28: a mode that shows only the recently modified cards. Cards are
 * aged by rewriting their events and timestamps in the workspace store; the window's clock
 * is the presence store's, which the test can move.
 */
import { expect, test, type Page } from '@playwright/test';
import { runBridge, stubBridgeUrl, waitForBridgeReady, waitForCanvasReady } from '../helpers';

const DAY = 24 * 60 * 60_000;

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

async function create(page: Page, boardId: string, title: string) {
  const made = await runBridge(page, 'card_create', { boardId, title, actor: 'planner' });
  return (made?.card?.number ?? made?.number) as number;
}

/** Push a card's whole history back by `ms`, as if it was last touched that long ago. */
async function age(page: Page, boardId: string, number: number, ms: number) {
  await page.evaluate(({ boardId, number, ms }) => {
    const store = (window as any).__POWERNOTE_STORES__.workspace.getState();
    store.updateBoard(boardId, (board: any) => {
      const card = board.cards.find((item: any) => item.number === number);
      return {
        ...board,
        cards: board.cards.map((item: any) => (item.id === card.id
          ? { ...item, createdAt: item.createdAt - ms, updatedAt: item.updatedAt - ms }
          : item)),
        events: board.events.map((event: any) => (event.cardId === card.id ? { ...event, at: event.at - ms } : event)),
      };
    });
  }, { boardId, number, ms });
}

test('Recent shows only the cards changed in the window, skips pure reorders, and fades the tree', async ({ page }) => {
  const boardId = await openBoard(page);
  const old = await create(page, boardId, 'Old and untouched');
  const moved = await create(page, boardId, 'Old, then moved');
  const fresh = await create(page, boardId, 'Fresh');
  await age(page, boardId, old, 3 * DAY);
  await age(page, boardId, moved, 3 * DAY);
  await runBridge(page, 'card_move', { boardId, card: moved, to: 'doing', actor: 'feature-1' });
  // A reorder inside To do refreshes the card's timestamp, but is not a change worth showing.
  await runBridge(page, 'card_move', { boardId, card: old, to: 'todo', position: 0, actor: 'feature-1' });

  await expect(page.getByTestId('board-recent-window')).toContainText('24 h');
  await page.getByTestId('board-filter-recent').click();
  await expect(page.getByTestId('board-card-count')).toHaveText('Board · 2 of 3 cards');
  await expect(page.getByTestId(`board-card-${old}`)).toHaveCount(0);
  await expect(page.getByTestId(`board-card-${fresh}`)).toBeVisible();
  await expect(page.getByTestId(`board-card-change-${moved}`)).toHaveText(/^(just now|\d+ min ago) · feature-1 · moved to In progress$/);
  await expect(page.getByTestId(`board-card-change-${fresh}`)).toContainText('planner · created');

  // The window menu widens and narrows it.
  await page.getByTestId('board-recent-window').click();
  await page.getByTestId('board-recent-window-week').click();
  await expect(page.getByTestId('board-card-count')).toHaveText('Board · 3 of 3 cards');
  await expect(page.getByTestId(`board-card-change-${old}`)).toContainText('3 d ago · planner · created');
  await page.getByTestId('board-recent-window').click();
  await page.getByTestId('board-recent-window-hour').click();
  await expect(page.getByTestId('board-card-count')).toHaveText('Board · 2 of 3 cards');

  // Kept in this browser.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('powerscroll-board-recent') ?? '{}'));
  expect(saved).toEqual({ on: true, window: 'hour' });

  // Tree: every card stays, the unchanged one fades.
  await page.getByTestId('board-view-tree').click();
  await expect(page.getByTestId('board-tree')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__POWERNOTE_BOARD_TREE__?.recent())).toEqual([moved, fresh]);
  const cardNodes = await page.evaluate(() => (window as any).__POWERNOTE_BOARD_TREE__.nodes().filter((node: any) => node.kind === 'card').length);
  expect(cardNodes).toBe(3);
  await page.getByTestId('board-filter-all').click();
  await expect.poll(() => page.evaluate(() => (window as any).__POWERNOTE_BOARD_TREE__?.recent())).toBeNull();
  await page.getByTestId('board-view-cards').click();
  await page.getByTestId('board-filter-recent').click();

  // Two hours on, nothing is in the last hour: the board says so and offers a wider window.
  await page.evaluate(() => {
    const presence = (window as any).__POWERNOTE_AGENT_PRESENCE__.getState();
    presence.setNow(Date.now() + 2 * 60 * 60_000);
  });
  await expect(page.getByTestId('board-recent-empty')).toContainText('Nothing changed in the last hour.');
  await page.getByTestId('board-recent-widen').click();
  await expect(page.getByTestId('board-recent-window')).toContainText('7 days');
  await expect(page.getByTestId('board-card-count')).toHaveText('Board · 3 of 3 cards');
  await expect(page.getByTestId('board-recent-empty')).toHaveCount(0);
});

test('Since my last visit counts from the moment this board was last left', async ({ page }) => {
  const boardId = await openBoard(page);
  const before = await create(page, boardId, 'Before I left');
  await page.getByTestId('board-filter-recent').click();
  await page.getByTestId('board-recent-window').click();
  await page.getByTestId('board-recent-window-visit').click();
  // First visit: no stored visit, so it reads as the last 24 hours.
  await expect(page.getByTestId('board-card-count')).toHaveText('Board · 1 of 1 cards');

  // Leave the board for the canvas page, then come back after an agent changed something.
  const canvas = await page.evaluate(() => {
    const store = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const section = store.workspace.sections.find((item: any) => item.id === store.activeSectionId);
    return { sectionId: section.id, pageId: section.pages.find((item: any) => !item.board).id };
  });
  await page.evaluate(({ sectionId, pageId }) => {
    (window as any).__POWERNOTE_STORES__.workspace.getState().setActivePage(sectionId, pageId);
  }, canvas);
  await expect(page.getByTestId('board-view')).toHaveCount(0);
  const stored = await page.evaluate((id) => Number(localStorage.getItem(`powerscroll-board-visit:${id}`)), boardId);
  expect(stored).toBeGreaterThan(0);
  await page.waitForTimeout(20);
  const after = await create(page, boardId, 'While I was away');
  await page.evaluate(({ sectionId, pageId }) => {
    (window as any).__POWERNOTE_STORES__.workspace.getState().setActivePage(sectionId, pageId);
  }, { sectionId: canvas.sectionId, pageId: boardId });

  await expect(page.getByTestId('board-view')).toBeVisible();
  await expect(page.getByTestId('board-card-count')).toHaveText('Board · 1 of 2 cards');
  await expect(page.getByTestId(`board-card-${after}`)).toBeVisible();
  await expect(page.getByTestId(`board-card-${before}`)).toHaveCount(0);
});
