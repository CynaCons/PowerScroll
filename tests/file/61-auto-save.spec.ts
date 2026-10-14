/**
 * Test 61: Debounced Auto-Save
 * Covers: REQ-FILE-017, REQ-FILE-028
 *
 * Verifies the new autosave pipeline:
 *   - An edit triggers a save within ~1.5–2 s (debounce window).
 *   - Autosave routes workspace data into the browser recovery store, not the
 *     legacy `powernote-autosave` localStorage key.
 *   - The legacy key is removed on startup even if a previous install
 *     left one behind.
 *   - Continuous editing still gets a forced save within ~5 s (max-wait).
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady, disableFSA } from '../helpers';

const LEGACY_KEY = 'powernote-autosave';
const LIBRARY_KEY = 'powernote-library';

async function recoveryContains(page: import('@playwright/test').Page, text: string) {
  return page.evaluate((needle) => new Promise<boolean>((resolve, reject) => {
    const r = indexedDB.open('powerscroll-recovery');
    r.onsuccess = () => { const q = r.result.transaction('notebooks').objectStore('notebooks').getAll(); q.onsuccess = () => resolve(JSON.stringify(q.result).includes(needle)); q.onerror = () => reject(q.error); };
    r.onerror = () => reject(r.error);
  }), text);
}

test.describe('61 - Debounced Auto-Save (REQ-FILE-015..017)', () => {
  test.beforeEach(async ({ page }) => {
    await disableFSA(page);
  });

  test('legacy powernote-autosave key is cleared on startup', async ({ page }) => {
    // Seed a legacy value before the app ever runs.
    await page.addInitScript((key) => {
      localStorage.setItem(key, JSON.stringify({ sections: [], filename: 'legacy' }));
    }, LEGACY_KEY);

    await page.goto('/');
    await waitForCanvasReady(page);

    const legacy = await page.evaluate((k) => localStorage.getItem(k), LEGACY_KEY);
    expect(legacy).toBeNull();
  });

  test('debounced autosave fires within ~2s after an edit', async ({ page }) => {
    await page.addInitScript((keys) => {
      localStorage.removeItem(keys.legacy);
      localStorage.removeItem(keys.lib);
    }, { legacy: LEGACY_KEY, lib: LIBRARY_KEY });

    await page.goto('/');
    await waitForCanvasReady(page);

    await page.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.workspace.getState().updateWorkspace({ filename: 'Debounce Test' });
      stores.canvas.getState().addNode({
        id: 'debounce-node',
        type: 'text',
        x: 150, y: 150, width: 120, height: 30, layer: 4,
        data: { text: 'Debounced save', fontSize: 16,
                fontFamily: 'Inter', fontStyle: 'normal', fill: '#1a1a1a' },
      });
      stores.workspace.getState().markDirty();
    });

    // Debounce is 1.5s; give it up to 3.5s before declaring a miss.
    await expect
      .poll(async () => {
        return recoveryContains(page, 'Debounced save');
      }, { timeout: 3500, intervals: [200, 300, 500] })
      .toBeTruthy();

    // Legacy key must not be written.
    const legacy = await page.evaluate((k) => localStorage.getItem(k), LEGACY_KEY);
    expect(legacy).toBeNull();
  });

  test('max-wait forces a save during continuous editing', async ({ page }) => {
    await page.addInitScript((keys) => {
      localStorage.removeItem(keys.legacy);
      localStorage.removeItem(keys.lib);
    }, { legacy: LEGACY_KEY, lib: LIBRARY_KEY });

    await page.goto('/');
    await waitForCanvasReady(page);

    // Install a canvas node once so library entries have something to track.
    await page.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.workspace.getState().updateWorkspace({ filename: 'Max Wait Test' });
      stores.canvas.getState().addNode({
        id: 'max-wait-node',
        type: 'text',
        x: 200, y: 200, width: 120, height: 30, layer: 4,
        data: { text: 'start', fontSize: 16,
                fontFamily: 'Inter', fontStyle: 'normal', fill: '#1a1a1a' },
      });
    });

    const start = Date.now();
    // Keep bumping dirty every 400ms for 5s so the 1.5s debounce timer
    // keeps getting reset. The 5s max-wait should still force a save.
    const keepEditing = (async () => {
      while (Date.now() - start < 5000) {
        await page.evaluate(() => {
          (window as any).__POWERNOTE_STORES__.workspace.getState().markDirty();
        });
        await page.waitForTimeout(400);
      }
    })();

    await expect
      .poll(async () => {
        return recoveryContains(page, 'Max Wait Test');
      }, { timeout: 6000, intervals: [250, 500] })
      .toBeTruthy();

    await keepEditing;
  });
});
