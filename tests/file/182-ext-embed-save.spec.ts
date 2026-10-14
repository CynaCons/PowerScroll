/**
 * Test 182: an installed extension is embedded into saved notebooks
 * Covers: REQ-SETTINGS-019
 *
 * The dev save path REFETCHES the pristine template (which carries no
 * extension block), so a block appearing in buildExportHtml's output proves
 * the re-injection accessor works — DOM survival cannot explain it. Also
 * pins: exactly one block, idempotent re-injection, never raw executable JS.
 */
import { test, expect } from '@playwright/test';
import { deflateRawSync } from 'node:zlib';
import { waitForCanvasReady } from '../helpers';

const FAKE_JS =
  'window.GraphViewer=function(){};window.GraphViewer.createViewerForElement=function(){};';
const FAKE_B64 = deflateRawSync(Buffer.from(FAKE_JS, 'utf8')).toString('base64');
const EXT_BASE = `http://localhost:${process.env.PW_PORT ?? 5193}/fake-ext`;

test.describe('182 - extension embeds on save (REQ-SETTINGS-019)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((base) => {
      (window as any).__POWERNOTE_EXT_URL__ = base;
    }, EXT_BASE);
    await page.route(`${EXT_BASE}/ext/drawio-viewer.b64`, (route) =>
      route.fulfill({ contentType: 'text/plain', body: FAKE_B64 }),
    );
    await page.route(`${EXT_BASE}/ext/drawio-viewer.json`, (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ drawioVersion: '9.9.9-test' }) }),
    );
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('saved HTML carries the block exactly once, base64 only', async ({ page }) => {
    const result = await page.evaluate(async ({ b64 }) => {
      const ext = await import('/src/extensions/drawioViewer.ts');
      await ext.installDrawioViewer();

      const { buildExportHtml } = await import('/src/utils/serialization.ts');
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState().workspace;
      const html = await buildExportHtml(ws);
      const again = await buildExportHtml(ws);

      const embed = await import('/src/extensions/embed.ts');
      const exts = await ext.collectEmbeddedExtensions();
      const doubled = embed.injectExtensionBlocks(embed.injectExtensionBlocks(html, exts), exts);

      const count = (s: string) => s.split('id="powernote-ext-drawio"').length - 1;
      return {
        count: count(html),
        countAgain: count(again),
        countDoubled: count(doubled),
        hasVersion: html.includes('data-version="9.9.9-test"'),
        hasTextPlain: /<script id="powernote-ext-drawio" type="text\/plain"/.test(html),
        hasPayload: html.includes(b64),
        hasRawJs: html.includes('window.GraphViewer=function'),
        dataBlockStillThere: html.includes('id="powernote-data"'),
      };
    }, { b64: FAKE_B64 });

    expect(result.count).toBe(1);
    expect(result.countAgain).toBe(1);
    // Injection over already-injected HTML replaces, never duplicates —
    // that is what keeps prod outerHTML saves from growing 1.1 MB per save.
    expect(result.countDoubled).toBe(1);
    expect(result.hasVersion).toBe(true);
    expect(result.hasTextPlain).toBe(true);
    expect(result.hasPayload).toBe(true);
    expect(result.hasRawJs).toBe(false);
    expect(result.dataBlockStillThere).toBe(true);
  });

  test('without an install, saved HTML carries no block', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { buildExportHtml } = await import('/src/utils/serialization.ts');
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState().workspace;
      const html = await buildExportHtml(ws);
      return { count: html.split('id="powernote-ext-drawio"').length - 1 };
    });
    expect(result.count).toBe(0);
  });
});
