/**
 * Test 157: A page can read plain again — empty rename untitleds a scroll
 * Covers: REQ-HIER-020, REQ-AGENT-053
 *
 * The header already hid on an empty title and the ceiling already gated on
 * a titled scroll (T150). rename_scroll used to refuse "" so an agent could
 * not reach that state, and last-scroll delete stayed the only way to "get
 * a plain page" — which is refused because the append-target invariant is
 * load-bearing. Empty rename is the way; last-scroll delete stays refused.
 */
import { test, expect } from '@playwright/test';
import {
  waitForCanvasReady,
  waitForBridgeReady,
  runBridge,
  runBridgeExpectingError,
} from '../helpers';

async function titleDefault(page: import('@playwright/test').Page, title: string) {
  await page.evaluate((name) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const first = ws.getActivePage()?.scrolls?.[0];
    if (!first) throw new Error('no default scroll');
    ws.renameScroll(ws.activePageId, first.id, name);
    (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: 0, scale: 1 });
  }, title);
}

async function defaultScroll(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    return ws.getActivePage()?.scrolls?.[0] ?? null;
  });
}

async function waitForTitle(page: import('@playwright/test').Page, title: string) {
  await expect(page.getByTestId('scroll-header-card').filter({ hasText: title })).toBeVisible();
}

async function openRename(page: import('@playwright/test').Page, title: string) {
  await page.getByTestId('scroll-header-card').filter({ hasText: title }).dblclick();
}

async function ceilingOf(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const { pageCeiling } = await import('/src/utils/scrollCeiling.ts');
    const S = (window as any).__POWERNOTE_STORES__;
    return pageCeiling(
      S.canvas.getState().nodes,
      S.draw.getState().strokes,
      S.workspace.getState().getActivePage()?.scrolls,
    );
  });
}

async function headerTitles(page: import('@playwright/test').Page) {
  return page.getByTestId('scroll-title-strip').allTextContents();
}

test.describe('157 - Untitle a scroll (REQ-HIER-020, REQ-AGENT-053)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await waitForBridgeReady(page);
  });

  test('empty rename from the header clears it and disarms the ceiling; re-title re-arms', async ({
    page,
  }) => {
    await titleDefault(page, 'Project notes');
    await waitForTitle(page, 'Project notes');
    expect(await ceilingOf(page)).not.toBeNull();
    expect(await headerTitles(page)).toContain('Project notes');

    await openRename(page, 'Project notes');
    const input = page.getByTestId('scroll-rename-input');
    await expect(input).toBeVisible();
    await input.fill('');
    await input.press('Enter');
    await expect(input).toHaveCount(0);

    expect((await defaultScroll(page)).title).toBe('');
    expect(await headerTitles(page)).toEqual([]);
    expect(await ceilingOf(page)).toBeNull();

    await titleDefault(page, 'Project notes');
    await waitForTitle(page, 'Project notes');
    expect(await ceilingOf(page)).not.toBeNull();
    expect(await headerTitles(page)).toContain('Project notes');
  });

  test('rename_scroll accepts an empty title over the bridge', async ({ page }) => {
    const listed = await runBridge(page, 'list_scrolls');
    const scrollId = listed.scrolls[0].scrollId;

    await runBridge(page, 'rename_scroll', { scrollId, title: 'Research log' });
    expect(await ceilingOf(page)).not.toBeNull();

    const result = await runBridge(page, 'rename_scroll', { scrollId, title: '' });
    expect(result.title).toBe('');
    expect(result.previousTitle).toBe('Research log');

    expect((await defaultScroll(page)).title).toBe('');
    expect(await headerTitles(page)).toEqual([]);
    expect(await ceilingOf(page)).toBeNull();
  });

  test('last-scroll deletion stays refused and names the untitled alternative', async ({
    page,
  }) => {
    const listed = await runBridge(page, 'list_scrolls');
    const err = await runBridgeExpectingError(page, 'delete_scroll', {
      scrollId: listed.scrolls[0].scrollId,
      confirm: true,
    });
    expect(err.code).toBe('PRECONDITION');
    expect(err.message).toMatch(/untitled/i);
    expect((await runBridge(page, 'list_scrolls')).scrolls).toHaveLength(1);
  });
});
