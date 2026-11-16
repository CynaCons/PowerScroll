/**
 * Test 247: card dependencies through the agent tools.
 * Covers: REQ-BOARD-061, REQ-BOARD-062
 *
 * Owner request 2026-11-16: define dependencies between board items so a
 * sequence can be coded. Driven through the bridge, like the MCP tools.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  runBridge,
  runBridgeExpectingError,
  stubBridgeUrl,
  waitForBridgeReady,
  waitForCanvasReady,
} from '../helpers';

interface Entry {
  number: number;
  column: string;
  waits_on?: number[];
}

async function newBoard(page: Page): Promise<string> {
  const created = await runBridge<{ boardId: string }>(page, 'board_create', { title: 'Sequence', actor: 'planner' });
  return created.boardId;
}

const create = (page: Page, boardId: string, title: string, extra: Record<string, unknown> = {}) =>
  runBridge<Entry>(page, 'card_create', { boardId, title, actor: 'planner', ...extra });

const read = (page: Page, boardId: string) =>
  runBridge<{ cards: Entry[]; ready: Array<{ number: number; title: string }> }>(page, 'board_read', {
    boardId,
    include_archived: true,
  });

test.describe('247 - Card dependencies tools', () => {
  test.beforeEach(async ({ page }) => {
    await stubBridgeUrl(page);
    await page.goto('/');
    await waitForCanvasReady(page);
    await waitForBridgeReady(page);
  });

  test('depends_on at creation shows in board_read; the ready list excludes waiting cards', async ({ page }) => {
    const boardId = await newBoard(page);
    await create(page, boardId, 'Schema');
    await create(page, boardId, 'API', { depends_on: [1] });
    await create(page, boardId, 'UI', { depends_on: [1, '#2'] });

    const board = await read(page, boardId);
    const byNumber = Object.fromEntries(board.cards.map((card) => [card.number, card]));
    expect(byNumber[1].waits_on).toBeUndefined();
    expect(byNumber[2].waits_on).toEqual([1]);
    expect(byNumber[3].waits_on).toEqual([1, 2]);
    expect(board.ready.map((card) => card.number)).toEqual([1]);
    expect(board.ready[0].title).toBe('Schema');
  });

  test('claim and move to doing are refused while blockers are open, naming them and the ready cards', async ({ page }) => {
    const boardId = await newBoard(page);
    await create(page, boardId, 'Schema');
    await create(page, boardId, 'Search notes');
    await create(page, boardId, 'API', { depends_on: [1] });
    await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'sonnet-2' });
    await runBridge(page, 'card_move', { boardId, card: 1, to: 'doing', actor: 'sonnet-2' });

    const claim = await runBridgeExpectingError(page, 'card_claim', { boardId, card: 3, actor: 'sonnet-3' });
    expect(claim.code).toBe('NOT_READY');
    expect(claim.message).toContain('#1');
    expect(claim.message).toContain('In progress');
    expect(claim.message).toContain('sonnet-2');
    expect(claim.message).toContain('Ready now: #2 Search notes');

    const move = await runBridgeExpectingError(page, 'card_move', { boardId, card: 3, to: 'doing', actor: 'sonnet-3' });
    expect(move.code).toBe('NOT_READY');

    // Other moves are not blocked.
    const toWaiting = await runBridge<Entry>(page, 'card_move', {
      boardId, card: 3, to: 'waiting', question: 'Which verb?', actor: 'sonnet-3',
    });
    expect(toWaiting.column).toBe('waiting');
  });

  test('moving a blocker to done reports the cards that became ready', async ({ page }) => {
    const boardId = await newBoard(page);
    await create(page, boardId, 'Schema');
    await create(page, boardId, 'Seed data');
    await create(page, boardId, 'API', { depends_on: [1] });
    await create(page, boardId, 'UI', { depends_on: [1, 2] });

    const first = await runBridge<{ newly_ready: Array<{ number: number; title: string }> }>(page, 'card_move', {
      boardId, card: 1, to: 'done', actor: 'planner',
    });
    expect(first.newly_ready).toEqual([{ number: 3, title: 'API' }]);

    const second = await runBridge<{ newly_ready: Array<{ number: number }> }>(page, 'card_move', {
      boardId, card: 2, to: 'done', actor: 'planner',
    });
    expect(second.newly_ready.map((card) => card.number)).toEqual([4]);

    const claimed = await runBridge<Entry>(page, 'card_claim', { boardId, card: 4, actor: 'sonnet-1' });
    expect(claimed.number).toBe(4);
    const moved = await runBridge<{ newly_ready?: unknown }>(page, 'card_move', {
      boardId, card: 4, to: 'doing', actor: 'sonnet-1',
    });
    expect(moved.newly_ready).toBeUndefined();
  });

  test('loops and self links are refused with the reason and change nothing', async ({ page }) => {
    const boardId = await newBoard(page);
    await create(page, boardId, 'A');
    await create(page, boardId, 'B', { depends_on: [1] });
    await create(page, boardId, 'C', { depends_on: [2] });

    const self = await runBridgeExpectingError(page, 'card_update', {
      boardId, card: 1, depends_on_add: [1], actor: 'planner',
    });
    expect(self.code).toBe('DEPENDENCY_SELF');

    const direct = await runBridgeExpectingError(page, 'card_update', {
      boardId, card: 1, depends_on_add: [2], actor: 'planner',
    });
    expect(direct.code).toBe('DEPENDENCY_LOOP');
    expect(direct.message).toContain('loop');

    const long = await runBridgeExpectingError(page, 'card_update', {
      boardId, card: 1, depends_on_add: [3], actor: 'planner',
    });
    expect(long.code).toBe('DEPENDENCY_LOOP');

    const board = await read(page, boardId);
    expect(board.cards.find((card) => card.number === 1)?.waits_on).toBeUndefined();
  });

  test('depends_on_remove, delete and archive release a waiting card', async ({ page }) => {
    const boardId = await newBoard(page);
    await create(page, boardId, 'A');
    await create(page, boardId, 'B');
    await create(page, boardId, 'C', { depends_on: [1, 2] });

    await runBridge(page, 'card_update', { boardId, card: 3, depends_on_remove: [1], actor: 'planner' });
    expect((await read(page, boardId)).cards.find((card) => card.number === 3)?.waits_on).toEqual([2]);

    // Archived counts as done.
    await runBridge(page, 'card_archive', { boardId, card: 2, actor: 'planner' });
    const afterArchive = await read(page, boardId);
    expect(afterArchive.cards.find((card) => card.number === 3)?.waits_on).toBeUndefined();
    expect(afterArchive.ready.map((card) => card.number)).toContain(3);

    // Restoring brings the wait back; removing the card ends it for good.
    await runBridge(page, 'card_restore', { boardId, card: 2, actor: 'planner' });
    expect((await read(page, boardId)).cards.find((card) => card.number === 3)?.waits_on).toEqual([2]);

    // A card that vanished from the board (no delete tool exists yet) stops blocking.
    await page.evaluate((id) => {
      const store = (window as any).__POWERNOTE_STORES__.workspace.getState();
      store.updateBoard(id, (board: any) => ({
        ...board,
        cards: board.cards.filter((card: any) => card.number !== 2),
      }));
    }, boardId);
    const afterDelete = await read(page, boardId);
    expect(afterDelete.cards.find((card) => card.number === 3)?.waits_on).toBeUndefined();
  });

  test('unknown cards in depends_on are refused', async ({ page }) => {
    const boardId = await newBoard(page);
    await create(page, boardId, 'A');
    const error = await runBridgeExpectingError(page, 'card_create', {
      boardId, title: 'B', depends_on: [99], actor: 'planner',
    });
    expect(error.code).toBe('NOT_FOUND');
  });
});
