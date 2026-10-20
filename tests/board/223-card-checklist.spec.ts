/**
 * Test 223: a card's checklist of subtasks - edit in place, reorder, progress.
 * Covers: REQ-BOARD-030, REQ-BOARD-031, REQ-BOARD-032
 *
 * Owner request 2026-10-20: "within a powerboard, we need to be able to have a
 * ticket, with subtasks inside ... Checklist of tasks. Like Trello."
 */
import { expect, test, type Page } from '@playwright/test';
import { runBridge, stubBridgeUrl, waitForBridgeReady, waitForCanvasReady } from '../helpers';

const ITEMS = ['Write spec', 'Build it', 'Test it', 'Ship it'];

async function openCard(page: Page, checklist = ITEMS) {
  await stubBridgeUrl(page);
  await page.goto('/');
  await waitForCanvasReady(page);
  await waitForBridgeReady(page);
  await page.getByTestId('nav-hierarchy').click();
  await page.getByTestId('add-board-btn').click();
  await expect(page.getByTestId('board-view')).toBeVisible();
  await page.getByTestId('nav-hierarchy').click();
  const boardId = await page.evaluate(
    () => (window as any).__POWERNOTE_STORES__.workspace.getState().activePageId as string,
  );
  await runBridge(page, 'card_create', { boardId, title: 'Feature', checklist, actor: 'planner' });
  return boardId;
}

function boardState(page: Page, boardId: string) {
  return page.evaluate((id) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const board = ws.workspace.sections.flatMap((s: any) => s.pages).find((p: any) => p.id === id).board;
    return {
      items: board.cards[0].checklist.map((item: any) => item.text) as string[],
      events: board.events.map((event: any) => event.type) as string[],
    };
  }, boardId);
}

function rowTexts(page: Page) {
  return page.getByTestId('card-checklist').locator('.board-checklist__text');
}

test('clicking an item edits it in place; Enter saves once, Escape cancels without closing the card', async ({ page }) => {
  const boardId = await openCard(page);
  await page.getByTestId('board-card-1').click();
  const overlay = page.getByTestId('board-card-overlay');
  const before = (await boardState(page, boardId)).events.length;

  await overlay.getByRole('button', { name: 'Build it', exact: true }).click();
  const input = overlay.getByLabel('Edit Build it');
  await expect(input).toBeFocused();
  await input.fill('Build the parser');
  await input.press('Enter');
  await expect(overlay.getByRole('button', { name: 'Build the parser', exact: true })).toBeVisible();
  let state = await boardState(page, boardId);
  expect(state.items).toEqual(['Write spec', 'Build the parser', 'Test it', 'Ship it']);
  expect(state.events.slice(before)).toEqual(['updated']);

  // Escape cancels the edit and leaves the card open.
  await overlay.getByRole('button', { name: 'Test it', exact: true }).click();
  await overlay.getByLabel('Edit Test it').fill('Something else');
  await page.keyboard.press('Escape');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole('button', { name: 'Test it', exact: true })).toBeVisible();

  // Blank text saves nothing; leaving the input with new text saves it.
  await overlay.getByRole('button', { name: 'Ship it', exact: true }).click();
  await overlay.getByLabel('Edit Ship it').fill('   ');
  await overlay.getByLabel('Edit Ship it').press('Enter');
  await overlay.getByRole('button', { name: 'Write spec', exact: true }).click();
  await overlay.getByLabel('Edit Write spec').fill('Write the spec');
  await overlay.getByLabel('Add checklist item').click();
  state = await boardState(page, boardId);
  expect(state.items).toEqual(['Write the spec', 'Build the parser', 'Test it', 'Ship it']);
  expect(state.events.slice(before)).toEqual(['updated', 'updated']);
});

test('Alt+Up / Alt+Down move an item and keep focus on it', async ({ page }) => {
  const boardId = await openCard(page);
  await page.getByTestId('board-card-1').click();
  const overlay = page.getByTestId('board-card-overlay');

  const box = overlay.getByRole('checkbox', { name: 'Write spec' });
  await box.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(rowTexts(page)).toHaveText(['Build it', 'Test it', 'Write spec', 'Ship it']);
  await expect(box).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');
  expect((await boardState(page, boardId)).items).toEqual(['Build it', 'Write spec', 'Test it', 'Ship it']);

  // The first row cannot move further up.
  await overlay.getByRole('checkbox', { name: 'Build it' }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  expect((await boardState(page, boardId)).items).toEqual(['Build it', 'Write spec', 'Test it', 'Ship it']);
});

test('dragging the grip handle reorders items and the order is saved', async ({ page }) => {
  const boardId = await openCard(page);
  await page.getByTestId('board-card-1').click();
  const overlay = page.getByTestId('board-card-overlay');

  const handle = overlay.getByRole('button', { name: /^Move Ship it/ });
  const target = await overlay.getByRole('checkbox', { name: 'Build it' }).boundingBox();
  const start = await handle.boundingBox();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  // Above the middle of "Build it": lands in second place.
  await page.mouse.move(start!.x + 4, target!.y - 2, { steps: 8 });
  await expect(rowTexts(page)).toHaveText(['Write spec', 'Ship it', 'Build it', 'Test it']);
  await page.mouse.up();

  expect((await boardState(page, boardId)).items).toEqual(['Write spec', 'Ship it', 'Build it', 'Test it']);
  await page.keyboard.press('Escape');
  await page.getByTestId('board-card-1').click();
  await expect(rowTexts(page)).toHaveText(['Write spec', 'Ship it', 'Build it', 'Test it']);
});

test('the card face and overlay show checklist progress, green when every item is ticked', async ({ page }) => {
  const boardId = await openCard(page, ['One', 'Two']);
  await runBridge(page, 'card_create', { boardId, title: 'No subtasks', actor: 'planner' });
  await expect(page.getByTestId('board-card-progress-2')).toHaveCount(0);

  const bar = page.getByTestId('board-card-progress-1');
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  await expect(bar).toHaveAttribute('aria-valuemax', '2');

  await page.getByTestId('board-card-1').click();
  const overlay = page.getByTestId('board-card-overlay');
  await overlay.getByRole('checkbox', { name: 'One' }).click();
  const inner = page.getByTestId('card-checklist-progress');
  await expect(inner).toHaveAttribute('aria-valuenow', '1');
  await expect(inner.locator('.board-progress__fill')).toHaveAttribute('style', /width: 50%/);
  await expect(inner).not.toHaveClass(/board-progress--complete/);

  await overlay.getByRole('checkbox', { name: 'Two' }).click();
  await expect(inner).toHaveClass(/board-progress--complete/);
  await page.keyboard.press('Escape');
  await expect(bar).toHaveAttribute('aria-valuenow', '2');
  await expect(bar).toHaveClass(/board-progress--complete/);
  await expect(page.getByTestId('board-card-1')).toContainText('2/2');
});
