/**
 * Test 245: text blocks are drawn as bars at very low zoom.
 * Covers: REQ-CANVAS-051
 *
 * Zoomed out to 15% a 16 px line is 2-3 px tall. The block's HTML is not
 * mounted; the canvas draws one bar per line instead.
 */
import { test, expect, type Page } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

const SCROLLS = 4;
const BLOCKS = 12;
const STEP = 120;

async function seed(page: Page) {
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
    for (let c = 0; c < SCROLLS; c++) {
      const left = 60 + c * (794 + 40);
      for (let b = 0; b < BLOCKS; b++) {
        nodes.push({
          id: `t${c}-${b}`, type: 'text', x: left + 24, y: 60 + b * STEP, width: 700, height: 60, layer: 4,
          data: { text: `## block ${c}-${b}\n\nbody of ${c}-${b}`, fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#14181A' },
        });
      }
    }
    S.canvas.getState().loadPageNodes(nodes);
    S.draw.getState().loadPageStrokes([]);
    S.canvas.getState().setViewport({ x: 0, y: 0, scale: 1 });
  }, { SCROLLS, BLOCKS, STEP });
}

const md = (page: Page) => page.locator('.powernote-markdown').count();
const greekCount = (page: Page) => page.evaluate(() => (window as any).Konva.stages[0].find('.text-greek').length);
const setScale = (page: Page, scale: number) =>
  page.evaluate((scale) => (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: 0, scale }), scale);
const storeNode = (page: Page, id: string) =>
  page.evaluate((id) => (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.find((n: any) => n.id === id), id);

test.describe('245 - Text as bars at very low zoom', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await seed(page);
    await expect(page.getByText('block 0-0', { exact: true })).toBeVisible();
  });

  test('at 15% unselected text is bars, one shape per block in view, no HTML', async ({ page }) => {
    await setScale(page, 0.15);
    await expect.poll(() => md(page)).toBe(0);
    await expect.poll(() => greekCount(page)).toBeGreaterThan(0);
    const result = await page.evaluate(() => {
      const w = window as any;
      const view = { w: 1400, h: 880 };
      const ids = new Set<string>(w.Konva.stages[0].find('.text-greek').map((s: any) => s.getParent().getParent().attrs.cullId));
      const inView = w.__POWERNOTE_STORES__.canvas.getState().nodes.filter((n: any) => n.x * 0.15 < view.w && n.y * 0.15 < view.h);
      return { inView: inView.length, missing: inView.filter((n: any) => !ids.has(n.id)).length };
    });
    expect(result.inView).toBeGreaterThan(0);
    expect(result.missing).toBe(0);
  });

  test('at 25% and 100% text is real and there are no bars', async ({ page }) => {
    for (const scale of [0.25, 1]) {
      await setScale(page, scale);
      await expect.poll(() => md(page)).toBeGreaterThan(0);
      expect(await greekCount(page)).toBe(0);
    }
  });

  test('hysteresis: stays bars up to 22%, text returns above it', async ({ page }) => {
    await setScale(page, 0.19);
    await expect.poll(() => md(page)).toBe(0);
    await setScale(page, 0.21);
    await page.waitForTimeout(300);
    expect(await md(page)).toBe(0);
    expect(await greekCount(page)).toBeGreaterThan(0);
    await setScale(page, 0.23);
    await expect.poll(() => md(page)).toBeGreaterThan(0);
    expect(await greekCount(page)).toBe(0);
  });

  test('a selected block shows its real text at 15%', async ({ page }) => {
    await setScale(page, 0.15);
    await expect.poll(() => md(page)).toBe(0);
    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().selectNode('t0-1', false));
    await expect.poll(() => md(page)).toBe(1);
    await expect(page.getByText('body of 0-1', { exact: true })).toHaveCount(1);
  });

  test('a real click on a bars block selects it', async ({ page }) => {
    await setScale(page, 0.15);
    await expect.poll(() => md(page)).toBe(0);
    const box = (await page.locator('[data-testid="canvas-container"]').boundingBox())!;
    const n = await storeNode(page, 't1-5');
    await page.mouse.click(box.x + (n.x + n.width / 2) * 0.15, box.y + (n.y + n.height / 2) * 0.15);
    await expect
      .poll(() => page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().selectedNodeIds))
      .toEqual(['t1-5']);
  });

  test('a block whose text changes while zoomed out is measured and ends as bars', async ({ page }) => {
    await setScale(page, 0.15);
    await expect.poll(() => md(page)).toBe(0);
    const before = await storeNode(page, 't3-11');
    await page.evaluate(() => {
      const C = (window as any).__POWERNOTE_STORES__.canvas.getState();
      const n = C.nodes.find((x: any) => x.id === 't3-11');
      C.updateNode('t3-11', { data: { ...n.data, text: Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n\n') } });
    });
    await expect.poll(async () => (await storeNode(page, 't3-11')).height).toBeGreaterThan(before.height + 100);
    await expect.poll(() => md(page)).toBe(0);
    expect(await greekCount(page)).toBeGreaterThan(0);
  });

  test('greekBars: heading weight, wrapping, empty', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const m = await import('/src/utils/greekText.ts');
      const heading = m.greekBars('# Title', 16, 700, 40);
      const long = m.greekBars('word '.repeat(200), 16, 700, 200);
      return { heading: Array.from(heading), longRows: long.length / 5, empty: m.greekBars('', 16, 700, 40).length, blank: m.greekBars('\n \n```\n', 16, 700, 40).length };
    });
    expect(r.heading.length).toBe(5);
    expect(r.heading[4]).toBe(2);
    expect(r.longRows).toBeGreaterThan(2);
    expect(r.empty).toBe(0);
    expect(r.blank).toBe(0);
  });
});
