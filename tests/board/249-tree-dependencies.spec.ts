/**
 * Test 249: card dependencies in the board tree.
 * Covers: REQ-BOARD-065, REQ-BOARD-066
 *
 * Owner request 2026-11-16: a dependency inside one topic is a straight arrow, a card
 * that is not ready carries a lock, and dependencies across topics only show on hover.
 * Driven through the store and `window.__POWERNOTE_BOARD_TREE__`.
 */
import { expect, test, type Page } from '@playwright/test';
import { stubBridgeUrl, waitForBridgeReady, waitForCanvasReady } from '../helpers';

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

interface Spec {
  title: string;
  labels?: string[];
  column?: 'todo' | 'doing' | 'waiting' | 'done';
  /** 1-based numbers of the cards this one waits on. */
  waitsOn?: number[];
}

async function seed(page: Page, boardId: string, specs: Spec[]) {
  await page.evaluate(({ id, list }) => {
    const store = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const perColumn: Record<string, number> = {};
    const base = Date.now() - 10_000_000;
    const cards = list.map((spec: any, index: number) => {
      const column = spec.column ?? 'todo';
      const order = perColumn[column] ?? 0;
      perColumn[column] = order + 1;
      return {
        id: `seed-${index + 1}`,
        number: index + 1,
        title: spec.title,
        description: '',
        column,
        order,
        labels: spec.labels ?? [],
        checklist: [],
        notes: [],
        question: column === 'waiting' ? 'Which way?' : undefined,
        dependsOn: spec.waitsOn?.map((number: number) => `seed-${number}`),
        createdBy: 'planner',
        createdAt: base + index,
        updatedAt: base + index,
      };
    });
    store.updateBoard(id, () => ({ cards, events: [], nextNumber: cards.length + 1, nextSeq: 1 }));
  }, { id: boardId, list: specs });
}

const showTree = async (page: Page) => {
  await page.getByTestId('board-view-tree').click();
  await expect(page.getByTestId('board-tree')).toBeVisible();
  await page.waitForFunction(() => ((window as any).__POWERNOTE_BOARD_TREE__?.nodes().length ?? 0) > 1);
};

const tree = <T>(page: Page, call: string) => page.evaluate((name) => (window as any).__POWERNOTE_BOARD_TREE__[name]() as T, call);
const nodes = (page: Page) => tree<any[]>(page, 'nodes');
const stats = (page: Page) => tree<{ frames: number; lastFrameMs: number }>(page, 'stats');

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

const indexOf = async (page: Page, number: number) =>
  (await nodes(page)).findIndex((node) => node.cardId === `seed-${number}`);

async function hoverCard(page: Page, number: number) {
  const node = (await nodes(page)).find((item) => item.cardId === `seed-${number}`);
  await page.mouse.move(node.sx, node.sy);
  await page.mouse.move(node.sx + 0.5, node.sy);
}

const SPECS: Spec[] = [
  { title: 'Parser', labels: ['eng'], column: 'done' }, // 1
  { title: 'Lexer', labels: ['eng'], waitsOn: [1] }, // 2: its blocker is finished
  { title: 'Emit', labels: ['eng'], waitsOn: [4] }, // 3
  { title: 'Optimise', labels: ['eng'] }, // 4
  { title: 'Screens', labels: ['ui'], waitsOn: [4] }, // 5: waits across topics
  { title: 'Question', labels: ['ui'], column: 'waiting' }, // 6
  { title: 'Polish', labels: ['eng'], waitsOn: [6] }, // 7: waits on a card that needs the owner
];

test('same-topic dependencies are arrows, finished ones and cross-topic ones are not', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, SPECS);
  await showTree(page);
  await settle(page);

  const optimise = await indexOf(page, 4);
  const emit = await indexOf(page, 3);
  // Only the unfinished same-topic dependency: Optimise must finish before Emit.
  expect(await tree(page, 'deps')).toEqual([{ from: optimise, to: emit }]);
  // Nothing is drawn at rest for the cross-topic ones.
  expect(await tree(page, 'hoverLinks')).toEqual([]);
});

test('a card that is not ready is locked; a card with cross-topic dependencies carries the marker', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, SPECS);
  await showTree(page);

  const byNumber = Object.fromEntries((await nodes(page)).filter((n) => n.cardId).map((n) => [n.cardId, n]));
  const locked = (n: number) => byNumber[`seed-${n}`].locked;
  expect([1, 2, 3, 4, 5, 6, 7].map(locked)).toEqual([false, false, true, false, true, false, true]);
  const cross = (n: number) => byNumber[`seed-${n}`].crossDeps;
  expect([1, 2, 3, 4, 5, 6, 7].map(cross)).toEqual([0, 0, 0, 1, 1, 1, 1]);
});

test('hovering a card draws its links, fades the rest and lists them in the tooltip', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, SPECS);
  await showTree(page);
  await settle(page);
  const polish = await indexOf(page, 7);
  const question = await indexOf(page, 6);

  await hoverCard(page, 7);
  await expect.poll(() => tree(page, 'hoverLinks')).toEqual([{ from: question, to: polish, accent: true }]);
  const tip = page.locator('.board-tree__tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Waits on');
  await expect(tip).toContainText('ui · #6 Question · Waiting');

  // A card with dependencies both ways: one in its own topic, one across.
  await hoverCard(page, 4);
  await expect.poll(async () => (await tree<any[]>(page, 'hoverLinks')).length).toBe(2);
  expect((await tree<any[]>(page, 'hoverLinks')).every((link) => !link.accent)).toBe(true);
  await expect(tip).toContainText('Waited on by');
  await expect(tip).toContainText('ui · #5 Screens · To do');
  await expect(tip).toContainText('eng · #3 Emit · To do');

  // Leaving clears them.
  const canvas = (await page.getByTestId('board-tree-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + 3, canvas.y + canvas.height - 3);
  await expect.poll(() => tree(page, 'hoverLinks')).toEqual([]);
  await expect(tip).toBeHidden();
});

test('dependencies add no frames at rest', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, SPECS);
  await showTree(page);
  await settle(page);
  const before = await stats(page);
  await page.waitForTimeout(700);
  expect((await stats(page)).frames).toBe(before.frames);

  // Hovering draws a frame or two, then nothing again.
  await hoverCard(page, 7);
  await settle(page);
  const hovered = await stats(page);
  await page.waitForTimeout(700);
  expect((await stats(page)).frames).toBe(hovered.frames);
});

test('changing a dependency changes the picture', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, SPECS);
  await showTree(page);
  await settle(page);
  expect(await tree<any[]>(page, 'deps')).toHaveLength(1);

  // Finishing Optimise unlocks Emit and removes the arrow.
  await page.evaluate((id) => {
    const store = (window as any).__POWERNOTE_STORES__.workspace.getState();
    store.updateBoard(id, (board: any) => ({
      ...board,
      cards: board.cards.map((card: any) => (card.id === 'seed-4' ? { ...card, column: 'done' } : card)),
    }));
  }, boardId);
  await expect.poll(async () => (await tree<any[]>(page, 'deps')).length).toBe(0);
  expect((await nodes(page)).find((node) => node.cardId === 'seed-3').locked).toBe(false);
});
