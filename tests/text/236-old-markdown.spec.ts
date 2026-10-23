/**
 * Test 236: markdown written by agents and older files renders as it did
 * before the redesign and survives saving.
 * Covers: REQ-TEXT-064, REQ-TEXT-016, REQ-TEXT-037
 *
 * A sweep of 544 stored strings through the v0.88.1 renderer and the v0.89.0
 * engine (2026-10-23) found these losses: reference-link definitions shown
 * as text, `$$x$$` literal, HTML entities literal, an image link losing its
 * link, `<mailto:>` autolinks lost on save, ordered-list continuation lines
 * gaining indent on every save, HTML blocks split into stray pieces, nested
 * lists 6-7 px taller per level, whitespace-only text one line high,
 * a code fence first in a list row preceded by an empty paragraph, runs of
 * spaces shown, adjacent bullet lists merging on save, U+200B deleted.
 *
 * Each case is rendered, round-tripped (parse -> serialize -> parse ->
 * render gives the same text, tags and height) and saved five times without
 * drifting, in the page through the engine's own modules.
 */
import { expect, test, type Page } from '@playwright/test';
import { preloadModule, waitForCanvasReady } from '../helpers';

const ENGINE = '/src/text/index.ts';
const RENDER = '/src/utils/renderMarkdown.ts';

interface Metrics { text: string; tags: string; height: number; html: string }
interface Probe { first: Metrics; again: Metrics; md2: string; cycles: string[]; error: string | null }

const MEANINGFUL = 'p h1 h2 h3 h4 h5 h6 ul ol li input a strong em u s del code pre blockquote hr table tr th td img br details summary';

/** Render a string, round-trip it, save it five times. Runs in the page. */
async function probe(page: Page, cases: string[]): Promise<Record<string, Probe>> {
  return page.evaluate(({ cases, meaningful }) => {
    const engine = (window as any).__mods['/src/text/index.ts'];
    const render = (window as any).__mods['/src/utils/renderMarkdown.ts'];
    const want = new Set(meaningful.split(' '));
    const box = document.createElement('div');
    box.className = 'powernote-markdown';
    Object.assign(box.style, {
      width: '400px', boxSizing: 'border-box', fontSize: '16px', fontFamily: 'Inter, sans-serif', padding: '4px',
      lineHeight: '1.4', whiteSpace: 'pre-wrap', wordWrap: 'break-word', overflowWrap: 'break-word',
      position: 'absolute', left: '-9999px', top: '0', visibility: 'hidden',
    });
    document.body.appendChild(box);
    const metrics = (md: string) => {
      const html = render.markdownToHtml(md);
      box.innerHTML = html;
      // The engine's rows carry a <p> (v0.88.1's did not); it is layout-neutral in tight lists and not counted.
      const rowParagraph = (el: Element) => el.tagName === 'P' && (el.parentElement?.tagName === 'LI' || el.parentElement?.classList.contains('task-list-body'));
      const tags = Array.from(box.querySelectorAll('*'))
        .filter((el) => want.has(el.tagName.toLowerCase()) && !el.closest('.katex') && !rowParagraph(el))
        .map((el) => el.tagName.toLowerCase() + (el.tagName === 'INPUT' ? ((el as HTMLInputElement).checked ? '[x]' : '[ ]') : ''))
        .join(' ');
      const text = (box.textContent ?? '').replace(/\s+/g, ' ').trim();
      return { text, tags, height: box.offsetHeight, html };
    };
    const out: Record<string, any> = {};
    for (const s of cases) {
      try {
        const first = metrics(s);
        const md2 = engine.serializeMarkdown(engine.parseMarkdown(s));
        const again = metrics(md2);
        const cycles: string[] = [];
        let md = md2;
        for (let i = 0; i < 5; i++) {
          md = engine.serializeMarkdown(engine.parseMarkdown(md));
          cycles.push(md);
        }
        out[s] = { first, again, md2, cycles, error: null };
      } catch (e) {
        out[s] = { error: String(e) };
      }
    }
    box.remove();
    return out;
  }, { cases, meaningful: MEANINGFUL });
}

const CASES: Record<string, string> = {
  refLink: '[ref link][r]\n\n[r]: https://example.com',
  refCollapsed: '[collapsed][]\n\n[collapsed]: https://example.com "T"',
  refShortcut: '[shortcut]\n\n[shortcut]: https://example.com',
  refUnused: '[x]: https://unused.example\n\ntext only',
  mathShort: '$$x$$',
  mathInline: 'a $$y$$ b',
  mathLines: 'before\n$$x$$\nafter',
  entities: 'Arrows &rarr; &larr; dashes &mdash; &ndash; dots &hellip; &euro; &trade; &deg; &copy; &#169; &#x2014;',
  imageLink: '[![img link](https://example.com/i.png)](https://x.com)',
  mailto: '<mailto:a@b.com>',
  orderedPara: '1. a\n\n   b\n2. c',
  orderedLazy: '1. a\nparagraph after ordered',
  details: '<details><summary>More</summary>\n\nHidden body\n\n</details>',
  divCenter: '<div align="center">\n\n**centered md**\n\n</div>',
  nested4: '- a\n  - b\n    - c\n- d',
  nested3: '- a\n  - b\n    - c',
  bulletUnderOrdered: '1. a\n    - bullet under ordered',
  taskNested: '- [ ] parent\n  - [x] child\n    - [ ] grandchild',
  orderedUnderBullet: '- a\n  1. ordered under bullet\n  2. two',
  space: ' ',
  tab: '\t',
  newline: '\n',
  empty: '',
  fenceInItem: '- ```\n  code in item\n  ```',
  spaces: 'Multiple   spaces   inside',
  lazyIndent: 'para\n    not code (lazy)',
  indentedContinuation: 'line\n  indented continuation',
  threeLists: '* star\n+ plus\n- dash',
  zeroWidth: 'Zero​width',
};

/** Heights of the v0.88.1 renderer at 400 px / 16 px (sweep of 2026-10-23). */
const OLD_HEIGHT: Record<string, number> = { nested4: 110, nested3: 82, bulletUnderOrdered: 59, taskNested: 82, orderedUnderBullet: 84, space: 8, tab: 8, newline: 8 };

let result: Record<string, Probe>;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForCanvasReady(page);
  await preloadModule(page, ENGINE);
  await preloadModule(page, RENDER);
  result = await probe(page, Object.values(CASES));
});

const of = (key: string) => {
  const r = result[CASES[key]];
  expect(r.error, `${key} threw`).toBeNull();
  return r;
};

test('every case renders the same after a round trip and does not drift over five saves', async () => {
  const bad: string[] = [];
  for (const key of Object.keys(CASES)) {
    const r = result[CASES[key]];
    if (r.error) { bad.push(`${key}: threw ${r.error}`); continue; }
    if (r.first.text !== r.again.text) bad.push(`${key}: text ${JSON.stringify(r.first.text)} -> ${JSON.stringify(r.again.text)} via ${JSON.stringify(r.md2)}`);
    if (r.first.tags !== r.again.tags) bad.push(`${key}: tags ${JSON.stringify(r.first.tags)} -> ${JSON.stringify(r.again.tags)} via ${JSON.stringify(r.md2)}`);
    if (Math.abs(r.first.height - r.again.height) > 2) bad.push(`${key}: height ${r.first.height} -> ${r.again.height} via ${JSON.stringify(r.md2)}`);
    if (r.cycles.some((c) => c !== r.md2)) bad.push(`${key}: drifts ${JSON.stringify(r.md2)} -> ${JSON.stringify(r.cycles[4])}`);
  }
  expect(bad).toEqual([]);
});

test('reference links resolve and their definitions never show (M1)', async () => {
  for (const key of ['refLink', 'refCollapsed', 'refShortcut']) {
    const r = of(key);
    expect(r.first.tags, key).toBe('p a');
    expect(r.first.html, key).toContain('href="https://example.com"');
    expect(r.first.text, key).not.toContain('https://');
    expect(r.again.text, key).toBe(r.first.text);
  }
  expect(of('refUnused').first.text).toBe('text only');
  expect(of('refUnused').again.text).toBe('text only');
});

test('short display math and inline $$...$$ render as formulas (M2)', async () => {
  for (const key of ['mathShort', 'mathInline', 'mathLines']) {
    const r = of(key);
    expect(r.first.html, key).toContain('katex');
    expect(r.first.text, key).not.toContain('$$');
    expect(r.again.html, key).toContain('katex');
  }
  expect(of('mathLines').first.tags).toBe('p br br');
  expect(of('mathLines').first.text).toMatch(/^before.*after$/);
});

test('named and numeric HTML entities are decoded (M3)', async () => {
  const r = of('entities');
  expect(r.first.text).toBe('Arrows → ← dashes — – dots … € ™ ° © © —');
  expect(r.again.text).toBe(r.first.text);
  expect(r.md2).not.toContain('&');
});

test('an image inside a link keeps its link (M4)', async () => {
  const r = of('imageLink');
  expect(r.first.tags).toBe('p a img');
  expect(r.again.tags).toBe('p a img');
  expect(r.md2).toBe('[![img link](https://example.com/i.png)](https://x.com)');
});

test('a <mailto:> autolink survives a save (M5)', async () => {
  const r = of('mailto');
  expect(r.first.tags).toBe('p a');
  expect(r.again.tags).toBe('p a');
  expect(r.again.html).toContain('href="mailto:a@b.com"');
});

test('ordered-list continuation lines keep their indent over repeated saves (M6)', async () => {
  for (const key of ['orderedPara', 'orderedLazy']) {
    const r = of(key);
    expect(r.cycles[4], key).toBe(r.md2);
    expect(r.again.tags, key).not.toContain('pre');
    expect(r.again.tags, key).toBe(r.first.tags);
  }
});

test('HTML blocks with markdown inside keep their structure and leave no stray pieces (M7)', async () => {
  const d = of('details');
  expect(d.first.tags).toContain('details summary');
  expect(d.first.html).toMatch(/<details>[\s\S]*Hidden body[\s\S]*<\/details>/);
  expect(d.first.html).not.toMatch(/<div class="powernote-html"><\/div>/);
  expect(d.again.html).toBe(d.first.html);
  const c = of('divCenter');
  expect(c.first.html).toMatch(/<div align="center">[\s\S]*<strong>centered md<\/strong>[\s\S]*<\/div>/);
  expect(c.first.html).not.toMatch(/<div class="powernote-html"><\/div>/);
  expect(c.again.html).toBe(c.first.html);
});

test('nested lists are no taller than before (m1)', async () => {
  for (const key of ['nested4', 'nested3', 'bulletUnderOrdered', 'taskNested', 'orderedUnderBullet']) {
    expect(of(key).first.height, `${key} height`).toBeLessThanOrEqual(OLD_HEIGHT[key] + 2);
  }
});

test('whitespace-only text renders empty and stays empty (m2)', async () => {
  for (const key of ['space', 'tab', 'newline', 'empty']) {
    const r = of(key);
    expect(r.first.text, key).toBe('');
    expect(r.first.height, `${key} height`).toBeLessThanOrEqual(OLD_HEIGHT.space + 2);
    expect(r.md2, key).toBe('');
  }
});

test('a code fence first in a list row has no empty paragraph above it (m3)', async () => {
  const r = of('fenceInItem');
  expect(r.first.html).not.toMatch(/<li><p><\/p>/);
  expect(r.first.tags).toBe('ul li pre code');
});

test('runs of spaces and indentation collapse as they always did (m4)', async () => {
  const r = of('spaces');
  expect(r.first.html).toContain('Multiple spaces inside');
  expect(of('lazyIndent').first.html).not.toMatch(/<br>\s+not/);
  expect(of('lazyIndent').first.tags).toBe('p br');
  expect(of('indentedContinuation').first.html).toMatch(/<br>indented/);
});

test('three adjacent bullet lists stay three lists after a save (m5)', async () => {
  const r = of('threeLists');
  expect(r.first.tags).toBe('ul li ul li ul li');
  expect(r.again.tags).toBe('ul li ul li ul li');
});

test('a real U+200B in text is kept (m9)', async () => {
  const r = of('zeroWidth');
  expect(r.md2).toBe('Zero​width');
  expect(r.first.html).toContain('Zero​width');
});
