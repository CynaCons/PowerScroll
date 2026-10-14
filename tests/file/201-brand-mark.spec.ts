/**
 * Test 201: branded scroll mark assets
 * Covers: REQ-SETTINGS-017, REQ-SETTINGS-020
 */
import { test, expect } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { waitForCanvasReady } from '../helpers';

const root = resolve(import.meta.dirname, '../..');

async function pngDimensions(path: string) {
  const png = await readFile(path);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test.describe('201 - Brand mark (REQ-SETTINGS-017, REQ-SETTINGS-020)', () => {
  test('uses the scroll glyph in favicon, icons, manifest, and rail', async ({ page }) => {
    const favicon = await readFile(resolve(root, 'public/favicon.svg'), 'utf8');
    expect(favicon).not.toContain('<text');
    expect(favicon).toContain('M10.667 28h16');
    expect(await stat(resolve(root, 'public/icons/icon-192.png'))).toBeTruthy();
    expect(await stat(resolve(root, 'public/icons/icon-512.png'))).toBeTruthy();
    await expect(pngDimensions(resolve(root, 'public/icons/icon-192.png'))).resolves.toEqual({ width: 192, height: 192 });
    await expect(pngDimensions(resolve(root, 'public/icons/icon-512.png'))).resolves.toEqual({ width: 512, height: 512 });
    const manifest = await readFile(resolve(root, 'public/manifest.webmanifest'), 'utf8');
    expect(manifest).toContain('icon-192.png');
    expect(manifest).toContain('icon-512.png');

    await page.goto('/');
    await waitForCanvasReady(page);
    await expect(page.getByTestId('nav-hierarchy').locator('svg.lucide-scroll')).toHaveCount(1);
  });
});
