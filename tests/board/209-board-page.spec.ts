/**
 * Covers: REQ-BOARD-001, REQ-BOARD-002, REQ-BOARD-003, REQ-BOARD-004,
 * REQ-BOARD-005, REQ-BOARD-006, REQ-BOARD-007, REQ-BOARD-010, REQ-BOARD-011
 */
import { expect, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { disableFSA, getWorkspaceStore, preloadModule } from '../helpers';

async function createBoard(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByTestId('nav-hierarchy').click();
  await page.getByTestId('add-board-btn').click();
  await expect(page.getByTestId('board-view')).toBeVisible();
}

async function addCard(
  page: import('@playwright/test').Page,
  column: 'todo' | 'doing' | 'waiting' | 'done',
  title: string,
) {
  await page.getByTestId(`board-add-card-${column}`).click();
  await page.locator('.board-add-input').last().fill(title);
  await page.locator('.board-add-input').last().press('Enter');
}

test('a new board opens immediately and normal pages retain canvas controls', async ({ page }) => {
  await createBoard(page);
  await expect(page.getByTestId('canvas-container')).toHaveCount(0);
  await expect(page.getByTestId('bottom-toolbar')).toHaveCount(0);
  await expect(page.getByTestId('zoom-bar')).toHaveCount(0);

  const state = await getWorkspaceStore(page);
  const section = state.workspace.sections[0];
  await page.getByTestId(`page-${section.pages[0].id}`).locator('.hierarchy-page__nav').click();
  await expect(page.getByTestId('canvas-container')).toBeVisible();
  await page.getByTestId('nav-text-tool').click();
  await expect(page.getByTestId('bottom-toolbar')).toBeVisible();
  await expect(page.getByTestId('zoom-bar')).toBeVisible();
});

test('quick add works in every column and Escape cancels it', async ({ page }) => {
  await createBoard(page);

  for (const [column, title] of [
    ['todo', 'Plan'],
    ['doing', 'Build'],
    ['waiting', 'Ask'],
    ['done', 'Ship'],
  ] as const) {
    await addCard(page, column, title);
    await expect(page.getByTestId(`board-column-${column}`)).toContainText(title);
  }

  await page.getByTestId('board-add-card-todo').click();
  await page.locator('.board-add-input').last().fill('Discard this');
  await page.locator('.board-add-input').last().press('Escape');
  await expect(page.getByText('Discard this')).toHaveCount(0);
});

test('pointer drag and keyboard movement update the stored column order', async ({ page }) => {
  await createBoard(page);
  await addCard(page, 'todo', 'First');
  await addCard(page, 'todo', 'Second');
  const first = page.getByTestId('board-card-1');
  const doing = page.getByTestId('board-column-doing');
  const firstBox = await first.boundingBox();
  const doingBox = await doing.boundingBox();
  if (!firstBox || !doingBox) throw new Error('board card layout missing');

  await first.dispatchEvent('pointerdown', {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: firstBox.x + 8,
    clientY: firstBox.y + 8,
    bubbles: true,
  });
  await first.dispatchEvent('pointermove', {
    pointerId: 1,
    pointerType: 'pen',
    clientX: doingBox.x + 20,
    clientY: doingBox.y + 70,
    bubbles: true,
  });
  await doing.dispatchEvent('pointerup', {
    pointerId: 1,
    pointerType: 'pen',
    clientX: doingBox.x + 20,
    clientY: doingBox.y + 70,
    bubbles: true,
  });
  await expect(doing).toContainText('First');

  await page.getByTestId('board-card-2').focus();
  await page.keyboard.press('Alt+ArrowUp');
  const state = await getWorkspaceStore(page);
  const cards = state.workspace.sections[0].pages.find((item) => item.kind === 'board')!.board!.cards;
  expect(cards.find((card) => card.number === 1)?.column).toBe('doing');
  expect(cards.filter((card) => card.column === 'todo').map((card) => card.order)).toEqual([0]);
});

test('waiting asks a question, the filter narrows cards, and keyboard movement works', async ({ page }) => {
  await createBoard(page);
  await addCard(page, 'doing', 'Review me');
  const card = page.getByTestId('board-card-1');
  await card.focus();
  await page.keyboard.press('Alt+ArrowRight');
  const question = page.getByRole('dialog', { name: 'Feedback question' });
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('board-column-doing')).toContainText('Review me');

  await card.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await question.locator('input').fill('Please approve the copy');
  await question.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByTestId('board-column-waiting')).toContainText('Needs you');
  await expect(page.getByTestId('board-column-waiting')).toContainText('Please approve the copy');
  await page.getByTestId('board-filter-needs-me').click();
  await expect(page.getByTestId('board-column-waiting')).toContainText('Review me');
  await expect(page.getByTestId('board-column-doing')).not.toContainText('Review me');
});

test('save and reopen keeps board cards, order, notes and checklist', async ({ page }) => {
  await disableFSA(page);
  await createBoard(page);
  await addCard(page, 'todo', 'Persisted');
  await page.getByTestId('board-card-1').click();
  const overlay = page.getByTestId('board-card-overlay');
  await overlay.getByLabel('Add checklist item').fill('One item');
  await overlay.getByLabel('Add checklist item').press('Enter');
  await overlay.getByLabel('Reply').fill('Saved note');
  await overlay.getByRole('button', { name: 'Reply', exact: true }).click();
  await overlay.getByLabel('Close card').click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('save-btn').click(),
  ]);
  const file = path.join(process.cwd(), 'test-results', 'board-persist.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await download.saveAs(file);

  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  await expect.poll(async () => {
    const state = await getWorkspaceStore(page);
    return state.workspace.sections.flatMap((section) => section.pages).some((item) => item.kind === 'board');
  }).toBe(true);
  const state = await getWorkspaceStore(page);
  const board = state.workspace.sections.flatMap((section) => section.pages).find((item) => item.kind === 'board')!.board!;
  expect(board.cards[0].title).toBe('Persisted');
  expect(board.cards[0].order).toBe(0);
  expect(board.cards[0].checklist[0].text).toBe('One item');
  expect(board.cards[0].notes[0].text).toBe('Saved note');
});

test('boardOps maintains numbering, ordering, questions and its 500-event cap', async ({ page }) => {
  await page.goto('/');
  await preloadModule(page, '/src/board/boardOps.ts');
  const result = await page.evaluate(() => {
    const ops = (window as any).__mods['/src/board/boardOps.ts'];
    let board = ops.createBoard();
    board = ops.createCard(board, { title: 'One' }, 'you', 1);
    board = ops.createCard(board, { title: 'Two' }, 'you', 2);
    const [one, two] = board.cards;
    board = ops.moveCard(board, { cardId: two.id, to: 'doing', index: 0 }, 'you', 3);
    board = ops.moveCard(board, { cardId: one.id, to: 'doing', index: 0 }, 'you', 4);
    const movedOut = ops.moveCard(board, { cardId: one.id, to: 'waiting', index: 0, question: 'Approve?' }, 'you', 5);
    const cleared = ops.moveCard(movedOut, { cardId: one.id, to: 'done', index: 0 }, 'you', 6);
    let capped = cleared;
    for (let index = 0; index < 510; index += 1) {
      capped = ops.updateCard(capped, { cardId: one.id, title: `Title ${index}` }, 'you', 7 + index);
    }
    let error = '';
    try {
      ops.moveCard(board, { cardId: two.id, to: 'waiting', index: 0 }, 'you', 8);
    } catch (caught: any) {
      error = caught.code;
    }
    return {
      numbers: board.cards.map((card: any) => card.number),
      doingOrders: board.cards.filter((card: any) => card.column === 'doing').map((card: any) => card.order),
      error,
      questionCleared: cleared.cards.find((card: any) => card.id === one.id).question,
      events: capped.events.length,
    };
  });

  expect(result.numbers).toEqual([1, 2]);
  expect(result.doingOrders).toEqual([0, 1]);
  expect(result.error).toBe('QUESTION_REQUIRED');
  expect(result.questionCleared).toBeUndefined();
  expect(result.events).toBe(500);
});
