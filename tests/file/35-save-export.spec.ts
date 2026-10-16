/**
 * Test 35: Save / Export
 * Covers: REQ-FILE-001, REQ-FILE-002, REQ-FILE-003
 *
 * Verifies that the save button and Ctrl+S produce a downloadable HTML file
 * containing the serialized workspace data.
 */
import { test, expect } from '@playwright/test';
import { commitEditor, fillEditor, waitForCanvasReady, activateTool, clickCanvas, disableFSA } from '../helpers';
import * as fs from 'fs';

test.describe('35 - Save / Export (REQ-FILE-001..003)', () => {
  test.beforeEach(async ({ page }) => {
    // Disable File System Access API so save falls back to download flow
    await disableFSA(page);
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('save button is visible in the top bar', async ({ page }) => {
    await expect(page.locator('[data-testid="save-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="open-btn"]')).toBeVisible();
  });

  test('clicking save triggers a file download with embedded data', async ({ page }) => {
    // Place some content
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);
    await fillEditor(page, '# Export Test\nThis content should be in the file');
    await commitEditor(page);
    await page.waitForTimeout(300);

    // Intercept the download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid="save-btn"]').click(),
    ]);

    // Verify download
    expect(download.suggestedFilename()).toMatch(/\.html$/);

    // Read the file content
    const path = await download.path();
    expect(path).toBeTruthy();

    const content = fs.readFileSync(path!, 'utf-8');

    // Verify it contains the embedded data script
    expect(content).toContain('powernote-data');
    expect(content).toContain('Export Test');
    expect(content).toContain('This content should be in the file');
  });
});
