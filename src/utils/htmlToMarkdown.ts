/**
 * Clipboard HTML → markdown, so pasting from a web page, Word, Google Docs or
 * OneNote keeps bold, italics, lists, links, headings, tables and code.
 */
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/** Tags whose presence means the HTML carries formatting worth keeping. */
const SEMANTIC_RE = /<(b|strong|i|em|u|s|del|strike|a\s|ul|ol|li|h[1-6]|table|pre|code|blockquote)\b|font-weight:\s*(bold|[6-9]00)|font-style:\s*italic|mso-list/i;

let service: TurndownService | null = null;

function turndown(): TurndownService {
  if (service) return service;
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    hr: '---',
  });
  td.use(gfm);
  td.remove(['style', 'script', 'meta', 'title', 'head']);
  // Google Docs wraps the whole clipboard in <b style="font-weight:normal">.
  td.addRule('notBold', {
    filter: (node) =>
      (node.nodeName === 'B' || node.nodeName === 'STRONG') &&
      /font-weight:\s*(normal|[1-4]00)/i.test(node.getAttribute('style') ?? ''),
    replacement: (content) => content,
  });
  // Docs and OneNote mark bold/italic with inline styles on spans.
  td.addRule('styledSpan', {
    filter: (node) =>
      node.nodeName === 'SPAN' &&
      /font-weight:\s*(bold|[6-9]00)|font-style:\s*italic/i.test(node.getAttribute('style') ?? ''),
    replacement: (content, node) => {
      if (!content.trim()) return content;
      const style = (node as HTMLElement).getAttribute('style') ?? '';
      const bold = /font-weight:\s*(bold|[6-9]00)/i.test(style);
      const italic = /font-style:\s*italic/i.test(style);
      const mark = (bold ? '**' : '') + (italic ? '*' : '');
      const lead = content.match(/^\s*/)![0];
      const trail = content.match(/\s*$/)![0];
      return `${lead}${mark}${content.trim()}${[...mark].reverse().join('')}${trail}`;
    },
  });
  td.addRule('underline', {
    filter: ['u'],
    replacement: (content) => (content.trim() ? `<u>${content}</u>` : content),
  });
  service = td;
  return td;
}

/** Word list paragraphs carry their bullet as text; turn them into list items. */
function wordLists(html: string): string {
  return html.replace(
    /<p([^>]*mso-list:[^>]*level(\d)[^>]*)>([\s\S]*?)<\/p>/gi,
    (_all, _attrs, level: string, inner: string) => {
      const text = inner.replace(/<!\[if !supportLists\]>[\s\S]*?<!\[endif\]>/gi, '');
      return `<p>LISTITEM${level}~${text}</p>`;
    },
  );
}

/**
 * Convert clipboard HTML to markdown. Returns null when the HTML carries no
 * formatting (the plain text is then the better paste).
 */
export function htmlToMarkdown(html: string): string | null {
  if (!html || !SEMANTIC_RE.test(html)) return null;
  const cleaned = wordLists(
    html
      .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
      .replace(/<\/?o:p>/gi, '')
      .replace(/<!--StartFragment-->|<!--EndFragment-->/g, ''),
  );
  let md = turndown().turndown(cleaned);
  md = md.replace(/^LISTITEM(\d)~\s*/gm, (_m, level: string) => `${'  '.repeat(Number(level) - 1)}- `);
  md = md.replace(/\u00a0/g, ' ').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  // Turndown pads list markers ('-   item'); one space is what the editor writes.
  md = md.replace(/^(\s*)([-*+]|\d+\.)[ ]{2,}/gm, '$1$2 ');
  // Word gives every list item its own paragraph: keep the rows together.
  md = md.replace(/^(\s*- .*)\n\n(?=\s*- )/gm, '$1\n').replace(/^(\s*- .*)\n\n(?=\s*- )/gm, '$1\n');
  return md || null;
}
