/**
 * Test 244: the board as a tree.
 * Covers: REQ-BOARD-046, REQ-BOARD-047, REQ-BOARD-048, REQ-BOARD-049, REQ-BOARD-050,
 * REQ-BOARD-051, REQ-BOARD-052, REQ-BOARD-053, REQ-BOARD-060
 *
 * Owner request 2026-11-14: an overview of the board where topics ring the centre
 * and each topic's cards grow outward in time order, so what is done, in progress,
 * waiting for the owner and queued reads at a glance. Driven through the stores,
 * the bridge and `window.__POWERNOTE_BOARD_TREE__`.
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

interface Spec {
  title: string;
  labels?: string[];
  column?: 'todo' | 'doing' | 'waiting' | 'done';
  /** Last update; for done cards that is when they finished. */
  at?: number;
  assignee?: string;
  check?: boolean[];
}

/** Writes a whole board straight into the store, for shapes the bridge makes slow to reach. */
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
        assignee: spec.assignee,
        labels: spec.labels ?? [],
        checklist: (spec.check ?? []).map((done: boolean, item: number) => ({ id: `s${index}-${item}`, text: `Step ${item + 1}`, done })),
        notes: [],
        question: column === 'waiting' ? 'Which way?' : undefined,
        createdBy: 'planner',
        createdAt: base + index,
        updatedAt: spec.at ?? base + index,
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

const nodes = (page: Page) => page.evaluate(() => (window as any).__POWERNOTE_BOARD_TREE__.nodes() as any[]);
const stats = (page: Page) =>
  page.evaluate(() => (window as any).__POWERNOTE_BOARD_TREE__.stats() as { frames: number; layouts: number; lastFrameMs: number });
const view = (page: Page) =>
  page.evaluate(() => (window as any).__POWERNOTE_BOARD_TREE__.view() as { k: number; x: number; y: number });
const radius = (node: any) => Math.hypot(node.x, node.y);

/** Waits until the animations have ended: no frame drawn across a short pause. */
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

test('the Cards | Tree switch swaps the columns for the tree and is remembered', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, [{ title: 'One', labels: ['engine'] }]);

  await expect(page.getByTestId('board-view-cards')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('board-column-todo')).toBeVisible();
  await expect(page.getByTestId('board-tree')).toHaveCount(0);

  await showTree(page);
  await expect(page.getByTestId('board-view-tree')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('board-column-todo')).toHaveCount(0);
  await expect(page.getByTestId('board-tree-canvas')).toHaveAttribute('aria-label', /1 topic, 1 card/);
  // The rest of the board page keeps working beside the tree.
  await expect(page.getByTestId('board-card-count')).toBeVisible();

  expect(await page.evaluate(() => localStorage.getItem('powerscroll-board-view'))).toBe('tree');
  await openBoard(page);
  await expect(page.getByTestId('board-tree')).toBeVisible();
  await expect(page.getByTestId('board-column-todo')).toHaveCount(0);

  await page.getByTestId('board-view-cards').click();
  await expect(page.getByTestId('board-tree')).toHaveCount(0);
  await expect(page.getByTestId('board-column-todo')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__POWERNOTE_BOARD_TREE__)).toBeUndefined();
});

test('one topic per label in first-used order, "No label" last, and the hub', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, [
    { title: 'Parser', labels: ['engine'] },
    { title: 'Screens', labels: ['UI', 'engine'] },
    { title: 'Loose' },
    { title: 'More screens', labels: ['ui'] },
    { title: 'Gone', labels: ['old'] },
  ]);
  await page.evaluate((id) => {
    const store = (window as any).__POWERNOTE_STORES__.workspace.getState();
    store.updateBoard(id, (board: any) => ({
      ...board,
      cards: board.cards.map((card: any) => (card.title === 'Gone' ? { ...card, archivedAt: Date.now() } : card)),
    }));
  }, boardId);
  await showTree(page);

  const all = await nodes(page);
  expect(all.filter((node) => node.kind === 'hub')).toHaveLength(1);
  expect(all.filter((node) => node.kind === 'topic').map((node) => node.topic)).toEqual(['engine', 'UI', 'No label']);
  // A card's topic is its first label; the archived card is not drawn.
  const topicOf = (title: string) => all.find((node) => node.cardId === `seed-${['Parser', 'Screens', 'Loose', 'More screens'].indexOf(title) + 1}`)?.topic;
  expect(topicOf('Parser')).toBe('engine');
  expect(topicOf('Screens')).toBe('UI');
  expect(topicOf('More screens')).toBe('UI');
  expect(topicOf('Loose')).toBe('No label');
  expect(all.some((node) => node.cardId === 'seed-5')).toBe(false);
});

test('distance from the centre is time: done, then waiting and in progress, then queued', async ({ page }) => {
  const boardId = await openBoard(page);
  const t = Date.now() - 5_000_000;
  await seed(page, boardId, [
    { title: 'Todo 1', labels: ['a'] },
    { title: 'Done late', labels: ['a'], column: 'done', at: t + 3000 },
    { title: 'Doing', labels: ['a'], column: 'doing', assignee: 'agent-one', check: [true, false], at: Date.now() },
    { title: 'Done early', labels: ['a'], column: 'done', at: t + 1000 },
    { title: 'Waiting', labels: ['a'], column: 'waiting', assignee: 'agent-two' },
    { title: 'Todo 2', labels: ['a'] },
    { title: 'Done middle', labels: ['a'], column: 'done', at: t + 2000 },
  ]);
  await showTree(page);
  const all = await nodes(page);
  const at = (title: string, index: number) => all.find((node) => node.cardId === `seed-${index}`)!;

  const early = radius(at('Done early', 4));
  const middle = radius(at('Done middle', 7));
  const late = radius(at('Done late', 2));
  expect(early).toBeLessThanOrEqual(middle + 0.01);
  expect(middle).toBeLessThanOrEqual(late + 0.01);

  const current = [radius(at('Doing', 3)), radius(at('Waiting', 5))];
  const queued = [radius(at('Todo 1', 1)), radius(at('Todo 2', 6))];
  expect(late).toBeLessThanOrEqual(Math.min(...current) + 0.01);
  expect(Math.max(...current)).toBeLessThanOrEqual(Math.min(...queued) + 0.01);
  expect(Math.max(...queued)).toBeGreaterThan(early);
  // Waiting comes before in progress; queued cards follow the board's order.
  expect(radius(at('Waiting', 5))).toBeLessThanOrEqual(radius(at('Doing', 3)) + 0.01);
  expect(radius(at('Todo 1', 1))).toBeLessThanOrEqual(radius(at('Todo 2', 6)) + 0.01);

  expect(at('Doing', 3)).toMatchObject({ state: 'doing', fault: false });
  expect(at('Todo 1', 1)).toMatchObject({ state: 'todo', fault: false });
});

test('older finished cards fold into one +N node and far queued cards into another', async ({ page }) => {
  const boardId = await openBoard(page);
  const t = Date.now() - 5_000_000;
  const specs: Spec[] = [];
  for (let index = 0; index < 10; index++) specs.push({ title: `Done ${index}`, labels: ['x'], column: 'done', at: t + index });
  for (let index = 0; index < 12; index++) specs.push({ title: `Todo ${index}`, labels: ['x'] });
  await seed(page, boardId, specs);
  await showTree(page);

  const all = await nodes(page);
  const fold = all.filter((node) => node.kind === 'fold');
  const more = all.filter((node) => node.kind === 'more');
  expect(fold).toHaveLength(1);
  expect(fold[0].count).toBe(4);
  expect(more).toHaveLength(1);
  expect(more[0].count).toBe(4);
  expect(all.filter((node) => node.kind === 'card' && node.state === 'done')).toHaveLength(6);
  expect(all.filter((node) => node.kind === 'card' && node.state === 'todo')).toHaveLength(8);
  // The fold sits nearest the centre of the branch, the rest at the tip; the six shown are the latest finished.
  expect(radius(fold[0])).toBeLessThanOrEqual(Math.min(...all.filter((n) => n.state === 'done').map(radius)) + 0.01);
  expect(radius(more[0])).toBeGreaterThanOrEqual(Math.max(...all.filter((n) => n.state === 'todo').map(radius)) - 0.01);
  expect(all.some((node) => node.cardId === 'seed-1')).toBe(false);
  expect(all.some((node) => node.cardId === 'seed-10')).toBe(true);
});

test('waiting and quiet cards are faults, and "N need you" walks through them', async ({ page }) => {
  const boardId = await openBoard(page);
  const longAgo = Date.now() - 11 * 60_000;
  await seed(page, boardId, [
    { title: 'Needs an answer', labels: ['a'], column: 'waiting', assignee: 'agent-one' },
    { title: 'Fine', labels: ['b'], column: 'doing', assignee: 'agent-two', at: Date.now() },
    { title: 'Gone quiet', labels: ['c'], column: 'doing', assignee: 'agent-three', at: longAgo },
    { title: 'Mine', labels: ['d'], column: 'doing', assignee: 'you', at: longAgo },
    { title: 'Queued', labels: ['a'] },
  ]);
  await showTree(page);

  const all = await nodes(page);
  const faults = all.filter((node) => node.fault).map((node) => node.cardId ?? node.topic);
  expect(faults.sort()).toEqual(['a', 'c', 'seed-1', 'seed-3'].sort());
  await expect(page.getByTestId('board-tree-need')).toHaveText('2 need you');

  const canvas = (await page.getByTestId('board-tree-canvas').boundingBox())!;
  const centre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  const before = await view(page);
  const focused = async (cardId: string) => {
    await settle(page);
    const node = (await nodes(page)).find((item) => item.cardId === cardId)!;
    expect(Math.abs(node.sx - centre.x)).toBeLessThan(3);
    expect(Math.abs(node.sy - centre.y)).toBeLessThan(3);
  };

  await page.getByTestId('board-tree-need').click();
  await focused('seed-1');
  expect(await view(page)).not.toEqual(before);
  await page.getByTestId('board-tree-need').click();
  await focused('seed-3');
  await page.getByTestId('board-tree-need').click();
  await focused('seed-1');

  // Answering the waiting card leaves the quiet one.
  await runBridge(page, 'card_move', { boardId, card: 1, to: 'doing', actor: 'agent-one' });
  await expect(page.getByTestId('board-tree-need')).toHaveText('1 need you');
});

test('the tree updates live, and a note does not redraw it', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'A', labels: ['x'], checklist: ['one', 'two'], actor: 'planner' });
  await runBridge(page, 'card_create', { boardId, title: 'B', labels: ['x'], actor: 'planner' });
  await showTree(page);
  await settle(page);

  let layouts = (await stats(page)).layouts;
  const countNodes = async () => (await nodes(page)).length;
  const cardIds = async () => (await nodes(page)).filter((node) => node.kind === 'card');

  // Adding a card adds a node.
  const before = await countNodes();
  await runBridge(page, 'card_create', { boardId, title: 'C', labels: ['x'], actor: 'planner' });
  await expect.poll(countNodes).toBe(before + 1);
  expect((await stats(page)).layouts).toBe(layouts + 1);
  layouts += 1;

  // Ticking a checklist item changes the card's progress.
  await runBridge(page, 'card_check', { boardId, card: 1, item: 1, done: true, actor: 'planner' });
  await expect.poll(async () => (await stats(page)).layouts).toBe(layouts + 1);
  layouts += 1;

  // Moving a card to done changes its state.
  await runBridge(page, 'card_move', { boardId, card: 2, to: 'done', actor: 'planner' });
  await expect.poll(async () => (await cardIds()).filter((node) => node.state === 'done').length).toBe(1);
  expect((await stats(page)).layouts).toBe(layouts + 1);
  layouts += 1;

  // A note changes the board but not the picture.
  await settle(page);
  const frames = (await stats(page)).frames;
  await runBridge(page, 'card_note', { boardId, card: 1, text: 'Looking good', actor: 'planner' });
  await page.waitForTimeout(500);
  expect((await stats(page)).layouts).toBe(layouts);
  expect((await stats(page)).frames).toBe(frames);
});

test('clicking a card node opens the card', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, [
    { title: 'Parser', labels: ['engine'] },
    { title: 'Screens', labels: ['ui'], column: 'doing', assignee: 'agent-one' },
  ]);
  await showTree(page);
  await settle(page);
  await page.getByTestId('board-tree').scrollIntoViewIfNeeded();
  const node = (await nodes(page)).find((item) => item.cardId === 'seed-2')!;
  await page.mouse.move(node.sx, node.sy);
  await expect(page.locator('.board-tree__tip')).toContainText('#2 Screens');
  await page.mouse.click(node.sx, node.sy);
  await expect(page.getByTestId('board-card-overlay')).toBeVisible();
  await expect(page.getByTestId('board-card-overlay')).toContainText('#2');
});

test('a topic click zooms to its branch; zooming by the user pins the view against live changes', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, [
    { title: 'Parser', labels: ['engine'] },
    { title: 'Screens', labels: ['ui'] },
    { title: 'Loose' },
  ]);
  await showTree(page);
  await settle(page);

  const fitted = await view(page);
  const topic = (await nodes(page)).find((node) => node.kind === 'topic' && node.topic === 'ui')!;
  await page.mouse.click(topic.sx, topic.sy);
  await expect.poll(async () => (await view(page)).k).toBeGreaterThan(fitted.k);

  await page.getByTestId('board-tree-fit').click();
  await settle(page);
  expect(await view(page)).toEqual(fitted);

  const canvas = (await page.getByTestId('board-tree-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2 + 40, canvas.y + canvas.height / 2 + 20);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await view(page)).k).toBeGreaterThan(fitted.k);
  await settle(page);
  const zoomed = await view(page);

  const layouts = (await stats(page)).layouts;
  await runBridge(page, 'card_create', { boardId, title: 'Fresh', labels: ['ui'], actor: 'planner' });
  await expect.poll(async () => (await stats(page)).layouts).toBe(layouts + 1);
  await settle(page);
  expect(await view(page)).toEqual(zoomed);

  // Fit takes the whole tree back, and it follows the next change again.
  await page.getByTestId('board-tree-canvas').focus();
  await page.keyboard.press('0');
  await settle(page);
  expect((await view(page)).k).toBeLessThan(zoomed.k);
});

test('zoom is fine: a wheel notch is 5%, one event is capped, the keys step 10%', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, [
    { title: 'Parser', labels: ['engine'] },
    { title: 'Screens', labels: ['ui'] },
    { title: 'Loose' },
  ]);
  await showTree(page);
  await settle(page);

  /** Reads k once the view tween is over: two consecutive reads agree. */
  const steadyK = async () => {
    let previous = -1;
    for (let attempt = 0; attempt < 40; attempt++) {
      const { k } = await view(page);
      if (k === previous) return k;
      previous = k;
      await page.waitForTimeout(200);
    }
    throw new Error('the zoom never came to rest');
  };

  const canvas = (await page.getByTestId('board-tree-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);

  const start = await steadyK();
  await page.mouse.wheel(0, -100);
  const notchIn = (await steadyK()) / start;
  expect(notchIn).toBeGreaterThan(1.04);
  expect(notchIn).toBeLessThan(1.06);

  await page.mouse.wheel(0, 100);
  const back = await steadyK();
  expect(Math.abs(back / start - 1)).toBeLessThan(0.01);

  await page.mouse.wheel(0, -1000);
  const burst = (await steadyK()) / back;
  expect(burst).toBeGreaterThan(1);
  expect(burst).toBeLessThan(1.07);

  // Reset to the fitted view, then the keys.
  await page.getByTestId('board-tree-fit').click();
  const keyStart = await steadyK();
  await page.getByTestId('board-tree-canvas').focus();
  await page.keyboard.press('+');
  const plus = (await steadyK()) / keyStart;
  expect(plus).toBeGreaterThan(1.09);
  expect(plus).toBeLessThan(1.11);
  await page.keyboard.press('-');
  expect(Math.abs((await steadyK()) / keyStart - 1)).toBeLessThan(0.01);
});

test('the tree draws nothing at rest', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, [
    { title: 'Parser', labels: ['engine'], column: 'doing', assignee: 'agent-one', check: [true, false] },
    { title: 'Screens', labels: ['ui'] },
  ]);
  await showTree(page);
  await settle(page);
  const first = await stats(page);
  await page.waitForTimeout(600);
  const second = await stats(page);
  expect(second.frames).toBe(first.frames);
  expect(second.layouts).toBe(first.layouts);
  expect(first.frames).toBeGreaterThan(0);
});

test('1,000 cards in 40 labels stay fast and still draw nothing at rest', async ({ page }) => {
  const boardId = await openBoard(page);
  const t = Date.now() - 5_000_000;
  const specs: Spec[] = [];
  for (let label = 0; label < 40; label++) {
    for (let index = 0; index < 25; index++) {
      const column = index < 8 ? 'done' : index === 8 ? 'doing' : index === 9 && label % 10 === 0 ? 'waiting' : 'todo';
      specs.push({
        title: `Card ${label}-${index}`,
        labels: [`label-${label}`],
        column,
        at: t + index,
        assignee: column === 'todo' || column === 'done' ? undefined : `agent-${label}`,
        check: [true, false, false],
      });
    }
  }
  await seed(page, boardId, specs);
  await showTree(page);
  await settle(page);

  // Force a few full redraws with the whole tree in view.
  const canvas = (await page.getByTestId('board-tree-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  for (let index = 0; index < 6; index++) await page.mouse.wheel(0, index % 2 ? 120 : -120);
  await settle(page);
  const result = await stats(page);
  console.log(`1000 cards: lastFrameMs=${result.lastFrameMs.toFixed(2)} frames=${result.frames}`);
  expect(result.lastFrameMs).toBeLessThan(50);
  expect((await nodes(page)).filter((node) => node.kind === 'topic')).toHaveLength(40);

  await page.waitForTimeout(600);
  expect((await stats(page)).frames).toBe(result.frames);
});
