/**
 * Test 217: agents must say who they are; PowerScroll never invents a name.
 * Covers: REQ-AGENT-079
 *
 * Owner request 2026-10-14: "we should not generate random agent names ...
 * right now I see dozens of agents which are connected ... it's all the same
 * one, just connecting and reconnecting over and over."
 */
import { expect, test } from '@playwright/test';
import {
  runBridge,
  runBridgeExpectingError,
  stubBridgeUrl,
  waitForBridgeReady,
  waitForCanvasReady,
} from '../helpers';

test('board commands without a name, or with a generated one, are refused', async ({ page }) => {
  await stubBridgeUrl(page);
  await page.goto('/');
  await waitForCanvasReady(page);
  await waitForBridgeReady(page);
  const board = await runBridge<{ boardId: string }>(page, 'board_create', {
    title: 'Names',
    actor: 'feature-1',
  });

  const missing = await runBridgeExpectingError(page, 'card_create', {
    boardId: board.boardId,
    title: 'No name',
  });
  expect(missing.code).toBe('NAME_REQUIRED');
  expect(missing.message).toMatch(/me/);

  for (const actor of ['agent-1a2b3c4d', 'unnamed-0f9e8d7c']) {
    const generated = await runBridgeExpectingError(page, 'card_create', {
      boardId: board.boardId,
      title: 'Generated',
      actor,
    });
    expect(generated.code, actor).toBe('NAME_REQUIRED');
  }

  // A real name works, and only real names reach the board.
  await runBridge(page, 'card_create', { boardId: board.boardId, title: 'Named', actor: 'feature-2' });
  const actors = await page.evaluate((id) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const pageData = ws.workspace.sections.flatMap((s: any) => s.pages).find((p: any) => p.id === id);
    return [...new Set(pageData.board.events.map((event: any) => event.actor))];
  }, board.boardId);
  expect(actors).toContain('feature-2');
  expect(actors.some((name: string) => /^(agent|unnamed)-/.test(name))).toBe(false);
});
