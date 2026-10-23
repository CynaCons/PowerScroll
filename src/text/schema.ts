/**
 * The text block's document model (docs/DESIGN_TEXT.md).
 *
 * One ProseMirror schema serves both the editor and the finished block: the
 * finished block is this schema's `toDOM` output, sanitised; the editor is the
 * same DOM, live. Nodes cover everything the app's markdown dialect can hold
 * (headings, lists with task rows, quotes, code, rules, images, math, GFM
 * tables, raw HTML kept literal) and marks cover the inline formats.
 */
import { Schema, type DOMOutputSpec, type Node as PMNode, type NodeSpec, type MarkSpec } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';
import katex from 'katex';
import DOMPurify from 'dompurify';

/** Page links (powernote://) on top of DOMPurify's default safe schemes. */
export const SAFE_URI = /^(?:(?:(?:f|ht)tps?|mailto|tel|powernote):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/** Strip anything that can run script (REQ-TEXT-053). */
export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') return html;
  return DOMPurify.sanitize(html, { ALLOWED_URI_REGEXP: SAFE_URI, FORBID_TAGS: ['style', 'form'] });
}

/** KaTeX HTML for a piece of math; an error renders as an empty red span. */
export function renderMath(source: string, displayMode: boolean): string {
  try {
    return katex.renderToString(source, { displayMode, throwOnError: false, output: 'html' });
  } catch {
    return `<span class="katex-error" style="color:#dc2626"></span>`;
  }
}

/** A DOM element whose inner HTML is the (sanitised) raw HTML the user wrote. */
function rawHtmlElement(tag: 'span' | 'div', html: string, display: boolean): HTMLElement {
  const el = document.createElement(tag);
  el.className = 'powernote-html';
  if (display) el.innerHTML = sanitizeHtml(html);
  return el;
}

let innerMarkdownRenderer: (markdown: string) => string = () => '';

/** The renderer used for markdown inside a raw HTML block (set by renderMarkdown.ts to avoid an import cycle). */
export function setInnerMarkdownRenderer(render: (markdown: string) => string): void {
  innerMarkdownRenderer = render;
}

/**
 * The HTML an html_block shows: the raw HTML, or, for a block that wraps
 * markdown (`<details>…</details>`, `<div align="center">…</div>`), its
 * opening tag, the markdown rendered, and its closing tag, the way the
 * browser always composed them.
 */
export function htmlBlockHtml(attrs: { html: string; open?: string | null; inner?: string | null; close?: string | null }): string {
  if (attrs.open && attrs.close) return `${attrs.open}${innerMarkdownRenderer(attrs.inner ?? '')}${attrs.close}`;
  return attrs.html;
}

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0],
  },

  heading: {
    attrs: { level: { default: 1 } },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (node) => [`h${node.attrs.level}`, 0],
  },

  blockquote: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', 0],
  },

  code_block: {
    attrs: { params: { default: '' } },
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    parseDOM: [{
      tag: 'pre',
      preserveWhitespace: 'full',
      getAttrs: (dom) => ({ params: (dom as HTMLElement).getAttribute('data-params') || '' }),
    }],
    toDOM: (node) => ['pre', node.attrs.params ? { 'data-params': node.attrs.params } : {}, ['code', 0]],
  },

  horizontal_rule: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM: () => ['hr'],
  },

  bullet_list: {
    attrs: { tight: { default: true } },
    content: 'list_item+',
    group: 'block',
    parseDOM: [{ tag: 'ul', getAttrs: (dom) => ({ tight: (dom as HTMLElement).hasAttribute('data-tight') }) }],
    toDOM: (node) => ['ul', node.attrs.tight ? { 'data-tight': 'true' } : {}, 0],
  },

  ordered_list: {
    attrs: { order: { default: 1 }, tight: { default: true } },
    content: 'list_item+',
    group: 'block',
    parseDOM: [{
      tag: 'ol',
      getAttrs: (dom) => ({
        order: (dom as HTMLElement).hasAttribute('start') ? +(dom as HTMLElement).getAttribute('start')! : 1,
        tight: (dom as HTMLElement).hasAttribute('data-tight'),
      }),
    }],
    toDOM: (node) => [
      'ol',
      { ...(node.attrs.order === 1 ? {} : { start: node.attrs.order }), ...(node.attrs.tight ? { 'data-tight': 'true' } : {}) },
      0,
    ],
  },

  list_item: {
    // checked: null = plain row; false/true = task row with its box (REQ-TEXT-063)
    attrs: { checked: { default: null } },
    // Any block may come first (a code fence can open a row, REQ-TEXT-064).
    content: 'block+',
    defining: true,
    parseDOM: [{
      tag: 'li',
      getAttrs: (dom) => {
        const el = dom as HTMLElement;
        const box = el.querySelector(':scope > input[type="checkbox"]') as HTMLInputElement | null;
        return { checked: box ? box.checked || box.hasAttribute('checked') : null };
      },
    }],
    toDOM: (node): DOMOutputSpec => {
      if (node.attrs.checked === null) return ['li', 0];
      return [
        'li',
        { class: 'task-list-item' },
        ['input', { type: 'checkbox', contenteditable: 'false', ...(node.attrs.checked ? { checked: '' } : {}) }],
        ['div', { class: 'task-list-body' }, 0],
      ];
    },
  },

  text: { group: 'inline' },

  image: {
    inline: true,
    attrs: { src: {}, alt: { default: null }, title: { default: null } },
    group: 'inline',
    draggable: true,
    parseDOM: [{
      tag: 'img[src]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement;
        return { src: el.getAttribute('src'), alt: el.getAttribute('alt'), title: el.getAttribute('title') };
      },
    }],
    toDOM: (node) => ['img', { src: node.attrs.src, alt: node.attrs.alt ?? '', ...(node.attrs.title ? { title: node.attrs.title } : {}) }],
  },

  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },

  math: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { src: {}, display: { default: false } },
    parseDOM: [{
      tag: 'span.powernote-math[data-src]',
      getAttrs: (dom) => ({
        src: (dom as HTMLElement).getAttribute('data-src'),
        display: (dom as HTMLElement).getAttribute('data-display') === 'true',
      }),
    }],
    toDOM: (node) => {
      const span = document.createElement('span');
      span.className = node.attrs.display ? 'powernote-math powernote-math--display' : 'powernote-math';
      span.setAttribute('data-src', node.attrs.src);
      if (node.attrs.display) span.setAttribute('data-display', 'true');
      span.innerHTML = renderMath(node.attrs.src, node.attrs.display);
      return span;
    },
  },

  html_inline: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { html: {} },
    // Copying a raw-HTML atom inside the editor pastes its sanitised rendering,
    // not the raw text: the raw string never sits in the page (REQ-TEXT-053).
    toDOM: (node) => rawHtmlElement('span', node.attrs.html, true),
  },

  html_block: {
    group: 'block',
    atom: true,
    // `html` is the whole raw source; open/inner/close are set when the block
    // wraps markdown between an opening and its closing tag.
    attrs: { html: {}, open: { default: null }, inner: { default: null }, close: { default: null } },
    toDOM: (node) => rawHtmlElement('div', htmlBlockHtml(node.attrs as { html: string; open?: string; inner?: string; close?: string }), true),
  },

  ...tableNodes({
    tableGroup: 'block',
    cellContent: 'inline*',
    cellAttributes: {
      align: {
        default: null,
        getFromDOM: (dom) => (dom as HTMLElement).style.textAlign || (dom as HTMLElement).getAttribute('align') || null,
        setDOMAttr: (value, attrs) => {
          if (value) attrs.style = `text-align:${value}`;
        },
      },
    },
  }),
};

const marks: Record<string, MarkSpec> = {
  link: {
    attrs: { href: {}, title: { default: null }, auto: { default: false } },
    inclusive: false,
    parseDOM: [{
      tag: 'a[href]',
      getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute('href'), title: (dom as HTMLElement).getAttribute('title') }),
    }],
    toDOM: (mark) => ['a', { href: mark.attrs.href, ...(mark.attrs.title ? { title: mark.attrs.title } : {}) }, 0],
  },
  strong: {
    parseDOM: [
      { tag: 'strong' },
      { tag: 'b', getAttrs: (dom) => (dom as HTMLElement).style.fontWeight !== 'normal' && null },
      { style: 'font-weight', getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null },
    ],
    toDOM: () => ['strong', 0],
  },
  em: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM: () => ['u', 0],
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration=line-through' }],
    toDOM: () => ['s', 0],
  },
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },
};

export const schema = new Schema({ nodes, marks });

export type TextDoc = PMNode;

/** Inline formats the toolbar and shortcuts toggle. */
export type FormatKind = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

export const FORMAT_MARK: Record<FormatKind, string> = {
  bold: 'strong',
  italic: 'em',
  underline: 'underline',
  strike: 'strike',
  code: 'code',
};

export const isListNode = (node: PMNode) => node.type === schema.nodes.bullet_list || node.type === schema.nodes.ordered_list;
