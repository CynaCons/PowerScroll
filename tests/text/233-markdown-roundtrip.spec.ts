/**
 * Test 233: markdown written by agents and older files survives the text engine.
 * Covers: REQ-TEXT-064
 *
 * The editor and the finished block share one document model (docs/DESIGN_TEXT.md).
 * For every markdown shape the app stores (tests, the bridge, list habits),
 * parse → serialize → parse must give the same document and the same rendered
 * HTML; and opening a block then leaving it without a change must leave its
 * stored markdown byte for byte.
 */
import { expect, test, type Page } from '@playwright/test';
import { preloadModule, textEditor, waitForCanvasReady } from '../helpers';

const ENGINE = '/src/text/index.ts';
const RENDER = '/src/utils/renderMarkdown.ts';

/** Markdown the app actually stores. */
const CORPUS: [string, string][] = [
  ['plain', 'hello world'],
  ['hard-break', 'Trip\nBring passport and snacks.\nTrain at 9\nSee map'],
  ['paragraphs', 'First para\n\nSecond para'],
  ['heading+para', '# Export Test\nThis content should be in the file'],
  ['heading+inline', '# Header\n**bold** and *italic*'],
  ['doc-structure', '# Data Structures\n\n## Arrays\n- Fixed size\n- O(1) random access\n- O(n) insertion\n\n## Linked Lists\n- Dynamic size\n- O(n) access\n- O(1) insertion at head'],
  ['linear-algebra', '# Linear Algebra\n\n**Eigenvalues**: solutions to `det(A - λI) = 0`\n\n1. Find characteristic polynomial\n2. Solve for λ\n3. Find eigenvectors\n\n> Key insight: eigenvectors define the axes of transformation'],
  ['tasks', '## Markdown header\n\n- [x] done\n- [ ] todo'],
  ['tasks-checklist', '## Study Checklist\n- [x] Arrays reviewed\n- [x] Linked lists reviewed\n- [ ] Trees\n- [ ] Graphs\n- [ ] Hash tables'],
  ['task-nested', '- [ ] task\n  - [ ] subtask'],
  ['bullet-nested', '- parent\n  - child'],
  ['bullet-3-levels', '- a\n  - b\n    - c\n- d'],
  ['numbered-nested-4', '1. Parent\n    1. Child'],
  ['numbered-nested-bullet', '1. Parent\n    - child'],
  ['numbered-deep', '1. A\n    1. B\n    2. C\n2. D'],
  ['numbered-under-indented', '1. A\n  2. B'],
  ['numbered-start-3', '3. three\n4. four'],
  ['table', '| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |'],
  ['table-aligned', '| Left | Center | Right |\n|:-----|:------:|------:|\n| a | b | c |'],
  ['table-inline-fmt', '| Col |\n|---|\n| **bold** and $x^2$ |'],
  ['fence', '```\nconst x = 42;\nconsole.log(x);\n```'],
  ['fence-lang', '```ts\nconst x: number = 1;\n```'],
  ['math-inline', 'Einstein said $E = mc^2$'],
  ['math-display', '$$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$'],
  ['math-invalid', '$\\invalid{broken}$'],
  ['math-in-list', '- energy $E=mc^2$\n- area $$A = \\pi r^2$$'],
  ['math-with-star', 'product $a*b$ here'],
  ['dollar-not-math', 'Price is $5 and $10'],
  ['underline', 'Hello <u>brave</u> world'],
  ['underline+bold', 'Hello <u>**brave**</u> world'],
  ['bold-in-list', '- **row**\n- plain'],
  ['bold-partial', 'Plain then **bold** then plain'],
  ['italic-under', 'some _under_ and *star*'],
  ['strike', 'Hello ~~gone~~ world'],
  ['code-inline', 'use `npm i` here'],
  ['link', 'See [docs](https://example.com/a?b=1) now'],
  ['link-internal', 'Go to [Page Two](powernote://sec-1/page-2)'],
  ['autolink-bare', 'visit https://example.com today'],
  ['link-title-chars', '[a*b](https://x.y/z_1)'],
  ['hr', 'above\n\n---\n\nbelow'],
  ['lone-dash', 'two\n-'],
  ['double-dash', 'two\n--'],
  ['equals-under', 'title\n='],
  ['blockquote-multi', '> one\n> two'],
  ['middle-dot-bullets', '·  Alpha\n·  Beta'],
  ['escaped', 'a \\* b \\_ c \\# d'],
  ['html-br', 'one<br>two'],
  ['emoji+unicode', 'café — naïve ✓ 日本語'],
  ['empty-list-row', '- one\n- \n- three'],
  ['heading-in-list', '- item\n# Head'],
  ['trailing-spaces', 'line  \nnext'],
  ['numbers-paren', '1) one\n2) two'],
  ['star-bullets', '* a\n* b'],
  ['plus-bullets', '+ a\n+ b'],
  ['list-then-para', '- a\n- b\n\npara'],
  ['para-then-list-no-blank', 'intro\n- a\n- b'],
  ['loose-list', '- a\n\n- b'],
  ['bold-italic', '***both***'],
  ['long-words', 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW-1'],
  ['image', '![alt](data:image/png;base64,iVBORw0KGgo=)'],
  ['typed-punctuation', 'a * b _ c # d < e $ f [g] `h` \\ i'],
  ['entity', 'fish &amp; chips'],
  ['html-block', '<details open>x</details>\n\npara'],
  ['two-lists', '- a\n- b\n\n1. one\n2. two'],
];

interface Report { label: string; same: boolean; renderSame: boolean; out: string; error: string | null }

async function roundTrip(page: Page): Promise<Report[]> {
  return page.evaluate((corpus) => {
    const engine = (window as any).__mods['/src/text/index.ts'];
    const render = (window as any).__mods['/src/utils/renderMarkdown.ts'];
    const norm = (h: string) => h.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
    return corpus.map(([label, md]) => {
      try {
        const doc = engine.parseMarkdown(md);
        const out = engine.serializeMarkdown(doc);
        const again = engine.parseMarkdown(out);
        const twice = engine.serializeMarkdown(again);
        const same = doc.eq(again) && twice === out;
        const renderSame = norm(render.markdownToHtml(md)) === norm(render.markdownToHtml(out));
        return { label, same, renderSame, out, error: null };
      } catch (e) {
        return { label, same: false, renderSame: false, out: '', error: String(e) };
      }
    });
  }, CORPUS);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
  await preloadModule(page, ENGINE);
  await preloadModule(page, RENDER);
});

test('every stored markdown shape parses, serializes and parses back to the same document', async ({ page }) => {
  const reports = await roundTrip(page);
  const failed = reports.filter((r) => !r.same || !r.renderSame || r.error);
  expect(
    failed.map((r) => `${r.label}: ${r.error ?? (r.same ? 'renders differently' : 'doc differs')} -> ${JSON.stringify(r.out)}`),
  ).toEqual([]);
  expect(reports).toHaveLength(CORPUS.length);
});

test('the rendered HTML never carries script, and task rows render a box without a bullet', async ({ page }) => {
  const html = await page.evaluate(() => {
    const render = (window as any).__mods['/src/utils/renderMarkdown.ts'];
    return render.markdownToHtml('- [ ] todo\n- [x] done\n\n<img src=x onerror="window.__pwned=1">\n\n[go](powernote://s/p)');
  });
  expect(html).not.toMatch(/onerror/);
  expect(html).toContain('powernote://s/p');
  expect(html.match(/type="checkbox"/g)).toHaveLength(2);
  expect(html).toContain('task-list-item');
});

const TRICKY = [
  '| Name | Age |\n|------|-----|\n| Alice | 30 |',
  'Einstein said $E = mc^2$ and $$x$$',
  '1. A\n    1. B\n    2. C\n2. D',
  '* a\n* b',
  '1) one\n2) two',
  'Hello <u>brave</u> world',
  'Trip\nBring passport\nSee map',
  '- [ ] task\n  - [x] subtask',
  'two\n-',
];

test('opening a block and leaving it without changes keeps its markdown byte-identical', async ({ page }) => {
  test.setTimeout(60000);
  await page.evaluate((texts) => {
    const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
    texts.forEach((text: string, i: number) => canvas.addNode({
      id: `rt-${i}`, type: 'text', x: 40 + (i % 3) * 400, y: 80 + Math.floor(i / 3) * 170, width: 380, height: 30,
      data: { text, fontSize: 16, fontFamily: 'Inter, sans-serif', fontStyle: 'normal', fill: '#1a1a1a' },
    }));
  }, TRICKY);
  await expect(page.locator('.powernote-markdown')).toHaveCount(TRICKY.length);

  for (let i = 0; i < TRICKY.length; i++) {
    const block = page.locator('.powernote-markdown').nth(i);
    const box = (await block.boundingBox())!;
    await page.mouse.dblclick(box.x + 30, box.y + 12);
    await expect(textEditor(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(textEditor(page)).toHaveCount(0);
    const stored = await page.evaluate((id) => {
      const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
      return canvas.nodes.find((n: any) => n.id === id).data.text;
    }, `rt-${i}`);
    expect(stored, `block ${i}: ${JSON.stringify(TRICKY[i])}`).toBe(TRICKY[i]);
  }
});
