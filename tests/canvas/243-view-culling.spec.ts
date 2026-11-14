/**
 * Test 243: only what is near the view is mounted.
 * Covers: REQ-CANVAS-047, REQ-CANVAS-048, REQ-CANVAS-049, REQ-CANVAS-050
 *
 * A page with many full scrolls used to mount every block: each wheel tick
 * moved every text overlay and each change re-rendered every block.
 */
import { test, expect, type Page } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

const SCROLLS = 8;
const BLOCKS = 40;
const STEP = 120;

async function seedLargePage(page: Page) {
  await page.evaluate(({ SCROLLS, BLOCKS, STEP }) => {
    const S = (window as any).__POWERNOTE_STORES__;
    const ws = S.workspace;
    const st = ws.getState();
    const pageId = st.activePageId;
    const scrolls = Array.from({ length: SCROLLS }, (_, i) => ({ id: `s${i}`, title: `Week ${i + 1}`, column: i }));
    ws.setState({
      workspace: {
        ...st.workspace,
        settings: { ...(st.workspace.settings ?? {}), backgroundMode: 'scroll' },
        sections: st.workspace.sections.map((sec: any) => ({
          ...sec,
          pages: sec.pages.map((p: any) => (p.id === pageId ? { ...p, scrolls } : p)),
        })),
      },
    });
    const nodes: any[] = [];
    const strokes: any[] = [];
    for (let c = 0; c < SCROLLS; c++) {
      const left = 60 + c * (794 + 40);
      for (let b = 0; b < BLOCKS; b++) {
        const y = 60 + b * STEP;
        nodes.push({
          id: `t${c}-${b}`, type: 'text', x: left + 24, y, width: 700, height: 25, layer: 4,
          data: { text: `block ${c}-${b}`, fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#14181A' },
        });
        strokes.push({ id: `k${c}-${b}`, points: [left + 400, y + 60, left + 500, y + 70], color: '#14181A', strokeWidth: 3 });
      }
    }
    S.canvas.getState().loadPageNodes(nodes);
    S.draw.getState().loadPageStrokes(strokes);
    S.canvas.getState().setViewport({ x: 0, y: 0, scale: 1 });
  }, { SCROLLS, BLOCKS, STEP });
}

const mountedBlocks = (page: Page) => page.locator('.powernote-markdown').count();
const drawn = (page: Page, name: string) =>
  page.evaluate((name) => (window as any).Konva.stages[0].find(`.${name}`).length, name);
const setView = (page: Page, x: number, y: number, scale = 1) =>
  page.evaluate(({ x, y, scale }) => (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x, y, scale }), { x, y, scale });
const storeNode = (page: Page, id: string) =>
  page.evaluate((id) => (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.find((n: any) => n.id === id), id);

test.describe('243 - View culling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await seedLargePage(page);
  });

  test('a large page mounts only the blocks, ink and sheets near the view', async ({ page }) => {
    await expect(page.getByText('block 0-0', { exact: true })).toBeVisible();
    const total = SCROLLS * BLOCKS;
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.length)).toBe(total);
    await expect.poll(() => mountedBlocks(page)).toBeLessThan(total / 4);
    expect(await mountedBlocks(page)).toBeGreaterThan(0);
    expect(await drawn(page, 'stroke-group')).toBeLessThan(total / 4);
    // 8 columns of 5+ sheets exist; only the ones near the view are drawn.
    expect(await drawn(page, 'scroll-sheet')).toBeLessThan(12);
    expect(await drawn(page, 'scroll-sheet')).toBeGreaterThan(0);
  });

  test('moving the view shows the content there and lets go of what was left behind', async ({ page }) => {
    await expect(page.getByText('block 0-0', { exact: true })).toBeVisible();
    await expect(page.getByText('block 6-35', { exact: true })).toHaveCount(0);

    // Far corner of the page: column 6, block 35.
    await setView(page, -(60 + 6 * 834) + 100, -(60 + 35 * STEP) + 200);
    await expect(page.getByText('block 6-35', { exact: true })).toBeVisible();
    await expect(page.getByText('block 0-0', { exact: true })).toHaveCount(0);
    await expect.poll(() => mountedBlocks(page)).toBeLessThan((SCROLLS * BLOCKS) / 4);

    // Zoomed out, more of the page is in view and so more of it is mounted.
    const near = await mountedBlocks(page);
    await setView(page, 0, 0, 0.3);
    await expect.poll(() => mountedBlocks(page)).toBeGreaterThan(near);
  });

  test('wheel scrolling to the bottom of a scroll shows every block on the way', async ({ page }) => {
    await page.mouse.move(400, 400);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 400);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
      // Whatever sits in the middle of the screen must be mounted right now.
      const id = await page.evaluate(({ STEP }) => {
        const v = (window as any).__POWERNOTE_STORES__.canvas.getState().viewport;
        const b = Math.max(0, Math.min(39, Math.round((-v.y + 360 - 60) / STEP)));
        return `block 0-${b}`;
      }, { STEP });
      await expect(page.getByText(id, { exact: true })).toBeVisible();
    }
  });

  test('a selected block stays mounted when the view moves away', async ({ page }) => {
    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().selectNode('t0-1', false));
    await setView(page, -(60 + 6 * 834) + 100, -(60 + 35 * STEP) + 200);
    await expect(page.getByText('block 6-35', { exact: true })).toBeVisible();
    await expect(page.getByText('block 0-1', { exact: true })).toHaveCount(1);
    await expect(page.getByText('block 0-0', { exact: true })).toHaveCount(0);
  });

  test('a block changed while out of view is still measured and the column packed', async ({ page }) => {
    const before = await storeNode(page, 't6-35');
    const belowBefore = await storeNode(page, 't6-36');
    await expect(page.getByText('block 6-35', { exact: true })).toHaveCount(0);

    // What an agent does: rewrite a block the user is not looking at.
    await page.evaluate(() => {
      const C = (window as any).__POWERNOTE_STORES__.canvas.getState();
      const n = C.nodes.find((x: any) => x.id === 't6-35');
      C.updateNode('t6-35', { data: { ...n.data, text: Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n\n') } });
    });

    await expect.poll(async () => (await storeNode(page, 't6-35')).height).toBeGreaterThan(before.height + 100);
    await expect.poll(async () => (await storeNode(page, 't6-36')).y).toBeGreaterThan(belowBefore.y + 100);
    // Once measured it is let go again.
    await expect(page.getByText('line 11', { exact: true })).toHaveCount(0);
  });

  test('a change to one block leaves the other mounted blocks alone', async ({ page }) => {
    await expect(page.getByText('block 0-0', { exact: true })).toBeVisible();
    // Mark every mounted overlay; a re-mount would lose the mark.
    await page.evaluate(() => document.querySelectorAll('.powernote-markdown').forEach((el) => ((el as any).__seen = true)));
    const renders = await page.evaluate(async () => {
      let mutations = 0;
      const observer = new MutationObserver((list) => (mutations += list.length));
      document.querySelectorAll('.powernote-markdown').forEach((el) => {
        if (el.textContent !== 'block 0-1') observer.observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
      });
      const C = (window as any).__POWERNOTE_STORES__.canvas.getState();
      const n = C.nodes.find((x: any) => x.id === 't0-1');
      C.updateNode('t0-1', { data: { ...n.data, text: 'block 0-1 edited' } });
      await new Promise((r) => setTimeout(r, 300));
      observer.disconnect();
      return mutations;
    });
    expect(renders).toBe(0);
    await expect(page.getByText('block 0-1 edited', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => [...document.querySelectorAll('.powernote-markdown')].filter((el) => (el as any).__seen).length)).toBeGreaterThan(3);
  });
});
