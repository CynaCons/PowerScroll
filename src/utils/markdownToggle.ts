export type FormatKind = 'bold' | 'italic' | 'strike' | 'code' | 'underline';

export interface MarkerPair {
  open: string;
  close: string;
}

export const FORMAT_MARKERS: Record<FormatKind, MarkerPair> = {
  bold: { open: '**', close: '**' },
  italic: { open: '*', close: '*' },
  strike: { open: '~~', close: '~~' },
  code: { open: '`', close: '`' },
  underline: { open: '<u>', close: '</u>' },
};

export interface ToggleResult {
  value: string;
  selStart: number;
  selEnd: number;
}

/**
 * Where a line's text starts once its block prefix is skipped: indent, quote
 * markers, a list marker (with an optional task box) and heading hashes.
 * Formatting the prefix too ('**- item**') takes the row out of its list.
 */
const LINE_PREFIX_RE = /^[ \t]*(?:>[ \t]?)*[ \t]*(?:(?:[-*+•]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?(?:#{1,6}[ \t]+)?/;
const FENCE_RE = /^[ \t]*(```|~~~)/;
/** Thematic breaks and table delimiter rows carry no text to format. */
const NO_TEXT_RE = /^[ \t]*(?:(?:[-*_][ \t]*){3,}|\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?)[ \t]*$/;

interface Segment {
  start: number;
  end: number;
}

/**
 * The formattable pieces of the selection: per line, the selected part of the
 * line's text (prefix excluded, edge whitespace trimmed). Table rows yield one
 * piece per cell. Lines inside code fences and lines with no text yield none.
 */
export function formatSegments(value: string, selStart: number, selEnd: number): Segment[] {
  const segments: Segment[] = [];
  let inFence = false;
  let lineStart = 0;
  while (lineStart <= value.length) {
    let lineEnd = value.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = value.length;
    const line = value.slice(lineStart, lineEnd);
    const fence = FENCE_RE.test(line);
    const overlaps = lineEnd >= selStart && lineStart <= selEnd;
    if (fence) inFence = !inFence;
    else if (!inFence && overlaps && !NO_TEXT_RE.test(line)) {
      const pieces: Segment[] = [];
      if (line.trimStart().startsWith('|')) {
        // One piece per table cell, so the pipes stay intact.
        let cellStart = lineStart + line.indexOf('|') + 1;
        for (let i = cellStart; i <= lineEnd; i++) {
          if (i === lineEnd || (value[i] === '|' && value[i - 1] !== '\\')) {
            pieces.push({ start: cellStart, end: i });
            cellStart = i + 1;
          }
        }
      } else {
        const prefix = (line.match(LINE_PREFIX_RE)?.[0] ?? '').length;
        pieces.push({ start: lineStart + prefix, end: lineEnd });
      }
      for (const piece of pieces) {
        let start = Math.max(piece.start, selStart);
        let end = Math.min(piece.end, selEnd);
        while (start < end && /\s/.test(value[start])) start++;
        while (end > start && /\s/.test(value[end - 1])) end--;
        if (end > start) segments.push({ start, end });
      }
    }
    if (lineEnd >= selEnd || lineEnd === value.length) break;
    lineStart = lineEnd + 1;
  }
  return segments;
}

/** Leading/trailing star runs of s, for the bold (**) / italic (*) family. */
function starRuns(s: string): number {
  const lead = s.match(/^\*+/)?.[0].length ?? 0;
  const trail = s.match(/\*+$/)?.[0].length ?? 0;
  const run = Math.min(lead, trail);
  // The text between the runs must not be empty ("****" is not bold).
  return s.length > 2 * run ? run : 0;
}

interface Span {
  /** Range including any markers found around or inside the segment. */
  start: number;
  end: number;
  /** Markers present on each side (0 when not formatted). */
  open: number;
  close: number;
}

/** Widen a segment over matching markers right outside it, then measure. */
function inspect(value: string, seg: Segment, kind: FormatKind): Span {
  let { start, end } = seg;
  if (kind === 'bold' || kind === 'italic') {
    while (start > 0 && value[start - 1] === '*' && value[end] === '*') {
      start--;
      end++;
    }
    const run = starRuns(value.slice(start, end));
    const active = kind === 'bold' ? run >= 2 : run % 2 === 1;
    const n = active ? (kind === 'bold' ? 2 : 1) : 0;
    return { start, end, open: n, close: n };
  }
  const { open, close } = FORMAT_MARKERS[kind];
  if (value.slice(start - open.length, start) === open && value.slice(end, end + close.length) === close) {
    return { start: start - open.length, end: end + close.length, open: open.length, close: close.length };
  }
  const text = value.slice(start, end);
  if (text.length > open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
    return { start, end, open: open.length, close: close.length };
  }
  return { start, end, open: 0, close: 0 };
}

/** Remove stray markers of this kind inside text about to be wrapped. */
function stripMarkers(text: string, kind: FormatKind): string {
  switch (kind) {
    case 'bold': return text.replace(/\*\*/g, '');
    case 'italic': return text.replace(/(?<!\*)\*(?!\*)/g, '');
    case 'strike': return text.replace(/~~/g, '');
    case 'code': return text.replace(/`/g, '');
    case 'underline': return text.replace(/<\/?u>/g, '');
  }
}

/**
 * Toggle an inline format on a textarea selection, line by line.
 *
 * Each selected line is formatted inside its own block prefix, so selecting a
 * whole list row and pressing Ctrl+B gives '- **row**' and the list survives.
 * Edge whitespace stays outside the markers ('**word **' would not render).
 * When every selected piece already has the format, it is removed; otherwise
 * it is applied to the pieces that lack it. An empty selection inserts an
 * empty marker pair with the caret between them.
 */
export function toggleFormat(value: string, selStart: number, selEnd: number, kind: FormatKind): ToggleResult {
  const { open, close } = FORMAT_MARKERS[kind];

  if (selStart === selEnd) {
    return {
      value: value.slice(0, selStart) + open + close + value.slice(selStart),
      selStart: selStart + open.length,
      selEnd: selStart + open.length,
    };
  }

  const spans = formatSegments(value, selStart, selEnd).map((seg) => inspect(value, seg, kind));
  if (spans.length === 0) return { value, selStart, selEnd };
  const remove = spans.every((span) => span.open > 0);

  let out = '';
  let cursor = 0;
  let newStart = -1;
  let newEnd = -1;
  for (const span of spans) {
    out += value.slice(cursor, span.start);
    const text = value.slice(span.start, span.end);
    const body = text.slice(span.open, text.length - span.close);
    let [pre, inner, post] = [open, stripMarkers(text, kind), close];
    if (remove) [pre, inner, post] = ['', body, ''];
    else if (span.open > 0) [pre, inner, post] = [text.slice(0, span.open), body, text.slice(text.length - span.close)];
    out += pre;
    if (newStart < 0) newStart = out.length;
    out += inner;
    newEnd = out.length;
    out += post;
    cursor = span.end;
  }
  out += value.slice(cursor);
  return { value: out, selStart: newStart, selEnd: newEnd };
}
