/**
 * Document → HTML string without a DOM, for code that runs outside a page
 * (unit tests, tooling). In the browser the renderer uses ProseMirror's
 * DOMSerializer on the same `toDOM` specs, so the two agree by construction;
 * only the three atoms that build real elements (math, raw HTML) are spelled
 * out here.
 */
import type { DOMOutputSpec, Mark, Node as PMNode } from 'prosemirror-model';
import { htmlBlockHtml, renderMath, schema } from './schema';

const n = schema.nodes;

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Render an array-style DOMOutputSpec, filling the content hole with `content`. */
function specToHtml(spec: DOMOutputSpec, content: string): string {
  if (typeof spec === 'string') return escape(spec);
  if (!Array.isArray(spec)) return content;
  const [tag, ...rest] = spec as [string, ...unknown[]];
  let attrs = '';
  let children = rest;
  if (rest.length && rest[0] !== null && typeof rest[0] === 'object' && !Array.isArray(rest[0])) {
    for (const [key, value] of Object.entries(rest[0] as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      attrs += ` ${key}="${escape(String(value))}"`;
    }
    children = rest.slice(1);
  }
  if (['br', 'hr', 'img', 'input'].includes(tag)) return `<${tag}${attrs}>`;
  const inner = children.map((child) => (child === 0 ? content : specToHtml(child as DOMOutputSpec, content))).join('');
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

function wrapMarks(marks: readonly Mark[], html: string): string {
  return marks.reduceRight((inner, mark) => specToHtml(mark.type.spec.toDOM!(mark, true), inner), html);
}

function nodeToHtml(node: PMNode): string {
  if (node.isText) return wrapMarks(node.marks, escape(node.text ?? ''));
  let html: string;
  if (node.type === n.math) {
    const cls = node.attrs.display ? 'powernote-math powernote-math--display' : 'powernote-math';
    html = `<span class="${cls}" data-src="${escape(node.attrs.src)}">${renderMath(node.attrs.src, node.attrs.display)}</span>`;
  } else if (node.type === n.html_inline) {
    html = `<span class="powernote-html">${node.attrs.html}</span>`;
  } else if (node.type === n.html_block) {
    html = `<div class="powernote-html">${htmlBlockHtml(node.attrs as { html: string })}</div>`;
  } else {
    const content = node.content.size ? fragmentToHtml(node) : '';
    html = specToHtml(node.type.spec.toDOM!(node), content);
  }
  return wrapMarks(node.marks, html);
}

function fragmentToHtml(parent: PMNode): string {
  let out = '';
  parent.forEach((child) => {
    out += nodeToHtml(child);
  });
  return out;
}

/** The document's HTML, as a string. */
export function docToHtmlString(doc: PMNode): string {
  return fragmentToHtml(doc);
}
