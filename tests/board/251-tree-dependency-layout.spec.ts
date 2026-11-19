/**
 * Test 251: dependency arrows in the board tree run outward between rings.
 * Covers: REQ-BOARD-067
 *
 * Owner report 2026-11-19: same-topic arrows ran over other nodes because cards were packed
 * in column order. A card that waits on a card of its topic now sits in a ring further out
 * than that card. Driven through the store and `window.__POWERNOTE_BOARD_TREE__`.
 */
import { expect, test, type Page } from '@playwright/test';
import { stubBridgeUrl, waitForBridgeReady, waitForCanvasReady } from '../helpers';

const R_CARD = 262;
const DR = 38;

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

interface Node { cardId?: string; kind: string; parent: number; x: number; y: number; r: number; topic: string | null }

const ringOf = (node: Node) => Math.round((Math.hypot(node.x, node.y) - R_CARD) / DR);

/** Distance from a point to a segment. */
function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Every drawn arrow, with the cards it runs over. */
async function arrows(page: Page) {
  const all = await tree<Node[]>(page, 'nodes');
  const deps = await tree<Array<{ from: number; to: number }>>(page, 'deps');
  return {
    all,
    list: deps.map(({ from, to }) => {
      const a = all[from];
      const b = all[to];
      const crossed = all
        .map((node, index) => ({ node, index }))
        .filter(({ node, index }) => index !== from && index !== to && node.kind === 'card'
          && distanceToSegment(node.x, node.y, a.x, a.y, b.x, b.y) < node.r + 2);
      return { from, to, a, b, crossed: crossed.map(({ node }) => node.cardId) };
    }),
  };
}

// Dependents are listed BEFORE their blockers, so column order disagrees with the chains.
const TOPIC: Spec[] = (() => {
  const specs: Spec[] = [];
  const add = (title: string, waitsOn?: number[]) => specs.push({ title, labels: ['eng'], waitsOn });
  add('Chain A4', [5]); // 1
  add('Chain B4', [6]); // 2
  add('Fan 1', [15]); // 3
  add('Fan 2', [15]); // 4
  add('Chain A3', [9]); // 5
  add('Chain B3', [10]); // 6
  add('Fan 3', [15]); // 7
  add('Free 1'); // 8
  add('Chain A2', [13]); // 9
  add('Chain B2', [14]); // 10
  add('Free 2'); // 11
  add('Free 3'); // 12
  add('Chain A1'); // 13
  add('Chain B1'); // 14
  add('Fan root'); // 15
  for (let n = 4; n <= 8; n++) add(`Free ${n}`); // 16..20
  return specs;
})();

test('a waiting card sits one ring beyond its blocker and no arrow crosses a node', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, TOPIC);
  await showTree(page);

  const { all, list } = await arrows(page);
  expect(list).toHaveLength(9); // two chains of three links and a fan of three
  for (const arrow of list) {
    expect(ringOf(arrow.b), `${arrow.b.cardId} is further out than ${arrow.a.cardId}`).toBeGreaterThan(ringOf(arrow.a));
    expect(ringOf(arrow.b) - ringOf(arrow.a), `${arrow.a.cardId} -> ${arrow.b.cardId} spans one ring`).toBe(1);
    expect(arrow.crossed, `${arrow.a.cardId} -> ${arrow.b.cardId} runs over other nodes`).toEqual([]);
  }
  expect(all.filter((node) => node.kind === 'card')).toHaveLength(20);
  for (let a = 0; a < all.length; a++) {
    for (let b = a + 1; b < all.length; b++) {
      expect(Math.hypot(all[a].x - all[b].x, all[a].y - all[b].y)).toBeGreaterThan(all[a].r + all[b].r);
    }
  }
});

test('the tree line to a waiting card comes from the card it waits on', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, TOPIC);
  await showTree(page);

  const { all, list } = await arrows(page);
  expect(list.length).toBeGreaterThan(0);
  for (const arrow of list) {
    // Every blocker here is exactly one ring in, so it is the parent.
    expect(all[arrow.b.parent], `${arrow.b.cardId} hangs from ${arrow.a.cardId}`).toBe(arrow.a);
  }
});

test('many topics: no same-topic arrow crosses another node', async ({ page }) => {
  const boardId = await openBoard(page);
  const specs: Spec[] = [];
  let state = 7;
  const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let index = 0; index < 80; index++) specs.push({ title: `Card ${index + 1}`, labels: [`topic-${index % 15}`] });
  // A card waits only on a later card of its own topic, so there are no cycles.
  let made = 0;
  for (let attempt = 0; made < 25 && attempt < 5000; attempt++) {
    const from = Math.floor(random() * 80);
    const to = from + 15 * (1 + Math.floor(random() * 3));
    if (to >= 80 || specs[from].waitsOn) continue;
    specs[from].waitsOn = [to + 1];
    made++;
  }
  expect(made).toBe(25);
  await seed(page, boardId, specs);
  await showTree(page);

  const { list } = await arrows(page);
  expect(list).toHaveLength(25);
  for (const arrow of list) {
    expect(ringOf(arrow.b)).toBeGreaterThan(ringOf(arrow.a));
    expect(arrow.crossed, `${arrow.a.cardId} -> ${arrow.b.cardId} runs over other nodes`).toEqual([]);
  }
});
