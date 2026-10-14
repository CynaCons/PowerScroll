/**
 * Test 85: Persist canvas settings in HTML data
 * Covers: REQ-SETTINGS-002, REQ-SETTINGS-003, REQ-SETTINGS-004
 *
 * Background mode + color live in workspace.settings, survive page
 * navigation, and round-trip through save → open.
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

async function openSettings(page: import('@playwright/test').Page) {
  const panel = page.locator('[data-testid="settings-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.locator('[data-testid="nav-settings"]').click();
  }
  await expect(panel).toBeVisible();
}

test.describe('85 - Settings persist in HTML (REQ-SETTINGS-002..004)', () => {
  test('settings survive page navigation within the session', async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);

    await openSettings(page);
    await page.locator('[data-testid="settings-bg-grid"]').click();
    await page.locator('[data-testid="settings-bg-color-paper"]').click();

    let ws = await getWorkspaceStore(page);
    expect(ws.workspace.settings?.backgroundMode).toBe('grid');
    expect(ws.workspace.settings?.bgColor).toBe('paper');

    // Close settings, open hierarchy, add/navigate page
    await page.locator('[data-testid="settings-close"]').click();
    await expect(page.locator('[data-testid="settings-panel"]')).toBeHidden();

    await activateTool(page, 'hierarchy');
    await expect(page.locator('[data-testid="hierarchy-panel"]')).toBeVisible();
    await page.locator('[data-testid="add-page-btn"]').first().click();
    await page.waitForTimeout(200);
    await page.locator('.hierarchy-page').nth(1).locator('.hierarchy-page__nav').click();
    await page.waitForTimeout(200);

    ws = await getWorkspaceStore(page);
    expect(ws.workspace.settings?.backgroundMode).toBe('grid');
    expect(ws.workspace.settings?.bgColor).toBe('paper');

    await openSettings(page);
    await expect(page.locator('[data-testid="settings-bg-grid"]')).toBeChecked();
  });

  test('settings round-trip through save → open', async ({ page }) => {
    await disableFSA(page);
    await page.goto('/');
    await waitForCanvasReady(page);

    await openSettings(page);
    await page.locator('[data-testid="settings-bg-grid"]').click();
    await page.locator('[data-testid="settings-bg-color-paper"]').click();
    await page.waitForTimeout(100);

    const wsBefore = await getWorkspaceStore(page);
    expect(wsBefore.workspace.settings?.backgroundMode).toBe('grid');
    expect(wsBefore.workspace.settings?.bgColor).toBe('paper');

    // Settings is a modal overlay: close it before reaching the top bar.
    await page.getByTestId('settings-close').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid="save-btn"]').click(),
    ]);

    const tmpPath = path.join(__dirname, '..', '..', 'test-results', 'settings-persist.html');
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    await download.saveAs(tmpPath);

    const html = fs.readFileSync(tmpPath, 'utf-8');
    expect(html).toContain('"backgroundMode": "grid"');
    expect(html).toContain('"bgColor": "paper"');

    // Fresh session, then open the saved file
    await page.goto('/');
    await waitForCanvasReady(page);

    let ws = await getWorkspaceStore(page);
    expect(ws.workspace.settings?.backgroundMode ?? 'pages').toBe('pages');

    const fileInput = page.locator('[data-testid="file-input"]');
    await fileInput.setInputFiles(tmpPath);
    // Poll rather than sleep: the open path is FileReader → parse → hydrate, and
    // a fixed wait that is merely usually long enough fails on a slower machine.
    await expect
      .poll(
        async () => (await getWorkspaceStore(page)).workspace.settings?.backgroundMode,
        { timeout: 5000 },
      )
      .toBe('grid');

    ws = await getWorkspaceStore(page);
    expect(ws.workspace.settings?.backgroundMode).toBe('grid');
    expect(ws.workspace.settings?.bgColor).toBe('paper');

    await openSettings(page);
    await expect(page.locator('[data-testid="settings-bg-grid"]')).toBeChecked();
    await expect(page.locator('[data-testid="settings-bg-color-paper"]')).toHaveClass(
      /settings-panel__color-swatch--active/,
    );
  });
});
