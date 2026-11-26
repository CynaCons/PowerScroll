/**
 * Test 255: the tree's Show menu and the agent trail.
 * Covers: REQ-BOARD-072
 *
 * Owner report 2026-11-26: the mockups showed four readability switches and an agent trail,
 * but 0.97.0 drew three layers always on and had no trail. The debug hook reports which
 * layers are switched on and the card numbers each trail passes through.
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

async function finish(page: Page, boardId: string, title: string, actor: string) {
  const made = await runBridge(page, 'card_create', { boardId, title, labels: ['work'], actor: 'planner' });
  const number = (made?.card?.number ?? made?.number) as number;
  await runBridge(page, 'card_claim', { boardId, card: number, actor });
  await runBridge(page, 'card_move', { boardId, card: number, to: 'doing', actor });
  await runBridge(page, 'card_move', { boardId, card: number, to: 'done', actor });
  return number;
}

const layers = (page: Page) => page.evaluate(() => (window as any).__POWERNOTE_BOARD_TREE__.layers());

test('the Show menu switches the four layers, trail off by default, and remembers the choice', async ({ page }) => {
  await openBoard(page);
  await page.getByTestId('board-view-tree').click();
  await expect(page.getByTestId('board-tree')).toBeVisible();
  await expect.poll(async () => (await layers(page)).arcs).toBe(true);
  expect(await layers(page)).toMatchObject({ arcs: true, now: true, ready: true, trail: false });

  await page.getByTestId('board-tree-show').click();
  const menu = page.getByTestId('board-tree-show-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Topic progress arcs');
  await expect(menu).toContainText('Agent trail');
  await expect(page.getByTestId('board-tree-show-trail')).not.toBeChecked();
  await page.getByTestId('board-tree-show-arcs').uncheck();
  await page.getByTestId('board-tree-show-trail').check();
  await expect.poll(async () => (await layers(page)).arcs).toBe(false);
  expect((await layers(page)).trail).toBe(true);

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Kept in this browser: a fresh tree (Cards, then Tree again) starts from the saved choice.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('powerscroll-tree-show') ?? '{}'));
  expect(saved).toMatchObject({ arcs: false, trail: true });
  await page.getByTestId('board-view-cards').click();
  await expect(page.getByTestId('board-tree')).toHaveCount(0);
  await page.getByTestId('board-view-tree').click();
  await expect.poll(async () => (await layers(page))?.trail).toBe(true);
  expect((await layers(page)).arcs).toBe(false);
});

test('an agent trail runs through the cards it finished, in order, and only for agents with two or more', async ({ page }) => {
  const boardId = await openBoard(page);
  const first = await finish(page, boardId, 'First', 'feature-1');
  await finish(page, boardId, 'Solo', 'tests-2');
  const second = await finish(page, boardId, 'Second', 'feature-1');
  const third = await finish(page, boardId, 'Third', 'feature-1');
  await page.getByTestId('board-view-tree').click();
  await expect(page.getByTestId('board-tree')).toBeVisible();

  await page.getByTestId('board-tree-show').click();
  await page.getByTestId('board-tree-show-trail').check();
  await expect.poll(async () => (await layers(page)).trails.length).toBe(1);
  const [trail] = (await layers(page)).trails;
  expect(trail).toEqual({ name: 'feature-1', numbers: [first, second, third] });

  // Off again: nothing is drawn.
  await page.getByTestId('board-tree-show-trail').uncheck();
  await expect.poll(async () => (await layers(page)).trails.length).toBe(0);
});
