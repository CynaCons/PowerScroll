/**
 * Test 181: Settings → Extensions install flow
 * Covers: REQ-SETTINGS-018
 *
 * The asset is a tiny FAKE viewer (deflate-raw+base64, defines GraphViewer so
 * validation passes) served via page.route through the __POWERNOTE_EXT_URL__
 * override — the real 1.1 MB asset stays out of the install tests. IDB
 * persistence is proven by unrouting the asset and reloading: the status must
 * come back "installed" with nothing left to fetch it from.
 */
import { test, expect } from '@playwright/test';
import { deflateRawSync } from 'node:zlib';
import { waitForCanvasReady } from '../helpers';

const FAKE_JS =
  'window.GraphViewer=function(){};window.GraphViewer.createViewerForElement=function(){};';
const FAKE_B64 = deflateRawSync(Buffer.from(FAKE_JS, 'utf8')).toString('base64');
const EXT_BASE = `http://localhost:${process.env.PW_PORT ?? 5193}/fake-ext`;

async function routeFakeAsset(page: import('@playwright/test').Page) {
  await page.route(`${EXT_BASE}/ext/drawio-viewer.b64`, (route) =>
    route.fulfill({ contentType: 'text/plain', body: FAKE_B64 }),
  );
  await page.route(`${EXT_BASE}/ext/drawio-viewer.json`, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ drawioVersion: '9.9.9-test' }) }),
  );
}

test.describe('181 - extension install via Settings (REQ-SETTINGS-018)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((base) => {
      (window as any).__POWERNOTE_EXT_URL__ = base;
    }, EXT_BASE);
    await routeFakeAsset(page);
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('install: not-installed → installing → installed vX, then persists via IDB', async ({
    page,
  }) => {
    await page.locator('[data-testid="nav-settings"]').click();

    const status = page.getByTestId('settings-ext-drawio-status');
    await expect(status).toHaveAttribute('data-status', 'not-installed');

    await page.getByTestId('settings-ext-drawio-install').click();
    await expect(status).toHaveAttribute('data-status', 'installed');
    await expect(status).toHaveText('Installed v9.9.9-test');
    await expect(page.getByTestId('settings-ext-drawio-install')).toHaveCount(0);

    // Reload with the asset UNREACHABLE: only IndexedDB can answer now.
    await page.unroute(`${EXT_BASE}/ext/drawio-viewer.b64`);
    await page.unroute(`${EXT_BASE}/ext/drawio-viewer.json`);
    await page.route(`${EXT_BASE}/**`, (route) => route.fulfill({ status: 404, body: '' }));
    await page.reload();
    await waitForCanvasReady(page);
    await page.locator('[data-testid="nav-settings"]').click();
    await expect(status).toHaveAttribute('data-status', 'installed');
    await expect(status).toHaveText('Installed v9.9.9-test');
  });

  test('a failing fetch reports failed with a Retry that recovers', async ({ page }) => {
    // Break the asset BEFORE any install this time.
    await page.unroute(`${EXT_BASE}/ext/drawio-viewer.b64`);
    await page.route(`${EXT_BASE}/ext/drawio-viewer.b64`, (route) =>
      route.fulfill({ status: 500, body: '' }),
    );

    await page.locator('[data-testid="nav-settings"]').click();
    await page.getByTestId('settings-ext-drawio-install').click();

    const status = page.getByTestId('settings-ext-drawio-status');
    await expect(status).toHaveAttribute('data-status', 'failed');
    await expect(page.getByTestId('settings-ext-drawio-error')).toBeVisible();

    // Heal the route; Retry succeeds.
    await page.unroute(`${EXT_BASE}/ext/drawio-viewer.b64`);
    await routeFakeAsset(page);
    await page.getByTestId('settings-ext-drawio-install').click();
    await expect(status).toHaveAttribute('data-status', 'installed');
  });
});
