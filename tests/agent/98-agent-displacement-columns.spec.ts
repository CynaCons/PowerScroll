/**
 * Test 98: Bridge Displacement & Column Targeting
 * Covers: REQ-AGENT-016, REQ-AGENT-017, REQ-AGENT-018, REQ-AGENT-019 —
 * A displaced client stands down instead of fighting for the slot, and blocks
 * can be written into a chosen A4 page-guide column.
 *
 * Both behaviours are regressions from the v0.28.0 demo: two connected
 * notebooks traded the connection and commands landed in the wrong one, and
 * every block was pinned to column 0 with no way to reach the guide to the right.
 */
import { test, expect } from '@playwright/test';
import {
  waitForCanvasReady,
  waitForBridgeReady,
  runBridge,
  runBridgeExpectingError,
  sendServerFrame,
  stubBridgeUrl,
  getCanvasStore,
  getWorkspaceStore,
} from '../helpers';

const A4_WIDTH = 794;
const PAGE_GAP = 40;
const PAGE_MARGIN = 60;
const columnX = (col: number) => PAGE_MARGIN + col * (A4_WIDTH + PAGE_GAP);

test.describe('98 - Displacement & Columns (REQ-AGENT-016..019)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBridgeUrl(page);
    await page.goto('/');
    await waitForCanvasReady(page);
    await waitForBridgeReady(page);
  });

  // ── Displacement ──────────────────────────────────────────

  test('a displaced client stops retrying and reports why', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__POWERNOTE_BRIDGE__.store.getState().setEnabled(true);
    });

    const status = () =>
      page.evaluate(() => (window as any).__POWERNOTE_BRIDGE__.store.getState().status);

    // Resend until it takes. Enabling starts a connection attempt against the
    // stubbed dead port, and on a loaded runner a frame can arrive before the
    // client is listening for one -- which is why this passed locally and failed
    // in CI. Retrying tests the invariant rather than the timing.
    await expect
      .poll(
        async () => {
          await sendServerFrame(page, { v: 1, type: 'displaced', reason: 'taken' });
          return status();
        },
        { timeout: 15_000 },
      )
      .toBe('displaced');

    // The point of the test: well past the 500ms base backoff, a displaced
    // client must not have crept back to connecting on its own.
    await page.waitForTimeout(2000);
    expect(await status()).toBe('displaced');
  });

  test('the displaced hint appears in Settings and clears on re-enable', async ({ page }) => {
    await page.locator('[data-testid="nav-settings"]').click();
    await page.locator('[data-testid="settings-bridge-toggle"]').check();
    await sendServerFrame(page, { v: 1, type: 'displaced', reason: 'taken' });

    await expect(page.locator('[data-testid="settings-bridge-status"]')).toHaveAttribute(
      'data-status',
      'displaced',
    );
    await expect(page.locator('[data-testid="settings-bridge-displaced-hint"]')).toBeVisible();
    await expect(page.locator('[data-testid="settings-bridge-toggle"]')).not.toBeChecked();

    // Re-ticking the box takes the connection back.
    await page.locator('[data-testid="settings-bridge-toggle"]').check();
    await expect
      .poll(async () =>
        page.locator('[data-testid="settings-bridge-status"]').getAttribute('data-status'),
      )
      .not.toBe('displaced');
  });

  test('an unknown control frame is ignored without breaking the bridge', async ({ page }) => {
    await sendServerFrame(page, { v: 1, type: 'something-we-do-not-know' });
    await sendServerFrame(page, 'not even json' as unknown as object);

    const ok = await runBridge(page, 'append_block', { markdown: 'still alive' });
    expect(ok.blockId).toBeTruthy();
  });

  // ── Column targeting ──────────────────────────────────────

  test('blocks default to column 0', async ({ page }) => {
    const res = await runBridge(page, 'append_block', { markdown: 'Left column' });
    expect(res.column).toBe(0);

    const canvas = await getCanvasStore(page);
    expect(canvas.nodes[0].x).toBe(columnX(0));
  });

  test('append_block writes into the requested column', async ({ page }) => {
    const res = await runBridge(page, 'append_block', {
      markdown: 'Right column',
      column: 1,
    });
    expect(res.column).toBe(1);

    const canvas = await getCanvasStore(page);
    const node = canvas.nodes.find((n: any) => n.id === res.blockId);
    expect(node.x).toBe(columnX(1));
    expect(node.width).toBe(A4_WIDTH);
  });

  test('each column stacks independently of the other', async ({ page }) => {
    // Fill column 0 with enough content that a shared cursor would be obvious.
    await runBridge(page, 'append_block', { markdown: '# Left heading' });
    await runBridge(page, 'append_block', {
      markdown: ['- one', '- two', '- three', '- four', '- five'].join('\n'),
    });
    const left = await runBridge(page, 'append_block', { markdown: 'Bottom of left' });

    const right = await runBridge(page, 'append_block', {
      markdown: 'Top of right',
      column: 1,
    });

    const canvas = await getCanvasStore(page);
    const leftNode = canvas.nodes.find((n: any) => n.id === left.blockId);
    const rightNode = canvas.nodes.find((n: any) => n.id === right.blockId);

    // Column 1's first block starts at the top of the page, NOT below column 0.
    expect(rightNode.y).toBeLessThan(leftNode.y);
    expect(rightNode.y).toBe(48); // BLOCK_TOP_INSET
  });

  test('blocks stack within a column without overlapping', async ({ page }) => {
    await runBridge(page, 'append_block', { markdown: '# Col 1 heading', column: 1 });
    await runBridge(page, 'append_block', { markdown: '- a\n- b\n- c', column: 1 });
    await runBridge(page, 'append_block', { markdown: 'Tail block', column: 1 });

    const canvas = await getCanvasStore(page);
    const inCol1 = canvas.nodes
      .filter((n: any) => n.x === columnX(1))
      .sort((a: any, b: any) => a.y - b.y);

    expect(inCol1).toHaveLength(3);
    for (let i = 1; i < inCol1.length; i++) {
      expect(inCol1[i].y).toBeGreaterThanOrEqual(inCol1[i - 1].y + inCol1[i - 1].height);
    }
  });

  test('read_page reports each block column, ordered column-major', async ({ page }) => {
    await runBridge(page, 'append_block', { markdown: 'L1' });
    await runBridge(page, 'append_block', { markdown: 'R1', column: 1 });
    await runBridge(page, 'append_block', { markdown: 'L2' });
    await runBridge(page, 'append_block', { markdown: 'R2', column: 1 });

    const content = await runBridge(page, 'read_page');
    expect(content.blocks.map((b: any) => b.markdown)).toEqual(['L1', 'L2', 'R1', 'R2']);
    expect(content.blocks.map((b: any) => b.column)).toEqual([0, 0, 1, 1]);
  });

  test('create_page can place its heading in a column', async ({ page }) => {
    const created = await runBridge(page, 'create_page', {
      title: 'Right-hand page',
      column: 2,
    });

    const ws = await getWorkspaceStore(page);
    const newPage = ws.workspace.sections
      .flatMap((s: any) => s.pages)
      .find((p: any) => p.id === created.pageId);
    const heading = newPage.nodes.find((n: any) => n.id === created.headingBlockId);
    expect(heading.x).toBe(columnX(2));
  });

  test('an invalid column is rejected', async ({ page }) => {
    for (const column of [-1, 1.5, 'two']) {
      const err = await runBridgeExpectingError(page, 'append_block', {
        markdown: 'nope',
        column,
      });
      expect(err.code).toBe('BAD_PARAMS');
      expect(err.message).toContain('column');
    }
  });
});
