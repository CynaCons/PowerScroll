/**
 * Test 237: nested checklist items, and agents editing the checklist.
 * Covers: REQ-BOARD-040, REQ-BOARD-041, REQ-BOARD-042
 *
 * Owner request 2026-10-23: "I want the checklist to have at least one level
 * of indentation, but possibly more ... a similar format to what we have in
 * PowerPlan. But more importantly, agents needs to be able to update the
 * checklists ... the crud."
 */
import { expect, test, type Page } from '@playwright/test';
import {
  runBridge,
  runBridgeExpectingError,
  stubBridgeUrl,
  waitForBridgeReady,
  waitForCanvasReady,
} from '../helpers';

type Item = { id: string; index: number; text: string; done: boolean; depth: number };

async function openBoard(page: Page, checklist: unknown[] = []) {
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

async function items(page: Page, boardId: string): Promise<Item[]> {
  const got = await runBridge<{ card: { checklist: Item[] } }>(page, 'card_get', { boardId, card: 1 });
  return got.card.checklist;
}

const outline = (list: Item[]) => list.map((item) => `${'  '.repeat(item.depth)}${item.done ? 'x' : 'o'} ${item.text}`);

test('agents add, read, edit, tick, nest, move and remove checklist items', async ({ page }) => {
  const boardId = await openBoard(page, ['Engine', 'App']);
  const call = (cmd: string, params: Record<string, unknown>) =>
    runBridge(page, cmd, { boardId, card: 1, actor: 'worker-1', ...params });

  // Add: under an item (as its last sub-item), at a position, at the end.
  const added = await call('card_checklist_add', { text: 'Parser', under: 1 }) as { item: Item };
  expect(added.item).toMatchObject({ index: 2, text: 'Parser', depth: 1, done: false });
  await call('card_checklist_add', { text: 'Tests', under: 1 });
  await call('card_checklist_add', { text: 'Edge cases', under: 3 });
  await call('card_checklist_add', { text: 'Plan', position: 1 });
  await call('card_checklist_add', { text: 'Release' });
  expect(outline(await items(page, boardId))).toEqual([
    'o Plan',
    'o Engine',
    '  o Parser',
    '  o Tests',
    '    o Edge cases',
    'o App',
    'o Release',
  ]);

  // Update by position or by id: text, done, depth.
  const list = await items(page, boardId);
  await call('card_checklist_update', { item: list[2].id, text: 'Lexer and parser', done: true });
  await call('card_checklist_update', { item: 6, depth: 1 });
  // Indenting moves the sub-items along; depth is clamped to one below the item above.
  await call('card_checklist_update', { item: 2, depth: 3 });
  expect(outline(await items(page, boardId))).toEqual([
    'o Plan',
    '  o Engine',
    '    x Lexer and parser',
    '    o Tests',
    '      o Edge cases',
    '    o App',
    'o Release',
  ]);

  // Move to a position (the item alone); remove keeps sub-items one level up.
  await call('card_checklist_move', { item: 7, position: 1 });
  await call('card_checklist_remove', { item: 5 });
  expect(outline(await items(page, boardId))).toEqual([
    'o Release',
    'o Plan',
    '  o Engine',
    '    x Lexer and parser',
    '    o Edge cases',
    '    o App',
  ]);

  // Set the whole list from PowerPlan-style Markdown; unchanged text keeps its id.
  const engineId = (await items(page, boardId))[2].id;
  await call('card_checklist_set', {
    text: '- [x] Engine\n  - [ ] Parser\n    - [x] Lexer\n- [ ] App\n  - [ ] Screens',
  });
  const set = await items(page, boardId);
  expect(outline(set)).toEqual(['x Engine', '  o Parser', '    x Lexer', 'o App', '  o Screens']);
  expect(set[0].id).toBe(engineId);
  expect(set.map((item) => item.index)).toEqual([1, 2, 3, 4, 5]);
  await call('card_checklist_set', { items: ['One', { text: 'Two', depth: 1, done: true }] });
  expect(outline(await items(page, boardId))).toEqual(['o One', '  x Two']);

  // Errors name the problem.
  expect((await runBridgeExpectingError(page, 'card_checklist_remove', { boardId, card: 1, item: 9, actor: 'worker-1' })).code)
    .toBe('NOT_FOUND');
  expect((await runBridgeExpectingError(page, 'card_checklist_update', { boardId, card: 1, item: 1, actor: 'worker-1' })).code)
    .toBe('INVALID');
  expect((await runBridgeExpectingError(page, 'card_checklist_set', { boardId, card: 1 })).code).toBe('NAME_REQUIRED');

  // The board's history names the agent.
  const actors = await page.evaluate((id) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const board = ws.workspace.sections.flatMap((s: any) => s.pages).find((p: any) => p.id === id).board;
    return [...new Set(board.events.slice(1).map((event: any) => event.actor))];
  }, boardId);
  expect(actors).toEqual(['worker-1']);
});

test('the card shows nesting; Indent, Outdent and the keyboard change it', async ({ page }) => {
  const boardId = await openBoard(page, [
    'Engine',
    { text: 'Parser', depth: 1 },
    { text: 'Lexer', depth: 2 },
    'App',
  ]);
  expect(outline(await items(page, boardId))).toEqual(['o Engine', '  o Parser', '    o Lexer', 'o App']);

  // The card face preview is indented.
  const preview = page.getByTestId('board-card-subtasks-1');
  await expect(preview.locator('li[data-depth="2"]')).toHaveText('Lexer');

  await page.getByTestId('board-card-1').click();
  const overlay = page.getByTestId('board-card-overlay');
  const row = (text: string) => overlay.locator('[data-check-item]').filter({ hasText: text });
  await expect(row('Lexer')).toHaveAttribute('data-depth', '2');
  const lexerLeft = (await row('Lexer').getByRole('checkbox').boundingBox())!.x;
  const engineLeft = (await row('Engine').getByRole('checkbox').boundingBox())!.x;
  expect(lexerLeft - engineLeft).toBeGreaterThan(24);

  // Buttons: App under Engine's last sub-item level, then back.
  await overlay.getByRole('button', { name: 'Indent App' }).click();
  await expect(row('App')).toHaveAttribute('data-depth', '1');
  await overlay.getByRole('button', { name: 'Outdent Parser' }).click();
  expect(outline(await items(page, boardId))).toEqual(['o Engine', 'o Parser', '  o Lexer', '  o App']);

  // Keyboard on a focused row: Alt+Right / Alt+Left; focus stays.
  const box = row('Parser').getByRole('checkbox');
  await box.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(row('Parser')).toHaveAttribute('data-depth', '1');
  await expect(box).toBeFocused();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(row('Parser')).toHaveAttribute('data-depth', '0');

  // Tab / Shift+Tab while editing the text.
  await overlay.getByRole('button', { name: 'Lexer', exact: true }).click();
  const input = overlay.getByLabel('Edit Lexer');
  // While editing, the text is in an input: find the row by position.
  const lexer = overlay.locator('[data-check-item]').nth(2);
  await input.press('Shift+Tab');
  await expect(lexer).toHaveAttribute('data-depth', '0');
  await expect(overlay.getByLabel('Edit Lexer')).toBeFocused();
  await overlay.getByLabel('Edit Lexer').press('Tab');
  await expect(lexer).toHaveAttribute('data-depth', '1');
  await overlay.getByLabel('Edit Lexer').press('Enter');

  // Removing a parent keeps its sub-items one level up.
  await overlay.getByRole('button', { name: 'Remove Parser' }).click();
  expect(outline(await items(page, boardId))).toEqual(['o Engine', 'o Lexer', '  o App']);
});

test('items saved before nesting open at the top level', async ({ page }) => {
  const boardId = await openBoard(page, ['One', 'Two']);
  await page.evaluate((id) => {
    const store = (window as any).__POWERNOTE_STORES__.workspace;
    const ws = store.getState().workspace;
    const board = ws.sections.flatMap((s: any) => s.pages).find((p: any) => p.id === id).board;
    for (const item of board.cards[0].checklist) delete item.depth;
  }, boardId);
  expect(outline(await items(page, boardId))).toEqual(['o One', 'o Two']);
  await page.getByTestId('board-card-1').click();
  await expect(page.getByTestId('board-card-overlay').locator('[data-check-item][data-depth="0"]')).toHaveCount(2);
});
