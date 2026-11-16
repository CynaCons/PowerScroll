/**
 * Test 248: card dependencies in the card details and on the card face.
 * Covers: REQ-BOARD-063, REQ-BOARD-064
 *
 * Owner request 2026-11-16: define dependencies between board items so a
 * sequence can be coded. Seeded through the workspace store.
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
  column?: 'todo' | 'doing' | 'waiting' | 'done';
  assignee?: string;
  /** Numbers of the cards it waits on. */
  deps?: number[];
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
        assignee: spec.assignee,
        labels: [],
        checklist: [],
        notes: [],
        question: column === 'waiting' ? 'Which way?' : undefined,
        dependsOn: spec.deps?.map((number: number) => `seed-${number}`),
        createdBy: 'planner',
        createdAt: base + index,
        updatedAt: base + index,
      };
    });
    store.updateBoard(id, () => ({ cards, events: [], nextNumber: cards.length + 1, nextSeq: 1 }));
  }, { id: boardId, list: specs });
}

const boardCards = (page: Page) =>
  page.evaluate(() => {
    const state = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const found = state.workspace.sections.flatMap((s: any) => s.pages).find((p: any) => p.id === state.activePageId);
    return found.board.cards as any[];
  });

const open = async (page: Page, number: number) => {
  await page.getByTestId(`board-card-${number}`).click();
  await expect(page.getByTestId('board-card-overlay')).toBeVisible();
};

test('card faces show what they wait on, and stuck chains in the accent colour', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, [
    { title: 'Schema', column: 'doing', assignee: 'sonnet-2' },
    { title: 'Pick a verb', column: 'waiting' },
    { title: 'API', deps: [1] },
    { title: 'Docs', deps: [2, 1] },
    { title: 'Free card' },
    { title: 'Finished dep', column: 'done' },
    { title: 'Ready after done', deps: [6] },
  ]);

  await expect(page.getByTestId('board-card-waits-3')).toHaveText('Waits on #1');
  await expect(page.getByTestId('board-card-waits-3')).not.toHaveClass(/stuck/);
  await expect(page.getByTestId('board-card-waits-4')).toHaveText('Stuck: #2 needs you');
  await expect(page.getByTestId('board-card-waits-4')).toHaveClass(/board-card__waits--stuck/);
  const colour = await page.getByTestId('board-card-waits-4').evaluate((el) => getComputedStyle(el).color);
  expect(colour).toBe('rgb(180, 85, 45)');
  await expect(page.getByTestId('board-card-waits-5')).toHaveCount(0);
  await expect(page.getByTestId('board-card-waits-7')).toHaveCount(0);
  await expect(page.getByTestId('board-card-waits-1')).toHaveCount(0);
});

test('the details list what a card waits on and what waits on it, rows open the card', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, [
    { title: 'Schema', column: 'doing', assignee: 'sonnet-2' },
    { title: 'API', deps: [1] },
    { title: 'UI', deps: [2] },
  ]);

  await open(page, 2);
  const row = page.getByTestId('card-dependencies').getByTestId('card-dep-1');
  await expect(row).toContainText('#1');
  await expect(row).toContainText('Schema');
  await expect(row).toContainText('In progress');
  await expect(row).toContainText('sonnet-2');
  await expect(page.getByTestId('card-dep-blocked')).toContainText('Can’t start yet: waits on #1');
  await expect(page.getByTestId('card-dep-dependents').getByTestId('card-dep-3')).toContainText('UI');

  await page.getByTestId('card-dep-dependents').getByTestId('card-dep-3').locator('button').first().click();
  await expect(page.getByRole('dialog', { name: 'Card 3' })).toBeVisible();
  await expect(page.getByTestId('card-dep-blocked')).toContainText('waits on #2');
});

test('adding by number or title, loops greyed with the reason, removing', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, [
    { title: 'Schema' },
    { title: 'API', deps: [1] },
    { title: 'Search notes' },
  ]);

  // Card 1 can't wait on 2 (which waits on 1) or on itself; 3 is fine.
  await open(page, 1);
  const input = page.getByTestId('card-dep-input');
  await input.fill('API');
  const loop = page.getByTestId('card-dep-option-2');
  await expect(loop).toBeDisabled();
  await expect(loop).toContainText('already waits on #1, so this would make a loop');
  await loop.click({ force: true });
  expect((await boardCards(page))[0].dependsOn).toBeUndefined();

  await input.fill('#1');
  await expect(page.getByTestId('card-dep-option-1')).toHaveCount(0);

  await input.fill('3');
  await page.getByTestId('card-dep-option-3').click();
  await expect(page.getByTestId('card-dep-list').getByTestId('card-dep-3')).toContainText('Search notes');
  expect((await boardCards(page))[0].dependsOn).toEqual(['seed-3']);
  await expect(page.getByTestId('board-card-waits-1')).toHaveText('Waits on #3');

  // By title, with Enter.
  await input.fill('schema');
  await expect(page.getByTestId('card-dep-option-1')).toHaveCount(0);

  await page.getByRole('button', { name: 'Stop waiting on #3' }).click();
  await expect(page.getByTestId('card-dep-list')).toHaveCount(0);
  expect((await boardCards(page))[0].dependsOn).toBeUndefined();
  await expect(page.getByTestId('board-card-waits-1')).toHaveCount(0);
});

test('Start anyway moves the card to In progress and the line goes', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, [
    { title: 'Schema', column: 'doing' },
    { title: 'API', deps: [1] },
  ]);

  await open(page, 2);
  await page.getByTestId('card-dep-start').click();
  await expect.poll(async () => (await boardCards(page))[1].column).toBe('doing');
  await expect(page.getByTestId('card-dep-start')).toHaveCount(0);
  // Still waits on #1: it was started by choice, not because it became ready.
  await expect(page.getByTestId('card-dep-blocked')).toContainText('Can’t start yet');
});

test('moving a card that is not ready into In progress asks first', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, [
    { title: 'Schema', column: 'doing' },
    { title: 'API', deps: [1] },
  ]);

  const messages: string[] = [];
  let answer = false;
  page.on('dialog', async (dialog) => {
    messages.push(dialog.message());
    if (answer) await dialog.accept();
    else await dialog.dismiss();
  });

  const card = page.getByTestId('board-card-2');
  await card.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toBe('#2 still waits on #1. Start anyway?');
  expect((await boardCards(page))[1].column).toBe('todo');

  answer = true;
  await card.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(async () => (await boardCards(page))[1].column).toBe('doing');
  expect(messages).toHaveLength(2);
});

test('assigning a card that is not ready asks first', async ({ page }) => {
  const boardId = await openBoard(page);
  await seed(page, boardId, [
    { title: 'Schema', column: 'doing' },
    { title: 'API', deps: [1] },
  ]);

  const messages: string[] = [];
  page.on('dialog', async (dialog) => {
    messages.push(dialog.message());
    await dialog.dismiss();
  });
  await open(page, 2);
  await page.getByTestId('card-assignee').click();
  await page.getByRole('searchbox', { name: 'Assignee name' }).or(page.getByLabel('Assignee name')).fill('bot-1');
  await page.getByLabel('Assignee name').press('Enter');
  await expect.poll(() => messages.length).toBe(1);
  expect((await boardCards(page))[1].assignee).toBeUndefined();
});
