/**
 * Test 238: Search finds everything, as the reader sees it
 * Covers: REQ-SEARCH-014, REQ-SEARCH-015, REQ-SEARCH-016, REQ-SEARCH-017,
 * REQ-SEARCH-018, REQ-SEARCH-023
 */
import { test, expect, type Page } from '@playwright/test';
import { openFixture, NOTEBOOK } from './search-fixture';

const results = (page: Page) => page.getByTestId('search-result');

async function searchNotebook(page: Page, query: string) {
  await page.getByTestId('nav-search').click();
  await page.getByTestId('search-input').fill(query);
}

async function kinds(page: Page): Promise<string[]> {
  return results(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-kind') ?? ''));
}

test.describe('238 - What search finds (REQ-SEARCH-014..018, 023)', () => {
  test('one word finds text, image caption, scroll, page title and card - not the archived card', async ({ page }) => {
    await openFixture(page);
    await searchNotebook(page, 'harbour');
    await expect(results(page)).toHaveCount(5);
    expect((await kinds(page)).sort()).toEqual(['card', 'image', 'page', 'scroll', 'text']);
    await expect(page.getByTestId('search-panel')).not.toContainText('Old harbour task');
  });

  test('card description, checklist and notes, shape labels and diagram labels are found', async ({ page }) => {
    await openFixture(page);
    for (const [query, kind] of [
      ['spare part', 'card'],
      ['gasket', 'card'],
      ['the yard', 'card'],
      ['pump station', 'shape'],
      ['valve & control', 'diagram'],
      ['quay depths', 'image'],
      ['projects', 'section'],
    ] as const) {
      await searchNotebook(page, query);
      await expect(results(page), query).toHaveCount(1);
      expect(await kinds(page), query).toEqual([kind]);
      await page.keyboard.press('Escape');
    }
  });

  test('markdown symbols, link addresses and XML tags never match', async ({ page }) => {
    await openFixture(page);
    for (const query of ['zebra', 'example.com', '**', 'mxcell', 'vertex']) {
      await searchNotebook(page, query);
      await expect(page.getByTestId('search-panel'), query).toContainText('No results');
      await page.keyboard.press('Escape');
    }
  });

  test('a phrase across formatting is found and its snippet shows no symbols', async ({ page }) => {
    await openFixture(page);
    await searchNotebook(page, 'very bold move');
    await expect(results(page)).toHaveCount(1);
    const snippet = results(page).first().locator('.search-panel__result-snippet');
    await expect(snippet).toHaveText('A very bold move');
    await expect(snippet.locator('mark')).toHaveText('very bold move');
  });

  test('case and accents are ignored', async ({ page }) => {
    await openFixture(page);
    for (const query of ['ecole', 'ÉCOLE', 'Ecole Normale']) {
      await searchNotebook(page, query);
      await expect(results(page), query).toHaveCount(1);
      await expect(results(page).first().locator('mark'), query).toHaveText(/École/);
      await page.keyboard.press('Escape');
    }
  });

  test('each result says what matched and marks every occurrence', async ({ page }) => {
    await openFixture(page);
    await searchNotebook(page, 'tide');
    await expect(results(page)).toHaveCount(1);
    await expect(results(page).first().locator('.search-panel__result-kind')).toHaveText('Text');
    await expect(results(page).first().locator('mark')).toHaveCount(2);

    await page.keyboard.press('Escape');
    await searchNotebook(page, 'crane');
    await expect(results(page).first().locator('.search-panel__result-kind')).toHaveText('Card #1');
  });

  test('results are grouped under one Section > Page heading per page, in notebook order', async ({ page }) => {
    await openFixture(page);
    await searchNotebook(page, 'harbour');
    const groups = page.getByTestId('search-group');
    await expect(groups).toHaveText(['Research > Lab notes', 'Research > Harbour diary', 'Projects > Tasks']);
  });

  test('2,000 text blocks: each keystroke updates the results within 100 ms', async ({ page }) => {
    const big = JSON.parse(JSON.stringify(NOTEBOOK));
    const words = ['alpha', 'harbour', 'gamma', 'delta', 'omega'];
    // Twenty pages of 100 blocks, none of them open, as in a large notebook.
    for (let p = 0; p < 20; p++) {
      big.sections[0].pages.push({
        id: `big${p}`, title: `Bulk ${p}`,
        nodes: Array.from({ length: 100 }, (_, k) => {
          const i = p * 100 + k;
          return {
            id: `b${i}`, type: 'text', x: 100, y: 100 + k * 50, width: 400, height: 40, layer: 3,
            data: {
              text: `Block ${i} with **${words[i % 5]}** and [a link](https://x.y/${i}) - ${'filler text '.repeat(8)}`,
              fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#1a1a1a',
            },
          };
        }),
      });
    }
    await openFixture(page, 's1', 'p1', big);
    await page.getByTestId('nav-search').click();
    const times = await page.evaluate(async () => {
      const el = document.querySelector('[data-testid="search-input"]') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const out: number[] = [];
      let value = '';
      for (const ch of 'harbour') {
        value += ch;
        const t0 = performance.now();
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        out.push(performance.now() - t0);
      }
      return out;
    });
    console.log('keystroke ms:', times.map((t) => t.toFixed(1)).join(' '));
    await expect(page.getByTestId('search-count')).toHaveText('405 results');
    for (const t of times) expect(t).toBeLessThan(100);
  });
});
