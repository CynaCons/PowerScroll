/**
 * Test 152: Scroll title resting vs pinned visual states
 * Covers: REQ-HIER-019
 *
 * Rest is a document heading; held is the compact reading band. Untitled
 * scrolls still draw nothing.
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

type TitleSnap = {
  fontSize: number;
  fontStyle: string;
  fill: string;
  y: number;
  backing: { opacity: number; height: number; fill: string } | null;
  hairline: boolean;
};

async function titleScroll(page: import('@playwright/test').Page, title: string) {
  await page.evaluate((name) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const first = ws.getActivePage()?.scrolls?.[0];
    if (!first) throw new Error('no default scroll');
    ws.renameScroll(ws.activePageId, first.id, name);
    (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: 0, scale: 1 });
  }, title);
}

async function waitForTitle(page: import('@playwright/test').Page, title: string) {
  await page.waitForFunction((name) => {
    const Konva = (window as any).Konva;
    const stage = Konva?.stages?.[0];
    if (!stage) return false;
    return stage.find('Text').some((t: any) => t.text() === name);
  }, title);
}

async function snapTitle(page: import('@playwright/test').Page, title: string): Promise<TitleSnap | null> {
  return page.evaluate((name) => {
    const stage = (window as any).Konva.stages[0];
    const text = stage.find('Text').find((t: any) => t.text() === name);
    if (!text) return null;
    const group = text.getParent();
    const backing = group.findOne('.scroll-title-backing');
    const hairline = group.findOne('.scroll-title-hairline');
    return {
      fontSize: text.fontSize(),
      fontStyle: text.fontStyle(),
      fill: text.fill(),
      y: text.y(),
      backing: backing
        ? { opacity: backing.opacity(), height: backing.height(), fill: backing.fill() }
        : null,
      hairline: Boolean(hairline),
    };
  }, title);
}

async function titleMetrics(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const layout = await import('/src/utils/pageLayout.ts');
    return {
      resting: layout.SCROLL_TITLE_RESTING_FONT_SIZE,
      held: layout.SCROLL_TITLE_HELD_FONT_SIZE_SCREEN,
      restStyle: layout.SCROLL_TITLE_RESTING_FONT_STYLE,
      heldStyle: layout.SCROLL_TITLE_HELD_FONT_STYLE,
      ink: layout.SCROLL_TITLE_INK,
      restHeight: layout.SCROLL_TITLE_RESTING_HEIGHT,
      heldHeight: layout.SCROLL_TITLE_HELD_HEIGHT_SCREEN,
      fill: layout.SCROLL_TITLE_HELD_FILL,
    };
  });
}

async function setCameraY(page: import('@playwright/test').Page, y: number) {
  await page.evaluate((nextY) => {
    (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: nextY, scale: 1 });
  }, y);
}

/** Open the rename input the same way the header listens: Group dblclick. */
async function openRename(page: import('@playwright/test').Page, title: string) {
  await page.evaluate((name) => {
    const stage = (window as any).Konva.stages[0];
    const text = stage.find('Text').find((t: any) => t.text() === name);
    if (!text) throw new Error(`no title "${name}"`);
    text.getParent().fire('dblclick');
  }, title);
}

test.describe('152 - Scroll title resting vs pinned (REQ-HIER-019)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('at rest the title is a paper heading with a hairline rule', async ({ page }) => {
    await titleScroll(page, 'Project notes');
    await waitForTitle(page, 'Project notes');
    const metrics = await titleMetrics(page);
    const snap = await snapTitle(page, 'Project notes');

    expect(snap).not.toBeNull();
    expect(snap!.fontSize).toBe(metrics.resting);
    expect(snap!.fontStyle).toBe(metrics.restStyle);
    expect(snap!.fill).toBe(metrics.ink);
    expect(snap!.backing?.height).toBe(34); // resting backing is paper, 34 units, no shadow (REQ-SCROLL-033)
    expect(snap!.hairline).toBe(true);
  });

  test('scrolled past the pin threshold: compact held band over content', async ({ page }) => {
    await titleScroll(page, 'Project notes');
    await waitForTitle(page, 'Project notes');
    const atRest = await snapTitle(page, 'Project notes');
    await setCameraY(page, -600);
    await page.waitForTimeout(50);

    const metrics = await titleMetrics(page);
    const snap = await snapTitle(page, 'Project notes');

    expect(snap).not.toBeNull();
    expect(snap!.fontSize).toBe(metrics.held);
    expect(snap!.fontSize).toBeLessThan(atRest!.fontSize);
    expect(snap!.fontStyle).toBe(metrics.heldStyle);
    expect(snap!.backing).not.toBeNull();
    expect(snap!.backing!.height).toBe(metrics.heldHeight);
    expect(snap!.backing!.fill).toBe(metrics.fill);
    expect(snap!.hairline).toBe(true);
  });

  test('scrolling back to the top restores the document heading', async ({ page }) => {
    await titleScroll(page, 'Project notes');
    await waitForTitle(page, 'Project notes');
    await setCameraY(page, -600);
    await page.waitForTimeout(50);
    const down = await snapTitle(page, 'Project notes');
    expect(down!.backing).not.toBeNull();

    await setCameraY(page, 0);
    await page.waitForTimeout(50);
    const metrics = await titleMetrics(page);
    const rest = await snapTitle(page, 'Project notes');
    expect(rest!.fontSize).toBe(metrics.resting);
    expect(rest!.backing?.height).toBe(34);
    expect(rest!.hairline).toBe(true);
  });

  test('double-click opens the rename input in both states', async ({ page }) => {
    await titleScroll(page, 'Project notes');
    await waitForTitle(page, 'Project notes');

    await openRename(page, 'Project notes');
    const input = page.getByTestId('scroll-rename-input');
    await expect(input).toBeVisible();
    await input.press('Escape');
    await expect(input).toHaveCount(0);

    await setCameraY(page, -600);
    await page.waitForTimeout(50);
    await waitForTitle(page, 'Project notes');
    await openRename(page, 'Project notes');
    await expect(page.getByTestId('scroll-rename-input')).toBeVisible();
  });

  test('untitled scroll draws no header at rest or when scrolled', async ({ page }) => {
    // Birth scroll is untitled. Confirm nothing titled is drawn, then scroll.
    const atRest = await page.evaluate(() => {
      const stage = (window as any).Konva.stages[0];
      return {
        titles: stage.find('.scroll-title-text').map((t: any) => t.text()),
        backing: stage.find('.scroll-title-backing').length,
      };
    });
    expect(atRest.titles).toEqual([]);
    expect(atRest.backing).toBe(0);

    await setCameraY(page, -600);
    await page.waitForTimeout(50);
    const pinned = await page.evaluate(() => {
      const stage = (window as any).Konva.stages[0];
      return {
        titles: stage.find('.scroll-title-text').map((t: any) => t.text()),
        backing: stage.find('.scroll-title-backing').length,
      };
    });
    expect(pinned.titles).toEqual([]);
    expect(pinned.backing).toBe(0);
  });
});
