/**
 * Test 08: Hierarchy Navigate
 * Covers: REQ-HIER-004, REQ-HIER-011 — Navigate between pages via the
 * hierarchy panel, preserving per-page canvas content
 *
 * Verifies that adding a section, navigating to its page, placing text,
 * then navigating back preserves content on each page independently.
 */
import { test, expect } from '@playwright/test';
import { commitEditor, fillEditor, getCanvasStore, getWorkspaceStore, waitForCanvasReady, clickCanvas, activateTool } from '../helpers';

test.describe('08 - Hierarchy Navigate (REQ-HIER-004, REQ-HIER-011)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('navigating to a new section page updates the breadcrumb', async ({ page }) => {
    // Open hierarchy panel
    await activateTool(page, 'hierarchy');
    await expect(page.locator('[data-testid="hierarchy-panel"]')).toBeVisible();

    // Check initial breadcrumb
    await expect(page.locator('[data-testid="topbar-section"]')).toHaveText('Section 1');
    await expect(page.locator('[data-testid="topbar-page"]')).toHaveText('Page 1');

    // Add a new section
    await page.locator('[data-testid="add-section-btn"]').click();
    await page.waitForTimeout(200);

    // The new section should appear in the hierarchy panel
    // Find the new section's page button and click it to navigate
    const pageButtons = page.locator('.hierarchy-page');
    // There should now be 2 page items (one per section)
    await expect(pageButtons).toHaveCount(2);

    // Click the second page (new section's page)
    await pageButtons.nth(1).click();
    await page.waitForTimeout(200);

    // Breadcrumb should show the new section name
    const sectionText = await page.locator('[data-testid="topbar-section"]').innerText();
    expect(sectionText).not.toBe('Section 1');
  });

  test('page content is preserved when navigating between pages', async ({ page }) => {
    // Open hierarchy
    await activateTool(page, 'hierarchy');
    await expect(page.locator('[data-testid="hierarchy-panel"]')).toBeVisible();

    // Add a new section
    await page.locator('[data-testid="add-section-btn"]').click();
    await page.waitForTimeout(200);

    // Navigate to the new section's page
    const pageButtons = page.locator('.hierarchy-page');
    await pageButtons.nth(1).click();
    await page.waitForTimeout(300);

    // Place text on the new page
    await activateTool(page, 'text');
    await clickCanvas(page, 400, 300);

    await fillEditor(page, 'Page 2 content');
    await commitEditor(page);
    await page.waitForTimeout(300);

    // Verify the text node exists on this page
    let store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);
    expect(store.nodes[0].data.text).toBe('Page 2 content');

    // Navigate back to first page
    await pageButtons.nth(0).click();
    await page.waitForTimeout(300);

    // First page should have no nodes (it was empty)
    store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(0);

    // Navigate back to second page
    await pageButtons.nth(1).click();
    await page.waitForTimeout(300);

    // Second page content should be preserved
    store = await getCanvasStore(page);
    expect(store.nodes).toHaveLength(1);
    expect(store.nodes[0].data.text).toBe('Page 2 content');
  });
});
