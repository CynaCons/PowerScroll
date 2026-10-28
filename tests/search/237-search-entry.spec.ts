/**
 * Test 237: Search is easy to find and opens everywhere
 * Covers: REQ-SEARCH-010, REQ-SEARCH-011, REQ-SEARCH-012, REQ-SEARCH-013
 *
 * Owner, 2026-10-28: "we don't have a search functionality in PowerScroll".
 * Search existed only behind Ctrl+F; these tests drive it the way a user
 * finds it: the button, the real keys, and on a board page.
 */
import { test, expect } from '@playwright/test';
import { openFixture } from './search-fixture';

const panel = (page: import('@playwright/test').Page) => page.getByTestId('search-panel');
const input = (page: import('@playwright/test').Page) => page.getByTestId('search-input');
const results = (page: import('@playwright/test').Page) => page.getByTestId('search-result');

test.describe('237 - Search entry points (REQ-SEARCH-010..013)', () => {
  test('a Search button in the nav rail opens notebook search with the cursor in the field', async ({ page }) => {
    await openFixture(page);
    const button = page.getByTestId('nav-search');
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('title', /Ctrl\+F/);
    await button.click();
    await expect(panel(page)).toBeVisible();
    await expect(input(page)).toBeFocused();
    await expect(page.getByTestId('search-scope-notebook')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('needle');
    await expect(results(page)).toHaveCount(1);
  });

  test('the button closes the panel again', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('nav-search').click();
    await expect(panel(page)).toBeVisible();
    await page.getByTestId('nav-search').click();
    await expect(panel(page)).toHaveCount(0);
  });

  test('Ctrl+Shift+F pressed on a real keyboard opens notebook search', async ({ page }) => {
    await openFixture(page);
    // Shift makes the browser report "F", not "f".
    await page.keyboard.press('Control+Shift+F');
    await expect(panel(page)).toBeVisible();
    await expect(page.getByTestId('search-scope-notebook')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Ctrl+F opens page search, and switching scope keeps the query', async ({ page }) => {
    await openFixture(page);
    await page.keyboard.press('Control+f');
    await expect(page.getByTestId('search-scope-page')).toHaveAttribute('aria-pressed', 'true');
    await input(page).fill('needle');
    await expect(results(page)).toHaveCount(0); // the needle is on another page
    await page.getByTestId('search-scope-notebook').click();
    await expect(input(page)).toHaveValue('needle');
    await expect(results(page)).toHaveCount(1);
    await expect(input(page)).toBeFocused();
  });

  test('search opens on a board page and "This page" searches its cards', async ({ page }) => {
    await openFixture(page, 's2', 'p3');
    await expect(page.getByTestId('board-card-1')).toBeVisible();
    await page.keyboard.press('Control+f');
    await expect(panel(page)).toBeVisible();
    await input(page).fill('crane');
    await expect(results(page)).toHaveCount(1);
    await expect(results(page).first()).toContainText('#1');
  });

  test('the Search button works on a board page too', async ({ page }) => {
    await openFixture(page, 's2', 'p3');
    await page.getByTestId('nav-search').click();
    await expect(panel(page)).toBeVisible();
    await input(page).fill('valve');
    await expect(results(page)).toHaveCount(1);
  });
});
