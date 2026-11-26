/**
 * Test 252: a task keeps moving for as long as an agent works on it.
 * Covers: REQ-BOARD-068, REQ-BOARD-020, REQ-BOARD-055
 *
 * Owner request 2026-11-26: "constant animations as long as a task is being worked on by agents".
 * Before, a card and its tree node moved only for 60 s after the agent's last write, so an agent
 * reading code between writes looked idle. Now a held card moves until the agent has been quiet
 * for 10 minutes, at which point an in-progress card becomes the quiet fault instead.
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

async function claimDoing(page: Page, boardId: string, title: string, actor: string) {
  const made = await runBridge(page, 'card_create', { boardId, title, labels: ['x'], actor: 'planner' });
  const number = (made?.card?.number ?? made?.number) as number;
  await runBridge(page, 'card_claim', { boardId, card: number, actor });
  await runBridge(page, 'card_move', { boardId, card: number, to: 'doing', actor });
  return number;
}

/** Moves the presence clock only: the agent stays connected but has not acted for a while. */
const ageAgents = (page: Page, ms: number) =>
  page.evaluate((delta) => {
    const store = (window as any).__POWERNOTE_AGENT_PRESENCE__;
    const at = Math.max(...Object.values(store.getState().actors).map((actor: any) => actor.lastActionAt));
    store.getState().setNow(at + delta);
  }, ms);

const showTree = async (page: Page) => {
  await page.getByTestId('board-view-tree').click();
  await expect(page.getByTestId('board-tree')).toBeVisible();
  await page.waitForFunction(() => ((window as any).__POWERNOTE_BOARD_TREE__?.nodes().length ?? 0) > 1);
};
const held = (page: Page) =>
  page.evaluate(() => ((window as any).__POWERNOTE_BOARD_TREE__.nodes() as any[]).find((node) => node.agent));
const stats = (page: Page) =>
  page.evaluate(() => (window as any).__POWERNOTE_BOARD_TREE__.stats() as { frames: number; animating: boolean });

test('a card stays active for the whole time its agent is working, then turns quiet', async ({ page }) => {
  const boardId = await openBoard(page);
  await claimDoing(page, boardId, 'Parser', 'feature-1');
  const card = page.getByTestId('board-card-1');
  await expect(card).toHaveAttribute('data-active', 'true');

  // Five quiet minutes used to put the light out after one; the agent is still working.
  await ageAgents(page, 5 * 60_000);
  await page.waitForTimeout(300);
  await expect(card).toHaveAttribute('data-active', 'true');
  await expect(card).toContainText('working now');
  const pulse = await card.evaluate((element) => getComputedStyle(element).animationName);
  expect(pulse).not.toBe('none');
  await expect(page.getByTestId('board-agent-feature-1')).toHaveAttribute('data-active', 'true');

  await ageAgents(page, 10 * 60_000 - 1_000);
  await page.waitForTimeout(300);
  await expect(card).toHaveAttribute('data-active', 'true');

  await ageAgents(page, 10 * 60_000 + 1_000);
  await expect(card).toHaveAttribute('data-active', 'false');
});

test('a finished or waiting card does not move, whoever holds it', async ({ page }) => {
  const boardId = await openBoard(page);
  await claimDoing(page, boardId, 'Parser', 'feature-1');
  const card = page.getByTestId('board-card-1');
  await expect(card).toHaveAttribute('data-active', 'true');

  await runBridge(page, 'card_move', { boardId, card: 1, to: 'waiting', question: 'Which one?', actor: 'feature-1' });
  await expect(card).toHaveAttribute('data-active', 'false');
  await runBridge(page, 'card_move', { boardId, card: 1, to: 'doing', actor: 'feature-1' });
  await expect(card).toHaveAttribute('data-active', 'true');
  await runBridge(page, 'card_move', { boardId, card: 1, to: 'done', actor: 'feature-1' });
  await expect(card).toHaveAttribute('data-active', 'false');
});

test('in the tree a comet circles the task for as long as the agent works, then the fault takes over', async ({ page }) => {
  const boardId = await openBoard(page);
  await claimDoing(page, boardId, 'Parser', 'feature-1');
  await showTree(page);

  await ageAgents(page, 5 * 60_000);
  await expect.poll(async () => (await held(page))?.comet).toBe(true);
  expect((await held(page)).live).toBe(true);
  expect((await held(page)).fault).toBe(false);
  await expect.poll(async () => (await stats(page)).animating).toBe(true);
  const first = (await stats(page)).frames;
  await page.waitForTimeout(1000);
  const frames = (await stats(page)).frames - first;
  expect(frames).toBeGreaterThan(2);
  expect(frames).toBeLessThan(20);

  await ageAgents(page, 10 * 60_000 + 1_000);
  await expect.poll(async () => (await held(page))?.fault).toBe(true);
  expect((await held(page)).live).toBe(false);
  expect((await held(page)).comet).toBe(false);
  await expect.poll(async () => (await stats(page)).animating).toBe(false);
});

test('under reduced motion a working task has no comet and nothing animates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const boardId = await openBoard(page);
  await claimDoing(page, boardId, 'Parser', 'feature-1');
  await showTree(page);
  await expect.poll(async () => (await held(page))?.live).toBe(true);
  expect((await held(page)).comet).toBe(false);
  expect((await stats(page)).animating).toBe(false);
});
