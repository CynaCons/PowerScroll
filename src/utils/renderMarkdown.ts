/**
 * Shared markdown → HTML pipeline for text nodes.
 *
 * The finished block, the board card description and the agent bridge's
 * height measurement all go through this one path, and it is the same
 * document model the editor shows live (docs/DESIGN_TEXT.md): markdown is
 * parsed into the text schema, drawn by the schema's own DOM serializer and
 * then sanitised. If the two ever diverged, text would move when editing
 * starts and agent-placed blocks would be laid out against heights the
 * renderer disagrees with.
 */

import type { CSSProperties } from 'react';
import { DOMSerializer } from 'prosemirror-model';
import type { TextNodeData } from '../types/data';
import { parseMarkdown } from '../text/parse';
import { schema, sanitizeHtml } from '../text/schema';
import { docToHtmlString } from '../text/htmlString';
import { MIN_TEXT_HEIGHT, MIN_TEXT_WIDTH } from './pageLayout';

export { neutralizeSetextHeadings } from './setext';

/** CSS class the rendered markdown container carries on the canvas. */
export const MARKDOWN_CLASS = 'powernote-markdown';

/** Inner padding of the markdown container, on every side. */
export const MARKDOWN_PADDING = 4;

/** Line height applied to the markdown container. */
export const MARKDOWN_LINE_HEIGHT = '1.4';

/**
 * Inline styles for the markdown container.
 *
 * These, not the CSS class, are what actually determine a block's height —
 * font size, line height and padding all live here. Anything measuring a block
 * MUST apply the same styles or it will get a different answer than the
 * renderer does. (Measuring with only the class attached under-reports by
 * ~12px on a heading, which is enough to overlap the block below it.)
 *
 * `fontStyle` is only read for blocks saved before the redesign that still
 * carry a whole-block bold or italic (REQ-TEXT-052); it is never written.
 */
export function markdownBoxStyle(
  data: Pick<TextNodeData, 'fontSize' | 'fontFamily' | 'fontStyle' | 'fill'>,
  width: number,
  color?: string,
): CSSProperties {
  return {
    minWidth: MIN_TEXT_WIDTH,
    width,
    boxSizing: 'border-box',
    fontSize: data.fontSize,
    fontFamily: data.fontFamily,
    fontWeight: data.fontStyle?.includes('bold') ? 'bold' : 'normal',
    fontStyle: data.fontStyle?.includes('italic') ? 'italic' : 'normal',
    color: color ?? data.fill,
    padding: MARKDOWN_PADDING,
    lineHeight: MARKDOWN_LINE_HEIGHT,
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    overflowWrap: 'break-word',
    pointerEvents: 'none',
    userSelect: 'none',
  };
}

let domSerializer: DOMSerializer | null = null;

/**
 * Render markdown to the HTML shown inside a text node: the same DOM the
 * editor shows (headings, lists, clickable task boxes, KaTeX math, links),
 * then sanitised so nothing in it can run script (REQ-TEXT-053).
 */
export function markdownToHtml(text: string): string {
  if (!text) return '';
  const doc = parseMarkdown(text);
  // Outside a page (unit tests, tooling) the same specs are written out as a string.
  if (typeof document === 'undefined') return docToHtmlString(doc);
  domSerializer ??= DOMSerializer.fromSchema(schema);
  const host = document.createElement('div');
  host.appendChild(domSerializer.serializeFragment(doc.content, { document }));
  return sanitizeHtml(host.innerHTML);
}

/**
 * Measure the rendered height of a markdown chunk at a given width, by laying
 * it out offscreen in a container styled like the on-canvas one.
 *
 * Synchronous by design: the bridge needs a real height at the moment it
 * places a block, because TextNode's own measurement lands ~60ms later on a
 * timer — far too late for an agent appending blocks back to back.
 *
 * Returns null when there is no DOM to measure in (SSR / tests without a
 * document), so callers can fall back to an estimate.
 */
export function measureMarkdownHeight(
  text: string,
  width: number,
  data: Pick<TextNodeData, 'fontSize' | 'fontFamily' | 'fontStyle' | 'fill'>,
): number | null {
  if (typeof document === 'undefined' || !document.body) return null;

  const probe = document.createElement('div');
  probe.className = MARKDOWN_CLASS;

  // Same inline styles the renderer applies — the class alone is not enough.
  const style = markdownBoxStyle(data, width);
  Object.assign(probe.style, {
    minWidth: `${style.minWidth}px`,
    width: `${width}px`,
    boxSizing: 'border-box',
    fontSize: `${style.fontSize}px`,
    fontFamily: String(style.fontFamily),
    fontWeight: String(style.fontWeight),
    fontStyle: String(style.fontStyle),
    padding: `${MARKDOWN_PADDING}px`,
    lineHeight: MARKDOWN_LINE_HEIGHT,
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    overflowWrap: 'break-word',
    // Keep it out of sight and out of the layout flow.
    position: 'absolute',
    visibility: 'hidden',
    pointerEvents: 'none',
    left: '-99999px',
    top: '0',
  });
  probe.innerHTML = markdownToHtml(text);

  document.body.appendChild(probe);
  const height = probe.offsetHeight;
  document.body.removeChild(probe);

  return Math.max(MIN_TEXT_HEIGHT, height);
}
