/**
 * Test 222: links and pasting formatted text into a text block.
 * Covers: REQ-TEXT-045, REQ-TEXT-046
 *
 * Owner 2026-10-16: "make this a modern robust text editing feature".
 * Pasting from a web page, Word or Google Docs keeps the formatting as
 * markdown; Ctrl+K and pasting a URL over a selection make links.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  activateTool, clickCanvas, commitEditor, editorSelection, expectEditorValue, fillEditor,
  selectInEditor, textEditor, waitForCanvasReady,
} from '../helpers';

async function editing(page: Page, text: string) {
  await page.goto('/');
  await waitForCanvasReady(page);
  await activateTool(page, 'text');
  await clickCanvas(page, 400, 300);
  await expect(textEditor(page)).toBeFocused();
  await fillEditor(page, text);
}

/** Paste through a real paste event carrying both clipboard flavours. */
async function paste(page: Page, data: { html?: string; text: string }) {
  await page.evaluate(({ html, text }) => {
    const dt = new DataTransfer();
    if (html) dt.setData('text/html', html);
    dt.setData('text/plain', text);
    const target = document.querySelector('[data-testid="text-editor"]')!;
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
}

test('Ctrl+K opens the link box for the selection; pasting a URL over a word links it', async ({ page }) => {
  // REQ-TEXT-061 (supersedes REQ-TEXT-045): Ctrl+K asks for the address in a
  // small box; Enter applies it to the selected words.
  await editing(page, 'see the docs');
  await selectInEditor(page, 8, 12);
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('link-box-url')).toBeFocused();
  await page.keyboard.type('https://example.com');
  await page.keyboard.press('Enter');
  await expectEditorValue(page, 'see the [docs](https://example.com)');
  await expect(textEditor(page)).toBeFocused();
  const [from, to] = await editorSelection(page);
  expect(to).toBe(12);
  expect(from).toBeLessThanOrEqual(12);

  await fillEditor(page, 'read this');
  await selectInEditor(page, 5, 9);
  await paste(page, { text: 'https://example.org/page' });
  await expectEditorValue(page, 'read [this](https://example.org/page)');

  await commitEditor(page);
  await expect(page.locator('.powernote-markdown a')).toHaveAttribute('href', 'https://example.org/page');
});

test('pasted web HTML keeps headings, bold, italics, lists and links', async ({ page }) => {
  await editing(page, '');
  await paste(page, {
    html: '<h2>Trip</h2><p>Bring <b>passport</b> and <i>snacks</i>.</p><ul><li>Train at 9</li><li>See <a href="https://example.com">map</a></li></ul>',
    text: 'Trip\nBring passport and snacks.\nTrain at 9\nSee map',
  });
  await expectEditorValue(page, '## Trip\n\nBring **passport** and *snacks*.\n\n- Train at 9\n- See [map](https://example.com)');
  await commitEditor(page);
  const md = page.locator('.powernote-markdown').first();
  await expect(md.locator('h2')).toHaveText('Trip');
  await expect(md.locator('strong')).toHaveText('passport');
  await expect(md.locator('li')).toHaveCount(2);
});

test('Google Docs and Word clipboards convert cleanly; plain text pastes as is', async ({ page }) => {
  await editing(page, '');
  // Google Docs wraps everything in a non-bold <b> and marks bold with a styled span.
  await paste(page, {
    html: '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:400">Plain then </span><span style="font-weight:700">bold</span></p></b>',
    text: 'Plain then bold',
  });
  await expectEditorValue(page, 'Plain then **bold**');

  // Word list paragraphs carry their bullet as text in a conditional comment.
  await fillEditor(page, '');
  await paste(page, {
    html: '<p class=MsoListParagraphCxSpFirst style="mso-list:l0 level1 lfo1"><![if !supportLists]><span>·<span>&nbsp;&nbsp;</span></span><![endif]>Alpha<o:p></o:p></p>' +
      '<p class=MsoListParagraphCxSpLast style="mso-list:l0 level1 lfo1"><![if !supportLists]><span>·<span>&nbsp;&nbsp;</span></span><![endif]>Beta<o:p></o:p></p>',
    text: '·  Alpha\n·  Beta',
  });
  await expectEditorValue(page, '- Alpha\n- Beta');

  // Code editors put coloured spans on the clipboard: that is plain text, not formatting.
  await fillEditor(page, '');
  await paste(page, { html: '<div><span style="color:#c00">const</span> <span>x = 1;</span></div>', text: 'const x = 1;' });
  await expectEditorValue(page, 'const x = 1;');
});
