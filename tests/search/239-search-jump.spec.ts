/**
 * Test 239: Choosing a result takes you to the thing that matched
 * Covers: REQ-SEARCH-019, REQ-SEARCH-020, REQ-SEARCH-021, REQ-SEARCH-022
 */
import { test, expect, type Page } from '@playwright/test';
import { openFixture, activePage } from './search-fixture';

const results = (page: Page) => page.getByTestId('search-result');

async function searchNotebook(page: Page, query: string) {
  await page.getByTestId('nav-search').click();
  await page.getByTestId('search-input').fill(query);
}

/** The node's box on screen, against the canvas size, plus selection and zoom. */
async function nodeOnScreen(page: Page, id: string) {
  return page.evaluate((id) => {
    const c = (window as any).__POWERNOTE_STORES__.canvas.getState();
    const n = c.nodes.find((x: any) => x.id === id);
    const { x, y, scale } = c.viewport;
    const box = document.querySelector('[data-testid="canvas-container"]') ?? document.querySelector('.konvajs-content');
    const rect = (box as HTMLElement).getBoundingClientRect();
    return {
      top: n.y * scale + y,
      bottom: (n.y + n.height) * scale + y,
      left: n.x * scale + x,
      right: (n.x + n.width) * scale + x,
      width: rect.width,
      height: rect.height,
      scale,
      selected: c.selectedNodeIds.includes(id),
    };
  }, id);
}

test.describe('239 - Jumping to a result (REQ-SEARCH-019..022)', () => {
  test('a block far down another page is opened, selected and brought into view, zoom kept', async ({ page }) => {
    await openFixture(page, 's1', 'p2');
    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: 0, scale: 0.8 }));
    await searchNotebook(page, 'budget');
    await results(page).first().click();
    await expect(page.getByTestId('search-panel')).toHaveCount(0);
    expect(await activePage(page)).toEqual({ sectionId: 's1', pageId: 'p1' });
    const box = await nodeOnScreen(page, 't2');
    expect(box.selected).toBe(true);
    expect(box.scale).toBeCloseTo(0.8, 5);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(box.height);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.width);
  });

  test('a card result opens the board page and the card', async ({ page }) => {
    await openFixture(page);
    await searchNotebook(page, 'gasket');
    await results(page).first().click();
    expect(await activePage(page)).toEqual({ sectionId: 's2', pageId: 'p3' });
    const overlay = page.getByTestId('board-card-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.getByLabel('Card title')).toHaveValue('Fix the harbour crane');
  });

  test('from a board page, a text result opens the canvas page with the block in view', async ({ page }) => {
    await openFixture(page, 's2', 'p3');
    await searchNotebook(page, 'budget');
    await page.keyboard.press('Enter');
    expect(await activePage(page)).toEqual({ sectionId: 's1', pageId: 'p1' });
    await expect.poll(async () => (await nodeOnScreen(page, 't2')).selected).toBe(true);
    const box = await nodeOnScreen(page, 't2');
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(box.height);
  });

  test('page and section title results open that page', async ({ page }) => {
    await openFixture(page);
    await searchNotebook(page, 'diary');
    await results(page).first().click();
    expect(await activePage(page)).toEqual({ sectionId: 's1', pageId: 'p2' });

    await searchNotebook(page, 'projects');
    await results(page).first().click();
    expect(await activePage(page)).toEqual({ sectionId: 's2', pageId: 'p3' });
  });

  test('the first result is active; arrows move it and Enter opens it', async ({ page }) => {
    await openFixture(page);
    await searchNotebook(page, 'harbour');
    await expect(results(page)).toHaveCount(5);
    await expect(results(page).nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(results(page).nth(2)).toHaveAttribute('aria-selected', 'true');
    await expect(results(page).nth(0)).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('ArrowUp');
    await expect(results(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    const kind = await results(page).nth(1).getAttribute('data-kind');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('search-panel')).toHaveCount(0);
    expect(kind).toBeTruthy();
  });

  test('the active result stays scrolled into view in a long list', async ({ page }) => {
    await openFixture(page);
    await page.evaluate(() => {
      const S = (window as any).__POWERNOTE_STORES__;
      const nodes = Array.from({ length: 40 }, (_, i) => ({
        id: `r${i}`, type: 'text', x: 100, y: 600 + i * 60, width: 300, height: 40, layer: 3,
        data: { text: `row ${i} marker`, fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#1a1a1a' },
      }));
      S.canvas.getState().loadPageNodes(nodes);
    });
    await searchNotebook(page, 'marker');
    await expect(results(page)).toHaveCount(40);
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
    const last = results(page).nth(30);
    await expect(last).toHaveAttribute('aria-selected', 'true');
    await expect(last).toBeInViewport();
  });
});
