/**
 * Test 90: Bound HTML file path indicator
 * Covers: REQ-FILE-022
 *
 * TopBar shows best-available file identity and updates when the notebook
 * binding changes (FSA handle set / cleared / library load).
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

test.describe('90 - File path indicator (REQ-FILE-022)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await page.evaluate(async () => {
      const { clearCurrentHandle } = await import('/src/utils/fileHandleStore.ts');
      await clearCurrentHandle();
      localStorage.removeItem('powernote-library');
    });
    await expect(page.locator('[data-testid="topbar-file-path"]')).toHaveText(
      'Not linked to a file',
    );
  });

  test('shows Not linked by default, then FSA name after setCurrentHandle', async ({ page }) => {
    const pathEl = page.locator('[data-testid="topbar-file-path"]');
    await expect(pathEl).toBeVisible();

    await page.evaluate(async () => {
      const { setCurrentHandle } = await import('/src/utils/fileHandleStore.ts');
      await setCurrentHandle({ name: 'ProjectNotes.html' } as FileSystemFileHandle);
    });

    await expect(pathEl).toHaveText('ProjectNotes.html');
  });

  test('clears path when handle is cleared (library-style unlink)', async ({ page }) => {
    await page.evaluate(async () => {
      const { setCurrentHandle, clearCurrentHandle } = await import('/src/utils/fileHandleStore.ts');
      await setCurrentHandle({ name: 'WillUnlink.html' } as FileSystemFileHandle);
      await clearCurrentHandle();
    });

    await expect(page.locator('[data-testid="topbar-file-path"]')).toHaveText(
      'Not linked to a file',
    );
  });

  test('library load clears bound path in TopBar', async ({ page }) => {
    await page.evaluate(async () => {
      const { setCurrentHandle } = await import('/src/utils/fileHandleStore.ts');
      const { saveRecovery } = await import('/src/utils/recoveryStore.ts');
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState().workspace;
      await setCurrentHandle({ name: 'DiskBound.html' } as FileSystemFileHandle);
      // A different notebook, kept only in this browser (no linked file).
      await saveRecovery({ ...ws, id: 'library-only-90', filename: 'Library Notebook' });
    });

    await expect(page.locator('[data-testid="topbar-file-path"]')).toHaveText('DiskBound.html');

    await page.locator('[data-testid="nav-library"]').click();
    await expect(page.locator('[data-testid="library-panel"]')).toBeVisible();
    await page
      .getByTestId('library-entry')
      .filter({ hasText: 'Library Notebook' })
      .getByTestId('library-load-btn')
      .click();

    await expect(page.locator('[data-testid="topbar-file-path"]')).toHaveText(
      'Not linked to a file',
    );
  });

  test('formatFileUrlPath normalizes Windows file:// paths', async ({ page }) => {
    const formatted = await page.evaluate(async () => {
      const { formatFileUrlPath } = await import('/src/stores/useFileBindingStore.ts');
      return formatFileUrlPath('/C:/Users/me/Docs/Notes.html');
    });

    expect(formatted).toBe('C:\\Users\\me\\Docs\\Notes.html');
  });

  test('fileBinding store updates TopBar when setFromHandle is called', async ({ page }) => {
    await page.waitForFunction(
      () => !!(window as any).__POWERNOTE_STORES__?.fileBinding,
    );

    await page.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.fileBinding.getState().setFromHandle({ name: 'FromStore.html' });
    });

    await expect(page.locator('[data-testid="topbar-file-path"]')).toHaveText('FromStore.html');

    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.fileBinding.getState().clear();
    });

    await expect(page.locator('[data-testid="topbar-file-path"]')).toHaveText(
      'Not linked to a file',
    );
  });
});
