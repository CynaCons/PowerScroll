/**
 * Test 246: where the agents are working, in the board tree.
 * Covers: REQ-BOARD-054, REQ-BOARD-055, REQ-BOARD-056, REQ-BOARD-057, REQ-BOARD-058, REQ-BOARD-059
 *
 * Owner request 2026-11-14: "in the tree I don't see where the agents are working". A task an agent
 * holds is ringed in the agent's colour and carries its name; one it acted on in the last minute
 * has a moving ring. Presence is faked the way T215 does it: bridge calls under an actor name.
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

const showTree = async (page: Page) => {
  await page.getByTestId('board-view-tree').click();
  await expect(page.getByTestId('board-tree')).toBeVisible();
  await page.waitForFunction(() => ((window as any).__POWERNOTE_BOARD_TREE__?.nodes().length ?? 0) > 1);
};

const nodes = (page: Page) => page.evaluate(() => (window as any).__POWERNOTE_BOARD_TREE__.nodes() as any[]);
const stats = (page: Page) =>
  page.evaluate(() => (window as any).__POWERNOTE_BOARD_TREE__.stats() as {
    frames: number; layouts: number; lastFrameMs: number; animating: boolean;
  });
const view = (page: Page) =>
  page.evaluate(() => (window as any).__POWERNOTE_BOARD_TREE__.view() as { k: number; x: number; y: number });
const nodeOf = async (page: Page, cardId: string) => (await nodes(page)).find((node) => node.cardId === cardId);

/** A card claimed by an agent through the bridge: the agent holds it and is working now. */
async function claim(page: Page, boardId: string, title: string, actor: string, labels = ['x']) {
  const made = await runBridge(page, 'card_create', { boardId, title, labels, actor: 'planner' });
  const number = made?.card?.number ?? made?.number;
  await runBridge(page, 'card_claim', { boardId, card: number, actor });
  return number as number;
}

/** Time moves on for the presence clock only: the agent is connected but has not acted for a while. */
const ageAgents = (page: Page, minutes: number) =>
  page.evaluate((ms) => {
    const store = (window as any).__POWERNOTE_AGENT_PRESENCE__;
    const at = Math.max(...Object.values(store.getState().actors).map((actor: any) => actor.lastActionAt));
    store.getState().setNow(at + ms);
  }, minutes * 60_000);

async function settle(page: Page) {
  let last = -1;
  for (let attempt = 0; attempt < 40; attempt++) {
    const { frames } = await stats(page);
    if (frames === last) return;
    last = frames;
    await page.waitForTimeout(300);
  }
  throw new Error('the tree never came to rest');
}

test('a held card names its agent and carries the colour of the agent chip', async ({ page }) => {
  const boardId = await openBoard(page);
  await claim(page, boardId, 'Parser', 'feature-1');
  await runBridge(page, 'card_create', { boardId, title: 'Unheld', labels: ['x'], actor: 'planner' });
  await showTree(page);

  await expect.poll(async () => (await nodes(page)).some((node) => node.agent === 'feature-1')).toBe(true);
  const all = await nodes(page);
  expect(all.filter((node) => node.agent)).toHaveLength(1);
  const chip = page.getByTestId('board-agent-feature-1');
  const chipColour = await chip.evaluate((element) => getComputedStyle(element).getPropertyValue('--agent-color').trim().toLowerCase());
  expect(chipColour).toMatch(/^#[0-9a-f]{6}$/);
  const heldNode = all.find((node) => node.agent)!;
  expect(heldNode.agentColor.toLowerCase()).toBe(chipColour);
  expect(all.filter((node) => node.kind === 'card' && !node.agent)).toHaveLength(1);

  // The tooltip names the card, then the agent and what it is doing.
  await page.mouse.move(heldNode.sx, heldNode.sy);
  await expect(page.locator('.board-tree__tip')).toContainText('#1 Parser');
  await expect(page.locator('.board-tree__tip')).toContainText('feature-1 - working now');
});

test('a live agent animates the ring at a low frame rate', async ({ page }) => {
  const boardId = await openBoard(page);
  await claim(page, boardId, 'Parser', 'feature-1');
  await showTree(page);
  await expect.poll(async () => (await stats(page)).animating).toBe(true);
  expect((await nodes(page)).find((node) => node.agent)!.live).toBe(true);

  const first = (await stats(page)).frames;
  await page.waitForTimeout(1000);
  const second = await stats(page);
  const frames = second.frames - first;
  console.log(`live agent: ${frames} frames in 1 s, last frame ${second.lastFrameMs.toFixed(2)} ms`);
  expect(frames).toBeGreaterThan(2);
  expect(frames).toBeLessThan(20);
});

test('with no live agent nothing animates, and the ring stops a minute after the last action', async ({ page }) => {
  const boardId = await openBoard(page);
  await claim(page, boardId, 'Parser', 'feature-1');
  await showTree(page);
  await expect.poll(async () => (await stats(page)).animating).toBe(true);

  await ageAgents(page, 2);
  await expect.poll(async () => (await stats(page)).animating).toBe(false);
  const held = (await nodes(page)).find((node) => node.agent)!;
  expect(held.live).toBe(false);
  await settle(page);
  const before = await stats(page);
  await page.waitForTimeout(600);
  expect((await stats(page)).frames).toBe(before.frames);
});

test('under reduced motion a live agent does not animate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const boardId = await openBoard(page);
  await claim(page, boardId, 'Parser', 'feature-1');
  await showTree(page);
  await expect.poll(async () => (await nodes(page)).some((node) => node.agent && node.live)).toBe(true);
  await settle(page);
  expect((await stats(page)).animating).toBe(false);
  const before = await stats(page);
  await page.waitForTimeout(600);
  expect((await stats(page)).frames).toBe(before.frames);
});

test('a card an agent holds is never folded into a +N node', async ({ page }) => {
  const boardId = await openBoard(page);
  await page.evaluate((id) => {
    const store = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const base = Date.now() - 10_000_000;
    const cards = Array.from({ length: 14 }, (_, index) => ({
      id: `seed-${index + 1}`, number: index + 1, title: `Done ${index + 1}`, description: '', column: 'done',
      order: index, assignee: index === 2 ? 'feature-1' : undefined, labels: ['x'], checklist: [], notes: [],
      createdBy: 'planner', createdAt: base + index, updatedAt: base + index,
    }));
    store.updateBoard(id, () => ({ cards, events: [], nextNumber: 15, nextSeq: 1 }));
    (window as any).__POWERNOTE_AGENT_PRESENCE__.getState().recordAction('feature-1', { cardId: 'seed-3', boardId: id });
  }, boardId);
  await showTree(page);

  await expect.poll(async () => (await nodeOf(page, 'seed-3'))?.agent).toBe('feature-1');
  const all = await nodes(page);
  // The 3rd oldest finished card would have been folded; the held card takes one of the six places.
  expect(all.filter((node) => node.kind === 'card')).toHaveLength(6);
  expect(all.find((node) => node.kind === 'fold')!.count).toBe(8);
  expect(await nodeOf(page, 'seed-14')).toBeTruthy();
  expect(await nodeOf(page, 'seed-9')).toBeFalsy();
});

test('clicking the agent chip moves the tree to its card and a second click leaves the view alone', async ({ page }) => {
  const boardId = await openBoard(page);
  await claim(page, boardId, 'Parser', 'feature-1', ['a']);
  for (let index = 0; index < 8; index++) {
    await runBridge(page, 'card_create', { boardId, title: `Other ${index}`, labels: ['b', 'c', 'd'][index % 3] ? [['b', 'c', 'd'][index % 3]] : [], actor: 'planner' });
  }
  await showTree(page);
  await ageAgents(page, 2); // not live, so the tree can come to rest between steps
  await expect.poll(async () => (await stats(page)).animating).toBe(false);
  await settle(page);

  const fitted = await view(page);
  const canvas = (await page.getByTestId('board-tree-canvas').boundingBox())!;
  const centre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  const chip = page.getByTestId('board-agent-feature-1').getByRole('button').first();

  await chip.click();
  await expect(page.getByTestId('board-view')).toHaveAttribute('data-spotlight', 'feature-1');
  await expect.poll(async () => (await view(page)).k).toBeGreaterThan(fitted.k);
  await settle(page);
  const node = (await nodes(page)).find((item) => item.agent === 'feature-1')!;
  expect(Math.abs(node.sx - centre.x)).toBeLessThan(3);
  expect(Math.abs(node.sy - centre.y)).toBeLessThan(3);

  const zoomed = await view(page);
  await chip.click();
  await expect(page.getByTestId('board-view')).not.toHaveAttribute('data-spotlight');
  await page.waitForTimeout(500);
  await settle(page);
  expect(await view(page)).toEqual(zoomed);
});

test('a note from another actor does not redraw the tree, and taking a card does once', async ({ page }) => {
  const boardId = await openBoard(page);
  const made = await runBridge(page, 'card_create', { boardId, title: 'Parser', labels: ['x'], actor: 'planner' });
  const number = made?.card?.number ?? made?.number;
  await showTree(page);
  await settle(page);

  let layouts = (await stats(page)).layouts;
  await runBridge(page, 'card_note', { boardId, card: number, text: 'Looks fine', actor: 'feature-2' });
  await page.waitForTimeout(500);
  expect((await stats(page)).layouts).toBe(layouts);

  await runBridge(page, 'card_claim', { boardId, card: number, actor: 'feature-1' });
  await expect.poll(async () => (await nodes(page)).some((node) => node.agent === 'feature-1')).toBe(true);
  await page.waitForTimeout(400);
  expect((await stats(page)).layouts).toBe(layouts + 1);
  layouts += 1;

  // Another agent acting somewhere else leaves the picture alone.
  await runBridge(page, 'card_note', { boardId, card: number, text: 'Still going', actor: 'feature-2' });
  await page.waitForTimeout(400);
  expect((await stats(page)).layouts).toBe(layouts);
});

test('a quiet card keeps the fault colour and no moving ring, and shows the agent name', async ({ page }) => {
  const boardId = await openBoard(page);
  const number = await claim(page, boardId, 'Parser', 'feature-1');
  await runBridge(page, 'card_move', { boardId, card: number, to: 'doing', actor: 'feature-1' });
  await showTree(page);
  await ageAgents(page, 15);
  await expect.poll(async () => (await nodes(page)).find((node) => node.agent)?.fault).toBe(true);
  const held = (await nodes(page)).find((node) => node.agent)!;
  expect(held.live).toBe(false);
  await expect.poll(async () => (await stats(page)).animating).toBe(false);
  await page.mouse.move(held.sx, held.sy);
  await expect(page.locator('.board-tree__tip')).toContainText('feature-1 - quiet 15 min');
});
