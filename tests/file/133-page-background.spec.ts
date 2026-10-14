/**
 * Test 133: Background is per page, over a notebook default
 * Covers: REQ-SETTINGS-010..015
 *
 * Guide style and colour used to be notebook-wide only, so a notebook could not
 * hold a scrolling page of notes beside a grid page of diagrams. A page may now
 * override the default, field by field.
 *
 * The assertions that earn their keep are the INHERITANCE ones: an override
 * that merely copies the default looks identical until the default changes, and
 * a page that silently froze its colour when it only meant to pin its guide
 * style would pass any test that checks the visible result once.
 */
import { test, expect } from '@playwright/test';
import { getWorkspaceStore, waitForCanvasReady, disableFSA } from '../helpers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function openSettings(page: import('@playwright/test').Page) {
  const panel = page.locator('[data-testid="settings-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.locator('[data-testid="nav-settings"]').click();
  }
  await expect(panel).toBeVisible();
}

/** Adds a second page and returns both page ids, active page left on the first. */
async function twoPages(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace;
    ws.getState().addPage(ws.getState().activeSectionId);
    const section = ws
      .getState()
      .workspace.sections.find((s: any) => s.id === ws.getState().activeSectionId);
    return { first: section.pages[0].id, second: section.pages[1].id };
  });
}

test.describe('133 - Per-page background (REQ-SETTINGS-010..015)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('the panel writes to the notebook by default, and to the page when asked', async ({
    page,
  }) => {
    await openSettings(page);

    // Default scope is notebook — the meaning these controls already had.
    await expect(page.getByTestId('settings-scope')).toHaveAttribute('data-scope', 'notebook');
    await page.getByTestId('settings-bg-grid').click();

    let ws = await getWorkspaceStore(page);
    expect(ws.workspace.settings?.backgroundMode).toBe('grid');
    expect(ws.workspace.sections[0].pages[0].settings).toBeUndefined();

    await page.getByTestId('settings-scope-page').click();
    await page.getByTestId('settings-bg-scroll').click();

    ws = await getWorkspaceStore(page);
    // The page took the override; the notebook default is untouched.
    expect(ws.workspace.sections[0].pages[0].settings?.backgroundMode).toBe('scroll');
    expect(ws.workspace.settings?.backgroundMode).toBe('grid');
  });

  test('an override is per field — a pinned guide style still follows the colour', async ({
    page,
  }) => {
    await openSettings(page);
    await page.getByTestId('settings-scope-page').click();
    await page.getByTestId('settings-bg-grid').click();

    // Only the guide style was overridden.
    let ws = await getWorkspaceStore(page);
    expect(ws.workspace.sections[0].pages[0].settings).toEqual({ backgroundMode: 'grid' });

    // Changing the notebook colour must still reach this page.
    await page.getByTestId('settings-scope-notebook').click();
    await page.getByTestId('settings-bg-color-paper').click();

    ws = await getWorkspaceStore(page);
    expect(ws.workspace.sections[0].pages[0].settings?.bgColor).toBeUndefined();
    const resolved = await page.evaluate(() => {
      const s = (window as any).__POWERNOTE_STORES__.workspace.getState();
      const page0 = s.workspace.sections[0].pages[0];
      return { ...(s.workspace.settings ?? {}), ...(page0.settings ?? {}) };
    });
    expect(resolved).toMatchObject({ backgroundMode: 'grid', bgColor: 'paper' });
  });

  test('a page without an override follows a changed notebook default', async ({ page }) => {
    const ids = await twoPages(page);
    await openSettings(page);

    // Override only the first page.
    await page.getByTestId('settings-scope-page').click();
    await page.getByTestId('settings-bg-scroll').click();

    await page.getByTestId('settings-scope-notebook').click();
    await page.getByTestId('settings-bg-grid').click();

    const ws = await getWorkspaceStore(page);
    const pages = ws.workspace.sections[0].pages;
    expect(pages.find((p: any) => p.id === ids.first).settings?.backgroundMode).toBe('scroll');
    // The second page never overrode anything, so it has no settings at all and
    // draws with the notebook default.
    expect(pages.find((p: any) => p.id === ids.second).settings).toBeUndefined();
    expect(ws.workspace.settings?.backgroundMode).toBe('grid');
  });

  test('clearing an override drops the field rather than emptying it', async ({ page }) => {
    await openSettings(page);
    await page.getByTestId('settings-scope-page').click();
    await page.getByTestId('settings-bg-grid').click();

    await expect(page.getByTestId('settings-clear-page-override')).toBeVisible();
    await page.getByTestId('settings-clear-page-override').click();

    const ws = await getWorkspaceStore(page);
    // Absent, not `{}` — one shape on disk means one code path on load.
    expect(ws.workspace.sections[0].pages[0].settings).toBeUndefined();
    await expect(page.getByTestId('settings-clear-page-override')).toHaveCount(0);
  });

  test('a page override survives save and reopen', async ({ page }) => {
    // Re-navigated because disableFSA installs an init script, which only takes
    // effect on the next load — the beforeEach goto has already happened.
    await disableFSA(page);
    await page.goto('/');
    await waitForCanvasReady(page);

    await openSettings(page);
    await page.getByTestId('settings-scope-page').click();
    await page.getByTestId('settings-bg-scroll').click();
    await page.getByTestId('settings-bg-color-paper').click();
    await page.waitForTimeout(100);

    // Settings is a modal overlay: close it before reaching the top bar.
    await page.getByTestId('settings-close').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid="save-btn"]').click(),
    ]);
    const tmpPath = path.join(__dirname, '..', '..', 'test-results', 'page-background.html');
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    await download.saveAs(tmpPath);

    await page.goto('/');
    await waitForCanvasReady(page);
    await page.locator('[data-testid="file-input"]').setInputFiles(tmpPath);

    await expect
      .poll(
        async () =>
          (await getWorkspaceStore(page)).workspace.sections[0].pages[0].settings?.backgroundMode,
        { timeout: 5000 },
      )
      .toBe('scroll');

    const ws = await getWorkspaceStore(page);
    expect(ws.workspace.sections[0].pages[0].settings?.bgColor).toBe('paper');
    // The notebook default was never touched by a page-scoped write.
    expect(ws.workspace.settings?.backgroundMode ?? 'pages').toBe('pages');
  });

  test('an old notebook with no page settings still opens and inherits', async ({ page }) => {
    // The shape every page written before overrides existed has: no `settings`
    // key at all. Nothing should need migrating.
    const resolved = await page.evaluate(() => {
      const ws = (window as any).__POWERNOTE_STORES__.workspace;
      ws.getState().updateSettings({ backgroundMode: 'grid', bgColor: 'paper' });
      const page0 = ws.getState().workspace.sections[0].pages[0];
      return {
        pageHasSettings: 'settings' in page0,
        notebook: ws.getState().workspace.settings,
      };
    });
    expect(resolved.pageHasSettings).toBe(false);
    expect(resolved.notebook).toMatchObject({ backgroundMode: 'grid', bgColor: 'paper' });
  });
});
