/**
 * Test 101: Scroll guide style
 * Covers: REQ-SETTINGS-005
 *
 * "Scroll" renders a column as ONE continuous sheet with light page separators,
 * rather than the detached A4 cards of "pages" mode. The distinction is
 * structural, not cosmetic — the whole point is that content can straddle a page
 * boundary instead of falling into a gap — so these assertions read the real
 * Konva scene graph rather than trusting the store value alone.
 */
import { test, expect } from '@playwright/test';
import {
  getWorkspaceStore,
  waitForCanvasReady,
  activateTool,
  disableFSA,
} from '../helpers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const A4_HEIGHT = 1123;

type PW = import('@playwright/test').Page;

/** Count nodes by Konva name in the live scene graph. */
function countShapes(page: PW, name: string): Promise<number> {
  return page.evaluate(
    (name) => (window as any).Konva.stages[0].find('.' + name).length,
    name,
  );
}

async function openSettings(page: PW) {
  const panel = page.locator('[data-testid="settings-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.locator('[data-testid="nav-settings"]').click();
  }
  await expect(panel).toBeVisible();
}

/** Place a text block far enough down to force several pages of scroll. */
async function seedTallBlock(page: PW) {
  await page.evaluate((h) => {
    (window as any).__POWERNOTE_STORES__.canvas.getState().addNode({
      id: 'tall-block',
      type: 'text',
      x: 60,
      y: h * 2 + 40,
      width: 794,
      height: 60,
      layer: 4,
      data: {
        text: 'down the scroll',
        fontSize: 16,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontStyle: 'normal',
        fill: '#1a1a1a',
      },
    });
  }, A4_HEIGHT);
}

test.describe('101 - Scroll guide style (REQ-SETTINGS-005)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('selecting Scroll stores the mode and renders one continuous sheet', async ({ page }) => {
    await openSettings(page);
    await page.locator('[data-testid="settings-bg-scroll"]').click();

    const ws = await getWorkspaceStore(page);
    expect(ws.workspace.settings?.backgroundMode).toBe('scroll');
    await expect(page.locator('[data-testid="settings-bg-scroll"]')).toBeChecked();

    // One sheet for the single occupied column — not one rect per page.
    await expect.poll(() => countShapes(page, 'scroll-sheet')).toBe(1);
  });

  test('the sheet grows with content and separators mark each page boundary', async ({ page }) => {
    await openSettings(page);
    await page.locator('[data-testid="settings-bg-scroll"]').click();

    const before = await countShapes(page, 'scroll-separator');
    await seedTallBlock(page);

    // A block three pages down must extend the same sheet, adding boundaries
    // rather than spawning detached cards.
    await expect.poll(() => countShapes(page, 'scroll-separator')).toBeGreaterThan(before);
    expect(await countShapes(page, 'scroll-sheet')).toBe(1);
  });

  test('pages mode draws no scroll sheet, and switching back restores it', async ({ page }) => {
    await openSettings(page);

    await page.locator('[data-testid="settings-bg-pages"]').click();
    await expect.poll(() => countShapes(page, 'scroll-sheet')).toBe(0);

    await page.locator('[data-testid="settings-bg-scroll"]').click();
    await expect.poll(() => countShapes(page, 'scroll-sheet')).toBe(1);
  });

  test('scroll survives page navigation within the session', async ({ page }) => {
    await openSettings(page);
    await page.locator('[data-testid="settings-bg-scroll"]').click();
    await page.locator('[data-testid="settings-close"]').click();

    await activateTool(page, 'hierarchy');
    await page.locator('[data-testid="add-page-btn"]').first().click();
    await page.waitForTimeout(200);
    await page.locator('.hierarchy-page').nth(1).locator('.hierarchy-page__nav').click();
    await page.waitForTimeout(200);

    const ws = await getWorkspaceStore(page);
    expect(ws.workspace.settings?.backgroundMode).toBe('scroll');
    await expect.poll(() => countShapes(page, 'scroll-sheet')).toBe(1);
  });

  test('scroll round-trips through save → open', async ({ page }) => {
    await disableFSA(page);
    await page.goto('/');
    await waitForCanvasReady(page);

    await openSettings(page);
    await page.locator('[data-testid="settings-bg-scroll"]').click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid="save-btn"]').click(),
    ]);
    const tmpPath = path.join(__dirname, '..', '..', 'test-results', 'scroll-guide.html');
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    await download.saveAs(tmpPath);
    expect(fs.readFileSync(tmpPath, 'utf-8')).toContain('"backgroundMode": "scroll"');

    await page.goto('/');
    await waitForCanvasReady(page);
    await page.locator('[data-testid="file-input"]').setInputFiles(tmpPath);

    await expect
      .poll(
        async () => (await getWorkspaceStore(page)).workspace.settings?.backgroundMode,
        { timeout: 5000 },
      )
      .toBe('scroll');
    await expect.poll(() => countShapes(page, 'scroll-sheet')).toBe(1);
  });
});
