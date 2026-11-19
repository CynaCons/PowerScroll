/**
 * Test 250: Agent writes keep the owner's view
 * Covers: REQ-AGENT-011, REQ-AGENT-080
 *
 * The owner is typing in a text block. An agent writes to another page. The
 * agent's page gets the content; the owner keeps their page, viewport, undo
 * history and the open editor with its uncommitted draft.
 */
import { expect, test } from '@playwright/test';
import { runBridge, textEditor, waitForBridgeReady, waitForCanvasReady } from '../helpers';
import { newBlock } from '../text/text-user';

const pageNodes = (page: any, pageId: string) =>
  page.evaluate((id: string) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState().workspace;
    for (const s of ws.sections) {
      const p = s.pages.find((x: any) => x.id === id);
      if (p) return p.nodes.map((n: any) => n.data?.text ?? '');
    }
    return null;
  }, pageId) as Promise<string[] | null>;

const ownerState = (page: any) =>
  page.evaluate(() => {
    const st = (window as any).__POWERNOTE_STORES__;
    const ws = st.workspace.getState();
    return {
      activePageId: ws.activePageId,
      viewport: st.canvas.getState().viewport,
    };
  });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
  await waitForBridgeReady(page);
});

async function startTyping(page: any) {
  await page.evaluate(() =>
    (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: -120, y: -40, scale: 1 }),
  );
  await newBlock(page, 'owner draft');
  await expect(textEditor(page)).toBeFocused();
}

test('agent create/append/update on another page leaves the owner untouched', async ({ page }) => {
  await startTyping(page);
  const before = await ownerState(page);

  const created = await runBridge(page, 'create_page', { title: 'Agent page' });
  const appended = await runBridge(page, 'append_block', { markdown: 'appended' });
  expect(appended.pageId).toBe(created.pageId);
  await runBridge(page, 'update_block', { blockId: appended.blockId, markdown: 'updated' });

  const after = await ownerState(page);
  expect(after.activePageId).toBe(before.activePageId);
  expect(after.viewport).toEqual(before.viewport);
  await expect(page.locator('.ProseMirror-focused')).toHaveCount(1);
  await expect(textEditor(page)).toContainText('owner draft');

  expect(await pageNodes(page, created.pageId)).toEqual(['# Agent page', 'updated']);
  const own = await pageNodes(page, before.activePageId);
  expect(own).not.toContain('updated');
  expect(own).not.toContain('# Agent page');
});

test('undo history of the owner is unchanged by agent writes elsewhere', async ({ page }) => {
  await page.evaluate(() => {
    const c = (window as any).__POWERNOTE_STORES__.canvas.getState();
    c.addNode({
      id: 'own-1', type: 'text', x: 100, y: 100, width: 300, height: 30,
      data: { text: 'mine', fontSize: 16, fontFamily: 'Inter, sans-serif', fontStyle: 'normal', fill: '#1a1a1a' },
    });
  });
  const canUndo = () => page.evaluate(() => (window as any).__POWERNOTE_STORES__.history?.getState().canUndo);
  expect(await canUndo()).toBe(true);

  const created = await runBridge(page, 'create_page', { title: 'Elsewhere' });
  await runBridge(page, 'append_block', { markdown: 'x', pageId: created.pageId });
  expect(await canUndo()).toBe(true);

  await page.evaluate(() => (window as any).__POWERNOTE_STORES__.history.getState().undo());
  const ids = await page.evaluate(() =>
    (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.map((n: any) => n.id),
  );
  expect(ids).not.toContain('own-1');
});

test('after the owner changes page, a default append goes to their page', async ({ page }) => {
  const a = await runBridge(page, 'create_page', { title: 'Page A' });
  const b = await runBridge(page, 'create_page', { title: 'Page B' });
  const first = await runBridge(page, 'append_block', { markdown: 'to agent page' });
  expect(first.pageId).toBe(b.pageId);

  // The owner moves to page A themself.
  await page.evaluate(({ s, p }) => {
    const st = (window as any).__POWERNOTE_STORES__;
    st.workspace.getState().setActivePage(s, p);
    st.canvas.getState().loadPageNodes(st.workspace.getState().getActivePage().nodes);
  }, { s: a.sectionId, p: a.pageId });

  const second = await runBridge(page, 'append_block', { markdown: 'to owner page' });
  expect(second.pageId).toBe(a.pageId);
});

test('an agent write to the owner\'s own page appears on the canvas live', async ({ page }) => {
  const active = (await runBridge(page, 'list_pages')).pages.find((p: any) => p.isActive);
  const r = await runBridge(page, 'append_block', { markdown: 'live block', pageId: active.pageId });
  expect(r.pageId).toBe(active.pageId);
  const texts = await page.evaluate(() =>
    (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.map((n: any) => n.data?.text),
  );
  expect(texts).toContain('live block');
});
