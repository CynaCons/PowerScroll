/**
 * Covers: REQ-BOARD-014, REQ-BOARD-015, REQ-BOARD-016, REQ-BOARD-017,
 * REQ-BOARD-022, REQ-AGENT-072
 */
import { expect, test } from '@playwright/test';
import {
  getWorkspaceStore,
  runBridge,
  runBridgeExpectingError,
  stubBridgeUrl,
  waitForBridgeReady,
  waitForCanvasReady,
} from '../helpers';

test.describe('211 - Board agent tools', () => {
  test.beforeEach(async ({ page }) => {
    await stubBridgeUrl(page);
    await page.goto('/');
    await waitForCanvasReady(page);
    await waitForBridgeReady(page);
  });

  test('board commands record actor, accept card numbers, and do not switch page', async ({ page }) => {
    const before = await getWorkspaceStore(page);
    const activePageId = before.activePageId;
    const canvasId = before.workspace.sections[0].pages[0].id;

    const created = await runBridge<{ boardId: string; title: string }>(page, 'board_create', {
      title: 'Sprint',
      actor: 'feature-1',
    });
    expect(created.boardId).toBeTruthy();
    expect(created.title).toBe('Sprint');

    const afterCreate = await getWorkspaceStore(page);
    expect(afterCreate.activePageId).toBe(activePageId);
    await expect(page.getByTestId('canvas-container')).toBeVisible();

    const listed = await runBridge<{ boards: Array<{ id: string; title: string; counts: Record<string, number> }> }>(
      page,
      'board_list',
    );
    expect(listed.boards.some((board) => board.id === created.boardId && board.title === 'Sprint')).toBe(true);

    const notBoard = await runBridgeExpectingError(page, 'board_read', { boardId: canvasId });
    expect(notBoard.code).toBe('PRECONDITION');

    const missingActor = await runBridgeExpectingError(page, 'card_create', {
      boardId: created.boardId,
      title: 'No actor',
    });
    expect(missingActor.code).toBe('NAME_REQUIRED');

    const card = await runBridge<{ id: string; number: number; title: string; column: string }>(
      page,
      'card_create',
      {
        boardId: created.boardId,
        title: 'Ship live board',
        description: 'MCP + UI',
        labels: ['agent'],
        checklist: ['claim', 'move'],
        actor: 'feature-1',
      },
    );
    expect(card.number).toBe(1);
    expect(card.column).toBe('todo');

    const byNumber = await runBridge<{ card: { number: number; title: string; createdBy: string; checklist: unknown[] } }>(
      page,
      'card_get',
      { boardId: created.boardId, card: 1 },
    );
    expect(byNumber.card.title).toBe('Ship live board');
    expect(byNumber.card.createdBy).toBe('feature-1');
    expect(byNumber.card.checklist).toHaveLength(2);

    const byHash = await runBridge<{ card: { id: string } }>(page, 'card_get', {
      boardId: created.boardId,
      card: '#1',
    });
    expect(byHash.card.id).toBe(card.id);

    await runBridge(page, 'card_claim', { boardId: created.boardId, card: 1, actor: 'feature-1' });
    await runBridge(page, 'card_move', {
      boardId: created.boardId,
      card: 1,
      to: 'doing',
      actor: 'feature-1',
    });
    await runBridge(page, 'card_note', {
      boardId: created.boardId,
      card: 1,
      text: 'working the strip',
      actor: 'feature-1',
    });
    await runBridge(page, 'card_check', {
      boardId: created.boardId,
      card: 1,
      item: 1,
      done: true,
      actor: 'feature-1',
    });
    await runBridge(page, 'card_checklist_add', {
      boardId: created.boardId,
      card: 1,
      text: 'highlight',
      actor: 'feature-2',
    });
    await runBridge(page, 'card_update', {
      boardId: created.boardId,
      card: 1,
      title: 'Ship live board now',
      actor: 'feature-2',
    });

    const waitingErr = await runBridgeExpectingError(page, 'card_move', {
      boardId: created.boardId,
      card: 1,
      to: 'waiting',
      actor: 'feature-1',
    });
    expect(waitingErr.code).toBe('QUESTION_REQUIRED');

    await runBridge(page, 'card_move', {
      boardId: created.boardId,
      card: 1,
      to: 'waiting',
      question: 'Does the pulse look right?',
      actor: 'feature-1',
    });

    const status = await runBridge<{ me: string; text: string }>(page, 'agent_status', {
      me: 'feature-1',
      text: 'waiting on owner',
      boardId: created.boardId,
      card: 1,
    });
    expect(status.me).toBe('feature-1');

    const stillOnCanvas = await getWorkspaceStore(page);
    expect(stillOnCanvas.activePageId).toBe(activePageId);

    const stored = await page.evaluate((boardId) => {
      const { workspace } = (window as any).__POWERNOTE_STORES__.workspace.getState();
      for (const section of workspace.sections) {
        const found = section.pages.find((item: { id: string }) => item.id === boardId);
        if (found) return found.board;
      }
      return null;
    }, created.boardId);
    expect(stored?.cards[0].assignee).toBe('feature-1');
    expect(stored?.cards[0].column).toBe('waiting');
    expect(stored?.cards[0].notes[0].author).toBe('feature-1');
    expect(stored?.events.some((event: { actor: string }) => event.actor === 'feature-2')).toBe(true);

    const cursorOnly = await runBridge<{ events: unknown[]; cursor: number }>(page, 'board_updates', {
      boardId: created.boardId,
    });
    expect(cursorOnly.events).toEqual([]);
    expect(cursorOnly.cursor).toBeGreaterThan(0);

    await runBridge(page, 'card_note', {
      boardId: created.boardId,
      card: 1,
      text: 'owner reply',
      actor: 'you',
    });
    const updates = await runBridge<{ events: Array<{ seq: number; actor: string; type: string }> }>(
      page,
      'board_updates',
      { boardId: created.boardId, since: cursorOnly.cursor },
    );
    expect(updates.events.some((event) => event.actor === 'you' && event.type === 'noted')).toBe(true);

    const mine = await runBridge<{ events: Array<{ actor: string }> }>(page, 'board_updates', {
      boardId: created.boardId,
      since: 0,
      mine: true,
      me: 'feature-1',
    });
    expect(mine.events.length).toBeGreaterThan(0);

    await runBridge(page, 'card_release', { boardId: created.boardId, card: '#1', actor: 'feature-1' });
    const missing = await runBridgeExpectingError(page, 'card_get', {
      boardId: created.boardId,
      card: 99,
    });
    expect(missing.code).toBe('NOT_FOUND');
  });
});
