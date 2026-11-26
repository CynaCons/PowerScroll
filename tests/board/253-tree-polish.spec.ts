/**
 * Test 253: tree polish - topic progress arcs, "now" marks and ready-next cards.
 * Covers: REQ-BOARD-069, REQ-BOARD-070, REQ-BOARD-071
 *
 * Owner pick 2026-11-26: keep the tree where it is and polish it. The debug hook reports what each
 * node carries; the drawing itself is checked by eye in the showcase.
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

async function make(page: Page, boardId: string, title: string, label: string, column = 'todo', extra: Record<string, unknown> = {}) {
  const made = await runBridge(page, 'card_create', { boardId, title, labels: [label], column, actor: 'planner', ...extra });
  return (made?.card?.number ?? made?.number) as number;
}

const showTree = async (page: Page) => {
  await page.getByTestId('board-view-tree').click();
  await expect(page.getByTestId('board-tree')).toBeVisible();
  await page.waitForFunction(() => ((window as any).__POWERNOTE_BOARD_TREE__?.nodes().length ?? 0) > 1);
};
const nodes = (page: Page) => page.evaluate(() => (window as any).__POWERNOTE_BOARD_TREE__.nodes() as any[]);
const topic = async (page: Page, name: string) => (await nodes(page)).find((node) => node.kind === 'topic' && node.topic === name);
const card = async (page: Page, title: string) => {
  const ids = await page.evaluate(() => {
    const state = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const board = state.workspace.sections.flatMap((section: any) => section.pages).find((p: any) => p.id === state.activePageId).board;
    return Object.fromEntries(board.cards.map((c: any) => [c.title, c.id]));
  });
  return (await nodes(page)).find((node) => node.cardId === ids[title]);
};

test('a topic carries its share of finished cards, and a now mark only when it has both kinds', async ({ page }) => {
  const boardId = await openBoard(page);
  await make(page, boardId, 'A1', 'alpha', 'done');
  await make(page, boardId, 'A2', 'alpha', 'done');
  await make(page, boardId, 'A3', 'alpha', 'doing');
  await make(page, boardId, 'A4', 'alpha');
  await make(page, boardId, 'B1', 'beta');
  await make(page, boardId, 'C1', 'gamma', 'done');
  await showTree(page);

  await expect.poll(async () => (await topic(page, 'alpha'))?.cardCount).toBe(4);
  const alpha = (await topic(page, 'alpha'))!;
  expect(alpha.doneCount).toBe(2);
  expect(alpha.nowR).toBeGreaterThan(0);
  const done = await card(page, 'A2');
  const live = await card(page, 'A3');
  const r = (node: any) => Math.hypot(node.x, node.y);
  expect(alpha.nowR).toBeGreaterThan(r(done));
  expect(alpha.nowR).toBeLessThan(r(live));

  expect((await topic(page, 'beta'))!.nowR).toBeNull();
  expect((await topic(page, 'beta'))!.doneCount).toBe(0);
  expect((await topic(page, 'gamma'))!.nowR).toBeNull();
  expect((await topic(page, 'gamma'))!.doneCount).toBe(1);

  // Finishing a card moves the arc and the mark.
  await runBridge(page, 'card_move', { boardId, card: 3, to: 'done', actor: 'planner' });
  await expect.poll(async () => (await topic(page, 'alpha'))?.doneCount).toBe(3);
});

test('the next queued card is ready; one waiting on an unfinished card is not until it finishes', async ({ page }) => {
  const boardId = await openBoard(page);
  const first = await make(page, boardId, 'Q1', 'alpha');
  await make(page, boardId, 'Q2', 'alpha');
  const blocker = await make(page, boardId, 'Build', 'beta', 'doing');
  await make(page, boardId, 'Ship', 'alpha', 'todo', { depends_on: [blocker] });
  await showTree(page);

  await expect.poll(async () => (await card(page, 'Q1'))?.ready).toBe(true);
  expect((await card(page, 'Q2'))!.ready).toBe(false);
  expect((await card(page, 'Ship'))!.ready).toBe(false);
  expect((await card(page, 'Ship'))!.locked).toBe(true);
  expect((await card(page, 'Build'))!.ready).toBe(false);

  await runBridge(page, 'card_move', { boardId, card: blocker, to: 'done', actor: 'planner' });
  await expect.poll(async () => (await card(page, 'Ship'))?.ready).toBe(true);
  expect(first).toBe(1);
});
