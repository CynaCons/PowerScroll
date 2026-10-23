/**
 * Test 235: formatting that starts or ends next to punctuation or inside a
 * word is stored so it renders exactly as edited; loose checklists keep their
 * boxes.
 * Covers: REQ-TEXT-075, REQ-TEXT-063, REQ-TEXT-064
 *
 * Showcase capture 2026-10-23: unbolding "Friday" in a bold "…ship on
 * Friday." stored `…on** Friday**.**` and the block showed a literal
 * `Friday**.**` (CommonMark: `**` between "y" and "." cannot open). The same
 * class of fault exists for every mark boundary next to punctuation or inside
 * a word. And `- apples\n- pears\n\n- [ ] book hotel` (a loose list) showed a
 * box AND the literal "[ ] book hotel".
 *
 * (a) is the owner's path with real input; (b) sweeps every range at token
 * boundaries of punctuation-heavy sentences through the engine in the page.
 */
import { expect, test, type Page } from '@playwright/test';
import { preloadModule, textEditor, waitForCanvasReady } from '../helpers';
import {
  addTextBlock, clickAway, editBlock, FINISHED, finishedBlock, finishedText, newBlock, rendered, selectBlock,
  selectWordInEditor, storedText,
} from './text-user';

const ENGINE = '/src/text/index.ts';
const RENDER = '/src/utils/renderMarkdown.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
});

test('unbolding a word before a full stop in a bold sentence shows no stray asterisks, now and after reopening', async ({ page }) => {
  await newBlock(page, 'Meeting notes for Monday. We agreed to ship on Friday.');
  await clickAway(page);
  await selectBlock(page, 'Monday');
  await page.getByTestId('format-bold').click();
  await expect.poll(() => storedText(page)).toMatch(/^\*\*Meeting/);

  await editBlock(page, 'Friday');
  await selectWordInEditor(page, 'Friday');
  await page.getByTestId('format-bold').click();
  await clickAway(page);

  const text = 'Meeting notes for Monday. We agreed to ship on Friday.';
  expect(await finishedText(page, 'Meeting')).toBe(text);
  expect((await rendered(page, 'Friday')).weight).toBeLessThan(600);
  expect((await rendered(page, 'ship on')).weight).toBeGreaterThanOrEqual(600);
  const dot = await page.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.textContent === '.' || n.textContent!.endsWith('Friday.')) return Number(getComputedStyle(n.parentElement!).fontWeight);
    }
    return -1;
  }, FINISHED);
  expect(dot, 'the full stop after Friday is still bold').toBeGreaterThanOrEqual(600);

  await editBlock(page, 'Monday');
  await clickAway(page);
  expect(await finishedText(page, 'Meeting')).toBe(text);
  expect((await rendered(page, 'Friday')).weight).toBeLessThan(600);
  await expect(finishedBlock(page, 'Meeting').locator('strong')).toHaveCount(2);
});

const SENTENCES = [
  'Ship on Friday. (Done!) "Yes," she said; a-b c_d e*f',
  'Prices: $5, 10% off [sale]! Email me@x.org — ok?',
  'snake_case_name and *star* plus a.b.c',
];
const KINDS = ['strong', 'em', 'strike', 'underline', 'code', 'strong+em'];

interface Sweep { cases: number; failed: string[] }

/** Every [from, to) whose ends fall on token boundaries (word / space / punctuation changes). */
async function sweep(page: Page): Promise<Sweep> {
  return page.evaluate(({ sentences, kinds }) => {
    const engine = (window as any).__mods['/src/text/index.ts'];
    const render = (window as any).__mods['/src/utils/renderMarkdown.ts'];
    const { schema } = engine;
    const cls = (c: string) => (/\s/.test(c) ? 's' : /[\p{L}\p{N}]/u.test(c) ? 'w' : 'p');
    let cases = 0;
    const failed: string[] = [];
    const probe = document.createElement('div');
    for (const sentence of sentences) {
      const bounds: number[] = [0];
      for (let i = 1; i < sentence.length; i++) if (cls(sentence[i - 1]) !== cls(sentence[i])) bounds.push(i);
      bounds.push(sentence.length);
      for (const kind of kinds) {
        const marks = kind.split('+').map((k) => schema.marks[k].create());
        for (let a = 0; a < bounds.length; a++) {
          for (let b = a + 1; b < bounds.length; b++) {
            const from = bounds[a];
            const to = bounds[b];
            // Whitespace at the edges of a formatted run is stored outside the
            // markers (a bold space is invisible), so the expected document
            // carries the mark on the trimmed range; code keeps its spaces.
            let a0 = from;
            let b0 = to;
            if (kind !== 'code') {
              while (a0 < b0 && /\s/.test(sentence[a0])) a0++;
              while (b0 > a0 && /\s/.test(sentence[b0 - 1])) b0--;
            }
            if (a0 === b0) continue;
            const nodes = [];
            if (a0 > 0) nodes.push(schema.text(sentence.slice(0, a0)));
            nodes.push(schema.text(sentence.slice(a0, b0), marks));
            if (b0 < sentence.length) nodes.push(schema.text(sentence.slice(b0)));
            const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, nodes)]);
            cases++;
            let md = '';
            try {
              md = engine.serializeMarkdown(doc);
              const back = engine.parseMarkdown(md);
              probe.innerHTML = render.markdownToHtml(md);
              const text = probe.textContent ?? '';
              if (!doc.eq(back)) failed.push(`${kind} [${from},${to}) ${JSON.stringify(sentence.slice(from, to))}: doc differs -> ${JSON.stringify(md)}`);
              else if (text !== sentence) failed.push(`${kind} [${from},${to}): text ${JSON.stringify(text)} -> ${JSON.stringify(md)}`);
            } catch (e) {
              failed.push(`${kind} [${from},${to}): threw ${String(e)} -> ${JSON.stringify(md)}`);
            }
          }
        }
      }
    }
    return { cases, failed };
  }, { sentences: SENTENCES, kinds: KINDS });
}

test('every mark over every token-boundary range of punctuation-heavy sentences survives serialize and parse', async ({ page }) => {
  test.setTimeout(120000);
  await preloadModule(page, ENGINE);
  await preloadModule(page, RENDER);
  const result = await sweep(page);
  expect(result.cases).toBeGreaterThan(3000);
  expect(result.failed.slice(0, 40), `${result.failed.length} of ${result.cases} cases failed`).toEqual([]);
  expect(result.failed).toHaveLength(0);
});

test.describe('loose checklists (REQ-TEXT-063, REQ-TEXT-064)', () => {
  const LOOSE = '- apples\n- pears\n\n- [ ] book hotel\n- [x] renew passport';

  test('a checklist after a bullet list with a blank line shows boxes, not "[ ]", finished and editing', async ({ page }) => {
    await addTextBlock(page, 'loose', LOOSE, 'hotel');
    const block = finishedBlock(page, 'hotel');
    await expect(block.locator('input[type="checkbox"]')).toHaveCount(2);
    await expect(block.locator('input[type="checkbox"]').nth(1)).toBeChecked();
    expect(await finishedText(page, 'hotel')).not.toMatch(/\[[ x]\]/);
    await editBlock(page, 'apples');
    const live = await textEditor(page).innerText();
    expect(live).not.toMatch(/\[[ x]\]/);
    await expect(textEditor(page).locator('input[type="checkbox"]')).toHaveCount(2);
    await page.keyboard.press('Escape');
    expect(await storedText(page, 'loose'), 'a no-op session keeps the text byte for byte').toBe(LOOSE);
  });

  test('loose task lists of every shape round-trip with their checked states', async ({ page }) => {
    await preloadModule(page, ENGINE);
    const shapes = [
      LOOSE,
      '1. [ ] x\n\n2. [x] y',
      '- [ ] a\n\n  second para\n- [x] b',
      '- [ ] task\n\n  - [x] sub',
      '- [x] done\n\n- [ ] todo',
    ];
    const bad = await page.evaluate((list) => {
      const engine = (window as any).__mods['/src/text/index.ts'];
      const states = (doc: any) => {
        const out: (boolean | null)[] = [];
        doc.descendants((n: any) => { if (n.type.name === 'list_item') out.push(n.attrs.checked); return true; });
        return out;
      };
      const texts = (doc: any) => { const out: string[] = []; doc.descendants((n: any) => { if (n.isTextblock) out.push(n.textContent); return true; }); return out; };
      const out: string[] = [];
      for (const md of list) {
        const doc = engine.parseMarkdown(md);
        if (texts(doc).some((t: string) => /^\[[ xX]\]/.test(t))) out.push(`${JSON.stringify(md)}: box left in text ${JSON.stringify(texts(doc))}`);
        if (!states(doc).some((s) => s !== null)) out.push(`${JSON.stringify(md)}: no task rows`);
        const again = engine.parseMarkdown(engine.serializeMarkdown(doc));
        if (JSON.stringify(states(again)) !== JSON.stringify(states(doc)) || JSON.stringify(texts(again)) !== JSON.stringify(texts(doc))) {
          out.push(`${JSON.stringify(md)}: round trip changed -> ${JSON.stringify(engine.serializeMarkdown(doc))}`);
        }
      }
      return out;
    }, shapes);
    expect(bad).toEqual([]);
  });
});
