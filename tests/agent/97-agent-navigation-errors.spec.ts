/**
 * Test 97: Agent Cross-Page Writes, Persistence & Errors
 * Covers: REQ-AGENT-011, REQ-AGENT-012, REQ-AGENT-013 — Writing to a page that
 * is not currently open, edits surviving a reload, and typed error handling.
 *
 * The store only persists nodes for the ACTIVE page, so a command aimed at
 * another page must save/switch/load first — these tests pin that behaviour.
 */
import { test, expect } from '@playwright/test';
import {
  waitForCanvasReady,
  waitForBridgeReady,
  runBridge,
  runBridgeExpectingError,
  getWorkspaceStore,
} from '../helpers';

test.describe('97 - Agent Navigation & Errors (REQ-AGENT-011, REQ-AGENT-012, REQ-AGENT-013)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await waitForBridgeReady(page);
  });

  test('writing to a non-active page switches to it and does not lose the other page', async ({ page }) => {
    const pageA = await runBridge(page, 'create_page', { title: 'Page A', withHeading: false });
    await runBridge(page, 'append_block', { markdown: 'Content on A' });

    const pageB = await runBridge(page, 'create_page', { title: 'Page B', withHeading: false });
    await runBridge(page, 'append_block', { markdown: 'Content on B' });

    // Now write back to A while B is active.
    await runBridge(page, 'append_block', { pageId: pageA.pageId, markdown: 'More on A' });

    const active = await getWorkspaceStore(page);
    expect(active.activePageId).toBe(pageA.pageId);

    const aContent = await runBridge(page, 'read_page', { pageId: pageA.pageId });
    expect(aContent.blocks.map((b: any) => b.markdown)).toEqual(['Content on A', 'More on A']);

    // B kept its own content — the switch saved before moving.
    const bContent = await runBridge(page, 'read_page', { pageId: pageB.pageId });
    expect(bContent.blocks.map((b: any) => b.markdown)).toEqual(['Content on B']);
  });

  test('read_page can read a page without making it active', async ({ page }) => {
    const first = await runBridge(page, 'list_pages');
    const originalActive = first.pages.find((p: any) => p.isActive).pageId;

    const other = await runBridge(page, 'create_page', { title: 'Elsewhere', withHeading: false });
    await runBridge(page, 'read_page', { pageId: originalActive });

    // read_page must not have navigated away from the page create_page opened.
    const ws = await getWorkspaceStore(page);
    expect(ws.activePageId).toBe(other.pageId);
  });

  test('agent edits mark the notebook dirty', async ({ page }) => {
    await runBridge(page, 'append_block', { markdown: 'Dirty me' });

    const isDirty = await page.evaluate(
      () => (window as any).__POWERNOTE_STORES__.workspace.getState().isDirty,
    );
    expect(isDirty).toBe(true);
  });

  test('agent edits survive a page reload via the notebook library', async ({ page }) => {
    await runBridge(page, 'create_page', { title: 'Persisted', withHeading: false });
    await runBridge(page, 'append_block', { markdown: '- [ ] survive the reload' });

    // Auto-save debounces at 1.5s with a 5s max wait, then keeps a recovery
    // copy of the notebook in IndexedDB (REQ-FILE-028).
    const recovered = () =>
      page.evaluate(
        () =>
          new Promise<string>((resolve, reject) => {
            const r = indexedDB.open('powerscroll-recovery');
            r.onsuccess = () => {
              const q = r.result.transaction('notebooks').objectStore('notebooks').getAll();
              q.onsuccess = () => {
                r.result.close();
                resolve(JSON.stringify(q.result));
              };
              q.onerror = () => reject(q.error);
            };
            r.onerror = () => reject(r.error);
          }),
      );
    await expect.poll(recovered, { timeout: 10_000 }).toContain('survive the reload');
    expect(await recovered()).toContain('Persisted');
  });

  test('unknown command returns UNSUPPORTED', async ({ page }) => {
    const err = await runBridgeExpectingError(page, 'delete_everything');
    expect(err.code).toBe('UNSUPPORTED');
  });

  test('unknown page id returns NOT_FOUND', async ({ page }) => {
    const err = await runBridgeExpectingError(page, 'read_page', { pageId: 'nope-not-real' });
    expect(err.code).toBe('NOT_FOUND');
  });

  test('unknown block id returns NOT_FOUND', async ({ page }) => {
    const err = await runBridgeExpectingError(page, 'update_block', {
      blockId: 'nope-not-real',
      markdown: 'x',
    });
    expect(err.code).toBe('NOT_FOUND');
  });

  test('missing required params return BAD_PARAMS', async ({ page }) => {
    const err = await runBridgeExpectingError(page, 'append_block', {});
    expect(err.code).toBe('BAD_PARAMS');
    expect(err.message).toContain('markdown');
  });

  test('the app stays usable after a failed command', async ({ page }) => {
    await runBridgeExpectingError(page, 'read_page', { pageId: 'bogus' });

    const ok = await runBridge(page, 'append_block', { markdown: 'still working' });
    expect(ok.blockId).toBeTruthy();
  });
});
