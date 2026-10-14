/**
 * Test 200: Storefront — the landing page is a canvas of scrolls
 * Covers: REQ-SITE-001, REQ-SITE-002, REQ-SITE-003, REQ-SITE-004, REQ-SITE-005
 *
 * The storefront is static HTML that GitHub Pages serves verbatim. The Vite
 * dev server serves the same files at /site/, which is what the page needs:
 * an HTTP origin, so its self-hosted fonts load (Chromium refuses font loads
 * from file:// as a CORS violation). Nothing on the page may come from the
 * network — the test asserts there is no Google Fonts link.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SITE_URL = '/site/index.html';
const NETWORK_NOISE = /\/@vite\/client|Failed to load resource: the server responded with a status of 404/;

test.describe('200 - Storefront', () => {
  test('the hero is a canvas of named scrolls, the first carrying the primary actions', async ({ page }) => {
    await page.goto(SITE_URL);
    const scrolls = page.locator('[data-testid="hero-stage"] [data-scroll]');
    await expect(scrolls).toHaveCount(3);
    await expect(scrolls.nth(0).locator('.scroll-title')).toHaveText('Start here');
    await expect(scrolls.nth(1).locator('.scroll-title')).toHaveText('How it works');
    await expect(scrolls.nth(2).locator('.scroll-title')).toHaveText('Agent workspace');
    await expect(scrolls.nth(0).locator('h1')).toContainText('A visual notebook');

    // Scrolls stand side by side on the canvas ground at desktop width.
    const [a, b] = await Promise.all([scrolls.nth(0).boundingBox(), scrolls.nth(1).boundingBox()]);
    expect(b!.x).toBeGreaterThan(a!.x + a!.width);

    await expect(page.getByTestId('hero-open')).toHaveAttribute('href', './app/');
    await expect(page.getByTestId('hero-download')).toHaveAttribute('href', /releases\/latest\/download\/PowerScroll\.html$/);
    await expect(page.getByTestId('header-open')).toHaveText('Open the notebook');
    await expect(page.getByTestId('hero-open')).toHaveText('Open the notebook');
    await expect(page.getByTestId('end-open')).toHaveText('Open the notebook');
  });

  test('a scroll resizes by dragging its handle and by arrow keys, within the clamp', async ({ page }) => {
    await page.goto(SITE_URL);
    const scroll = page.locator('[data-testid="hero-stage"] [data-scroll]').first();
    const handle = page.getByTestId('scroll-handle');
    const before = (await scroll.boundingBox())!;
    const grip = (await handle.boundingBox())!;
    const gx = grip.x + grip.width / 2;
    const gy = grip.y + grip.height / 2;

    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(gx + 60, gy, { steps: 6 });
    await expect(scroll).toHaveClass(/is-resizing/);
    await page.mouse.up();
    await expect(scroll).not.toHaveClass(/is-resizing/);

    const after = (await scroll.boundingBox())!;
    expect(after.width).toBeCloseTo(before.width + 60, 0);
    await expect(handle).toHaveAttribute('aria-valuenow', String(Math.round(after.width)));

    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    const nudged = (await scroll.boundingBox())!;
    expect(nudged.width).toBeCloseTo(after.width - 24, 0);

    for (let i = 0; i < 40; i++) await page.keyboard.press('Shift+ArrowLeft');
    expect((await scroll.boundingBox())!.width).toBeGreaterThanOrEqual(280);
    for (let i = 0; i < 40; i++) await page.keyboard.press('Shift+ArrowRight');
    expect((await scroll.boundingBox())!.width).toBeLessThanOrEqual(900);

    // Double-click resets to the natural width; the separator keeps reporting a value (a11y).
    await handle.dblclick();
    expect(await scroll.evaluate((el) => (el as HTMLElement).style.width)).toBe('');
    const natural = (await scroll.boundingBox())!;
    await expect(handle).toHaveAttribute('aria-valuenow', String(Math.round(natural.width)));
  });

  test('discovery metadata and captured screenshots are intact, and the page loads clean', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto(SITE_URL);

    await expect(page).toHaveTitle(/PowerScroll/);
    expect(await page.locator('meta[name="description"]').getAttribute('content')).toContain('notebook');
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe('https://cynacons.github.io/PowerScroll/');
    expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toMatch(/social-preview\.png$/);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}');
    expect(ld['@type']).toBe('SoftwareApplication');
    expect(ld.downloadUrl).toMatch(/PowerScroll\.html$/);

    // Every product screenshot is a file captured from the running app, shipped next to the page.
    const shots = await page.locator('img.frame-image').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src')));
    expect(shots.length).toBeGreaterThanOrEqual(2);
    for (const src of shots) expect(fs.existsSync(path.resolve('site', src!))).toBe(true);
    const natural = await page.locator('img.frame-image').evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).naturalWidth));
    for (const width of natural) expect(width).toBeGreaterThan(0);

    // Both families ship with the site (no Google Fonts request) and must actually load.
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return Array.from(document.fonts).filter((f) => f.status === 'loaded').map((f) => f.family);
    });
    expect(loaded).toContain('Recursive');
    expect(loaded).toContain('Inter');
    const fontLinks = await page.locator('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]').count();
    expect(fontLinks).toBe(0);

    expect(errors.filter((e) => !NETWORK_NOISE.test(e))).toEqual([]);
  });
});
