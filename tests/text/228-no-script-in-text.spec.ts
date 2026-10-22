/**
 * Test 228: Raw HTML in a text block never runs script.
 * Covers: REQ-TEXT-053
 *
 * Found by the v0.89.0 audit: typing <img src=x onerror="..."> in a block ran
 * the handler when the block was shown, because the rendered markdown went
 * into the page unsanitised. A notebook file or an agent-written block could
 * run code. The harmless HTML the app writes itself (<u>) still renders.
 */
import { expect, test } from '@playwright/test';
import { getCanvasStore, waitForCanvasReady } from '../helpers';

const ATTACKS = [
  '<img src=x onerror="window.__pwned = 1">',
  '<svg onload="window.__pwned = 2"></svg>',
  '<a href="javascript:window.__pwned=3" id="jslink">click</a>',
  '<iframe srcdoc="<script>parent.__pwned = 4</script>"></iframe>',
  '<script>window.__pwned = 5</script>',
  '<details open ontoggle="window.__pwned = 6">x</details>',
];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
});

test('script in a block, from a file or an agent, does not run', async ({ page }) => {
  page.on('dialog', (d) => d.dismiss());
  await page.evaluate((attacks) => {
    const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
    attacks.forEach((text: string, i: number) => canvas.addNode({
      id: `attack-${i}`, type: 'text', x: 100, y: 100 + i * 80, width: 400, height: 30,
      data: { text: `before ${text} after`, fontSize: 16, fontFamily: 'Inter, sans-serif', fontStyle: 'normal', fill: '#1a1a1a' },
    }));
  }, ATTACKS);
  await expect(page.locator('.powernote-markdown')).toHaveCount(ATTACKS.length);
  // Give onerror/onload a chance to fire.
  await page.waitForTimeout(500);
  const link = page.locator('.powernote-markdown a');
  if (await link.count()) {
    const href = await link.first().getAttribute('href');
    expect(href ?? '').not.toMatch(/^javascript:/i);
  }
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  await expect(page.locator('.powernote-markdown iframe, .powernote-markdown script')).toHaveCount(0);
  // The words around the HTML are still there.
  await expect(page.locator('.powernote-markdown').first()).toContainText('before');
  await expect(page.locator('.powernote-markdown').first()).toContainText('after');
});

test('underline, task boxes, math and page links still render', async ({ page }) => {
  await page.evaluate(() => {
    const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
    canvas.addNode({
      id: 'safe', type: 'text', x: 100, y: 100, width: 500, height: 30,
      data: {
        text: 'an <u>underlined</u> word\n\n- [ ] task\n\n$x^2$\n\n[Other page](powernote://s1/p1)',
        fontSize: 16, fontFamily: 'Inter, sans-serif', fontStyle: 'normal', fill: '#1a1a1a',
      },
    });
  });
  const block = page.locator('.powernote-markdown');
  await expect(block.locator('u')).toHaveText('underlined');
  await expect(block.locator('input[type="checkbox"]')).toHaveCount(1);
  await expect(block.locator('.katex')).toHaveCount(1);
  await expect(block.locator('a')).toHaveAttribute('href', 'powernote://s1/p1');
  expect((await getCanvasStore(page)).nodes).toHaveLength(1);
});
