/**
 * Test 167: a human can delete a named scroll
 * Covers: REQ-HIER-023
 *
 * delete_scroll already existed for the agent. This is the missing button.
 */
import { test, expect } from '@playwright/test';
import {
  waitForCanvasReady,
  waitForBridgeReady,
  runBridge,
  stubBridgeUrl,
  getWorkspaceStore,
} from '../helpers';

async function openHeaderMenu(page: import('@playwright/test').Page, title: string) {
  await page.getByTestId('scroll-header-card').filter({ hasText: title }).click({ button: 'right' });
}

async function namedTitles(page: import('@playwright/test').Page): Promise<string[]> {
  const ws = await getWorkspaceStore(page);
  const pg = ws.workspace.sections.flatMap((s: { pages: { id: string; scrolls?: { title: string }[] }[] }) => s.pages)
    .find((p: { id: string }) => p.id === ws.activePageId);
  return (pg?.scrolls ?? []).filter((s: { title: string }) => s.title).map((s: { title: string }) => s.title);
}

test.describe('167 - Delete a scroll from the UI (REQ-HIER-023)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBridgeUrl(page);
    await page.goto('/');
    await waitForCanvasReady(page);
    await waitForBridgeReady(page);
  });

  test('empty named scroll deletes from the header menu with no extra step', async ({ page }) => {
    await runBridge(page, 'create_scroll', { title: 'Spare' });
    expect(await namedTitles(page)).toContain('Spare');

    await openHeaderMenu(page, 'Spare');
    await page.getByTestId('delete-scroll').click();
    await expect(page.getByTestId('scroll-header-menu')).toHaveCount(0);
    expect(await namedTitles(page)).not.toContain('Spare');
  });

  test('a non-empty scroll asks keep vs delete; keep closes the column and leaves the block', async ({
    page,
  }) => {
    const created = await runBridge(page, 'create_scroll', { title: 'Notes' });
    await runBridge(page, 'append_block', {
      markdown: 'keep me',
      scrollId: created.scrollId,
    });

    await openHeaderMenu(page, 'Notes');
    await page.getByTestId('delete-scroll').click();
    await expect(page.getByTestId('scroll-delete-keep')).toBeVisible();
    await page.getByTestId('scroll-delete-keep').click();

    expect(await namedTitles(page)).not.toContain('Notes');
    const canvas = await page.evaluate(() =>
      (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.map((n: { data?: { text?: string } }) => n.data?.text),
    );
    expect(canvas).toContain('keep me');
  });

  test('Delete notes too removes the band and its block; undo restores both', async ({ page }) => {
    const created = await runBridge(page, 'create_scroll', { title: 'Draft' });
    await runBridge(page, 'append_block', {
      markdown: 'gone',
      scrollId: created.scrollId,
    });

    await openHeaderMenu(page, 'Draft');
    await page.getByTestId('delete-scroll').click();
    await page.getByTestId('scroll-delete-contents').click();

    expect(await namedTitles(page)).not.toContain('Draft');
    const after = await page.evaluate(() =>
      (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.map((n: { data?: { text?: string } }) => n.data?.text),
    );
    expect(after).not.toContain('gone');

    await page.keyboard.press('Control+z');
    expect(await namedTitles(page)).toContain('Draft');
    const restored = await page.evaluate(() =>
      (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.map((n: { data?: { text?: string } }) => n.data?.text),
    );
    expect(restored).toContain('gone');
  });

  test('the last scroll cannot be deleted from the menu', async ({ page }) => {
    const ws = await getWorkspaceStore(page);
    const only = (await namedTitles(page)).length === 0
      ? (await page.evaluate(() => {
          const S = (window as any).__POWERNOTE_STORES__;
          const id = S.workspace.getState().getActivePage().scrolls[0].id;
          S.workspace.getState().renameScroll(S.workspace.getState().activePageId, id, 'Only');
          return 'Only';
        }))
      : (await namedTitles(page))[0];
    void ws;

    await openHeaderMenu(page, only);
    await expect(page.getByTestId('delete-scroll')).toBeDisabled();
  });

  test('sidebar X deletes an empty named scroll', async ({ page }) => {
    const created = await runBridge(page, 'create_scroll', { title: 'Sidebar' });
    await page.getByTestId('nav-hierarchy').click();
    await page.getByTestId(`delete-scroll-${created.scrollId}`).click();
    expect(await namedTitles(page)).not.toContain('Sidebar');
  });
});
