/**
 * Test 204: durable autosave recovery
 * Covers: REQ-FILE-027, REQ-FILE-028, REQ-FILE-029, REQ-FILE-030, REQ-FILE-031, REQ-FILE-032, REQ-FILE-033
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady, disableFSA, preloadModule } from '../helpers';

async function recovery(page: import('@playwright/test').Page) {
  return page.evaluate(() => new Promise<any[]>((resolve, reject) => {
    const r = indexedDB.open('powerscroll-recovery');
    r.onsuccess = () => { const q = r.result.transaction('notebooks').objectStore('notebooks').getAll(); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); };
    r.onerror = () => reject(r.error);
  }));
}

test.describe('204 - Autosave recovery', () => {
  test.beforeEach(async ({ page }) => { await disableFSA(page); await page.goto('/'); await waitForCanvasReady(page); });

  test('an edit is recovered, becomes clean, and does not keep saving while idle', async ({ page }) => {
    await page.evaluate(() => {
      const s = (window as any).__POWERNOTE_STORES__;
      s.canvas.getState().addNode({ id: 'recover-204', type: 'text', x: 1, y: 1, width: 100, height: 20, layer: 3, data: { text: 'recover me', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#111' } });
      s.workspace.getState().markDirty();
    });
    await expect.poll(() => recovery(page).then((entries) => entries.some((x) => JSON.stringify(x).includes('recover me'))), { timeout: 3000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => !(window as any).__POWERNOTE_STORES__.workspace.getState().isDirty), { timeout: 3000 }).toBe(true);
    const runs = await page.evaluate(() => (window as any).__POWERNOTE_AUTOSAVE_RUNS__);
    await page.waitForTimeout(2500);
    await expect(page.evaluate(() => (window as any).__POWERNOTE_AUTOSAVE_RUNS__)).resolves.toBe(runs);
  });

  test('hidden flushes without waiting for debounce', async ({ page }) => {
    await page.evaluate(() => { const s = (window as any).__POWERNOTE_STORES__; s.workspace.getState().updateWorkspace({ filename: 'Hidden 204' }); s.workspace.getState().markDirty(); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
    await expect.poll(() => recovery(page).then((entries) => entries.some((x) => x.name === 'Hidden 204')), { timeout: 1000 }).toBe(true);
  });
});

/** Add a text node with `text` and mark the notebook dirty — an ordinary edit. */
async function edit(page: import('@playwright/test').Page, id: string, text: string) {
  await page.evaluate(([nodeId, body]) => {
    const s = (window as any).__POWERNOTE_STORES__;
    s.canvas.getState().addNode({ id: nodeId, type: 'text', x: 1, y: 1, width: 100, height: 20, layer: 3, data: { text: body, fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#111' } });
    s.workspace.getState().markDirty();
  }, [id, text]);
}

/**
 * Link the open notebook to a real FileSystemFileHandle. It comes from the
 * origin-private file system, so it can be stored in IndexedDB and written
 * exactly like a file picked from disk, without a picker.
 */
async function linkOpfsFile(page: import('@playwright/test').Page, name: string) {
  await preloadModule(page, '/src/utils/fileHandleStore.ts');
  await page.evaluate(async (fileName) => {
    const root = await (navigator.storage as any).getDirectory();
    const handle = await root.getFileHandle(fileName, { create: true });
    const id = (window as any).__POWERNOTE_STORES__.workspace.getState().workspace.id;
    await (window as any).__mods['/src/utils/fileHandleStore.ts'].setHandleForNotebook(id, handle);
  }, name);
}

async function readOpfsFile(page: import('@playwright/test').Page, name: string): Promise<string> {
  return page.evaluate(async (fileName) => {
    const root = await (navigator.storage as any).getDirectory();
    const handle = await root.getFileHandle(fileName, { create: true });
    return (await handle.getFile()).text();
  }, name);
}

test.describe('204 - Autosave to the linked file and failure reporting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('every change is written to the linked file when permission is granted', async ({ page }) => {
    await linkOpfsFile(page, 'linked-204.html');
    await edit(page, 'linked-204', 'written to the file');

    await expect.poll(() => readOpfsFile(page, 'linked-204.html'), { timeout: 8000 }).toContain('written to the file');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved-file');
    await expect(page.getByTestId('save-status')).toContainText('linked-204.html');
  });

  test('a link that needs permission again shows Reconnect, and one click saves to the file', async ({ page }) => {
    await page.evaluate(() => {
      const proto = (window as any).FileSystemHandle.prototype;
      (window as any).__granted = false;
      proto.queryPermission = async () => ((window as any).__granted ? 'granted' : 'prompt');
      proto.requestPermission = async () => {
        (window as any).__granted = true;
        return 'granted';
      };
    });
    await linkOpfsFile(page, 'reconnect-204.html');
    await edit(page, 'reconnect-204', 'after reconnecting');

    // Still safe in the browser, but the file is not written without a click.
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'needs-permission', { timeout: 8000 });
    expect(await readOpfsFile(page, 'reconnect-204.html')).not.toContain('after reconnecting');

    await page.getByTestId('reconnect-file-btn').click();
    await expect.poll(() => readOpfsFile(page, 'reconnect-204.html'), { timeout: 8000 }).toContain('after reconnecting');
    await expect(page.getByTestId('reconnect-file-btn')).toBeHidden();
  });

  test('a browser that refuses the recovery copy says so, once, and shows the error state', async ({ page }) => {
    await page.evaluate(() => {
      IDBObjectStore.prototype.put = function () {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });
    await edit(page, 'quota-204', 'no room');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'error', { timeout: 8000 });
    await expect(page.getByTestId('toast').filter({ hasText: 'recovery copy' })).toHaveCount(1);
    // The notebook stays dirty: nothing durable holds the change.
    expect(await page.evaluate(() => (window as any).__POWERNOTE_STORES__.workspace.getState().isDirty)).toBe(true);

    // A second failing save does not toast again.
    await edit(page, 'quota-204b', 'still no room');
    await page.waitForTimeout(2500);
    await expect(page.getByTestId('toast').filter({ hasText: 'recovery copy' })).toHaveCount(1);
  });

  test('Recent notebooks lists the browser copy after a reload, reopens it, and deletes it on confirm', async ({ page }) => {
    await page.evaluate(() => (window as any).__POWERNOTE_STORES__.workspace.getState().updateWorkspace({ filename: 'Recent 204' }));
    await edit(page, 'recent-204', 'kept across reloads');
    await expect.poll(() => page.evaluate(() => !(window as any).__POWERNOTE_STORES__.workspace.getState().isDirty), { timeout: 8000 }).toBe(true);

    await page.reload();
    await waitForCanvasReady(page);
    await page.getByTestId('nav-library').click();
    const entry = page.getByTestId('library-entry').filter({ hasText: 'Recent 204' });
    await expect(entry).toHaveCount(1);

    await entry.getByTestId('library-load-btn').click();
    await expect
      .poll(() => page.evaluate(() =>
        (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.some((n: any) => n.id === 'recent-204'),
      ))
      .toBe(true);

    await page.getByTestId('nav-library').click();
    await page.getByTestId('library-entry').filter({ hasText: 'Recent 204' }).getByTestId('library-delete-btn').click();
    await page.getByTestId('library-delete-confirm').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('library-entry').filter({ hasText: 'Recent 204' })).toHaveCount(0);
  });
});
