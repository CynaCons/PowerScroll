/**
 * Test 216: the board's activity panel collapses to a rail.
 * Covers: REQ-BOARD-028
 *
 * Owner request 2026-10-14: "the activity panel, I need to be able to collapse it".
 */
import { expect, test } from '@playwright/test';
import { runBridge, stubBridgeUrl, waitForBridgeReady, waitForCanvasReady } from '../helpers';

async function openBoard(page: import('@playwright/test').Page) {
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

test('collapse gives the columns the room, counts new activity, and is remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'First', actor: 'feature-1' });

  const panel = page.getByTestId('board-activity');
  const columns = page.getByTestId('board-column-todo');
  await expect(panel).toHaveAttribute('data-collapsed', 'false');
  const openWidth = (await columns.boundingBox())!.width;

  await page.getByTestId('board-activity-toggle').click();
  await expect(panel).toHaveAttribute('data-collapsed', 'true');
  expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(46);
  expect((await columns.boundingBox())!.width).toBeGreaterThan(openWidth + 40);
  await expect(page.getByTestId('board-activity-unread')).toHaveCount(0);

  // Activity while collapsed is counted on the rail.
  await runBridge(page, 'card_create', { boardId, title: 'Second', actor: 'feature-1' });
  await runBridge(page, 'card_create', { boardId, title: 'Third', actor: 'feature-2' });
  await expect(page.getByTestId('board-activity-unread')).toHaveText('2');

  // Remembered on this device: a newly opened board starts collapsed too.
  await page.getByTestId('nav-hierarchy').click();
  await page.getByTestId('add-board-btn').click();
  await page.getByTestId('nav-hierarchy').click();
  await expect(page.getByTestId('board-activity')).toHaveAttribute('data-collapsed', 'true');
  expect(
    await page.evaluate(() => localStorage.getItem('powerscroll-board-activity-collapsed')),
  ).toBe('1');
});

test('expanding clears the count and shows the list again', async ({ page }) => {
  const boardId = await openBoard(page);
  await page.getByTestId('board-activity-toggle').click();
  await runBridge(page, 'card_create', { boardId, title: 'While away', actor: 'feature-1' });
  await expect(page.getByTestId('board-activity-unread')).toHaveText('1');
  await page.getByTestId('board-activity-toggle').click();
  await expect(page.getByTestId('board-activity')).toHaveAttribute('data-collapsed', 'false');
  await expect(page.getByTestId('board-activity')).toContainText('created #1');
  await page.getByTestId('board-activity-toggle').click();
  await expect(page.getByTestId('board-activity-unread')).toHaveCount(0);
});
