/**
 * Shared markdown → HTML pipeline for text nodes.
 *
 * Extracted so the canvas renderer (TextNode) and the agent bridge measure
 * blocks through exactly the same path — if the two ever diverge, agent-placed
 * blocks would be laid out against heights the renderer disagrees with.
 */

import type { CSSProperties } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { TextNodeData } from '../types/data';
import { preprocessMath, restoreMath } from './mathParser';
import { normalizeListIndents } from './listIndent';
import { MIN_TEXT_HEIGHT, MIN_TEXT_WIDTH } from './pageLayout';

// Configure marked for GFM + task lists
marked.setOptions({
  breaks: true,
  gfm: true,
});

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
    wordWrap: 'break-word',
    overflowWrap: 'break-word',
    pointerEvents: 'none',
    userSelect: 'none',
  };
}

const DASH_OR_EQUALS_LINE = /^(\s*)(-+|=+)[ \t\u00a0]*$/;

/**
 * Stop a line of '-' or '=' from turning the line above into a heading.
 *
 * Markdown reads 'two\n-' as a level-2 heading "two" (a setext heading). In a
 * note that is never what was meant: it happens when a new list row holds only
 * its dash (Tab on an empty bullet gives '- two\n  - ') or when a dash is typed
 * under a line. Headings come from '#'. So, after a non-blank line:
 * - a lone '-' is an empty list row, as typed;
 * - '---' or longer is a horizontal rule;
 * - '--', '=' and other short runs are plain text.
 * Code fences are left alone. Source is not mutated: this runs on the copy
 * handed to marked.
 */
export function neutralizeSetextHeadings(markdown: string): string {
  const lines = markdown.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || i === 0 || /^\s*$/.test(lines[i - 1])) continue;
    const match = line.match(DASH_OR_EQUALS_LINE);
    if (!match) continue;
    const [, indent, run] = match;
    if (run === '-') lines[i] = `${indent}- \u200b`;
    else if (run[0] === '-' && run.length >= 3) lines[i] = `\n${line}`;
    else lines[i] = `${indent}\\${run}`;
  }
  return lines.join('\n');
}

/**
 * Render markdown to the HTML shown inside a text node: math extracted and
 * KaTeX-rendered, GFM on, and task-list checkboxes left clickable.
 */
export function markdownToHtml(text: string): string {
  if (!text) return '';
  // 1) Extract $$...$$ and $...$ math blocks, replace with placeholders
  const { text: textWithoutMath, blocks } = preprocessMath(text);
  // 2) Pad under-indented numbered children so Tab's 2-space habit still nests
  const withNestedLists = normalizeListIndents(neutralizeSetextHeadings(textWithoutMath));
  // 3) Run marked on the cleaned text
  let html = marked.parse(withNestedLists) as string;
  // 4) Restore math placeholders with KaTeX-rendered HTML
  html = restoreMath(html, blocks);
  // 5) Remove disabled attribute from task-list checkboxes so clicks work
  html = html
    .replace(/<input\s+disabled=""\s+type="checkbox"/g, '<input type="checkbox"')
    .replace(/<input\s+checked=""\s+disabled=""\s+type="checkbox"/g, '<input checked="" type="checkbox"');
  // 6) Strip anything that can run script (REQ-TEXT-053): blocks come from
  // files and agents, and markdown passes raw HTML through.
  return sanitize(html);
}

/** Page links (powernote://) on top of DOMPurify's default safe schemes. */
const SAFE_URI = /^(?:(?:(?:f|ht)tps?|mailto|tel|powernote):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

function sanitize(html: string): string {
  if (typeof window === 'undefined') return html;
  return DOMPurify.sanitize(html, { ALLOWED_URI_REGEXP: SAFE_URI, FORBID_TAGS: ['style', 'form'] });
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
