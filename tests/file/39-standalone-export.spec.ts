import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { commitEditor, fillEditor, waitForCanvasReady, clickCanvas, activateTool, disableFSA } from '../helpers';

/**
 * 39 - Standalone HTML Export
 * Covers: REQ-FILE-007, REQ-FILE-008
 *
 * Tests that the exported HTML file works as a completely standalone
 * application when opened via file:// protocol (no server required).
 */
test.describe('39 - Standalone Export (REQ-FILE-007, REQ-FILE-008)', () => {
  const exportDir = path.resolve('test-results/standalone-export');

  test.beforeAll(() => {
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }
  });

  test('exported HTML renders and contains user data when opened as file://', async ({ page, context }) => {
    // Disable FSA so save uses the download flow we expect here
    await disableFSA(page);
    // Step 1: Open the dev app and create some content
    await page.goto('/');
    await waitForCanvasReady(page);

    // Place a text node with distinctive content
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);
    await fillEditor(page, 'Standalone Export Test Content');
    await commitEditor(page);
    await page.waitForTimeout(300);

    // Step 2: Trigger export and capture the downloaded file
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-testid="save-btn"]');
    const download = await downloadPromise;

    // Save the downloaded file
    const exportPath = path.join(exportDir, 'standalone-test.html');
    await download.saveAs(exportPath);

    // Verify the file exists and has content
    const fileContent = fs.readFileSync(exportPath, 'utf-8');
    expect(fileContent.length).toBeGreaterThan(100000); // Should be ~500KB+

    // Verify it does NOT contain dev server references
    expect(fileContent).not.toContain('/@vite/client');
    expect(fileContent).not.toContain('src="/src/main.tsx"');
    expect(fileContent).not.toContain('@react-refresh');

    // Verify it DOES contain the production bundle (inlined JS)
    expect(fileContent).toContain('<script');
    expect(fileContent).toContain('powernote-data');
    expect(fileContent).toContain('Standalone Export Test Content');

    // Step 3: Open the exported file as file:// in a new page.
    // Disable FSA on this page too — Chromium still exposes the picker on
    // file://, which would hang Save instead of triggering a download.
    const standalonePage = await context.newPage();
    await disableFSA(standalonePage);
    await standalonePage.goto(`file:///${exportPath.replace(/\\/g, '/')}`);

    // Wait for the app to render (longer timeout for file:// cold start)
    await standalonePage.locator('[data-testid="canvas-container"] canvas').first().waitFor({
      state: 'visible',
      timeout: 15000,
    });

    // Step 4: Verify the content rendered correctly
    await expect(standalonePage.locator('[data-testid="nav-rail"]')).toBeVisible();
    await expect(standalonePage.locator('[data-testid="topbar"]')).toBeVisible();

    // Check that our text content is present in the store
    // Wait for stores to be exposed (async in production too)
    await standalonePage.waitForFunction(() => (window as any).__POWERNOTE_STORES__, { timeout: 10000 });

    const nodeCount = await standalonePage.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      return stores.canvas.getState().nodes.length;
    });
    expect(nodeCount).toBe(1);

    const nodeText = await standalonePage.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      const nodes = stores.canvas.getState().nodes;
      return nodes[0]?.data?.text || '';
    });
    expect(nodeText).toBe('Standalone Export Test Content');

    // Step 5: Verify we can RE-EXPORT from the standalone file
    const reDownloadPromise = standalonePage.waitForEvent('download');
    await standalonePage.click('[data-testid="save-btn"]');
    const reDownload = await reDownloadPromise;

    const reExportPath = path.join(exportDir, 'standalone-re-export.html');
    await reDownload.saveAs(reExportPath);

    const reExportContent = fs.readFileSync(reExportPath, 'utf-8');
    expect(reExportContent).toContain('Standalone Export Test Content');
    expect(reExportContent).not.toContain('/@vite/client');

    await standalonePage.close();
  });
});
