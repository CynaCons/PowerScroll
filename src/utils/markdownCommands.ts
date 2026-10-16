/**
 * Line commands for the text-block editor: headings, list toggles, task
 * ticks, list continuation on Enter, Backspace on a list marker, links.
 *
 * Pure string functions over (value, selection) so the editor and the tests
 * share one implementation. Every line command only rewrites a line's prefix
 * (list marker, task box, heading hashes); the text after it is untouched.
 */
import type { ToggleResult } from './markdownToggle';

export type ListKind = 'bullet' | 'number' | 'task';

interface Prefix {
  /** Indent and quote markers, kept as they are. */
  lead: string;
  list: { kind: ListKind; marker: string; checked: boolean } | null;
  heading: number;
  /** Length of lead + list marker + task box + heading hashes. */
  length: number;
}

const PREFIX_RE = /^([ \t]*(?:>[ \t]?)*[ \t]*)(?:([-*+•]|\d+[.)])(?:[ \t]+|$)(?:\[([ xX])\](?:[ \t]+|$))?)?(?:(#{1,6})(?:[ \t]+|$))?/;

export function parsePrefix(line: string): Prefix {
  const m = line.match(PREFIX_RE)!;
  const marker = m[2];
  const list = marker
    ? {
        kind: (m[3] !== undefined ? 'task' : /\d/.test(marker) ? 'number' : 'bullet') as ListKind,
        marker,
        checked: m[3] !== undefined && m[3] !== ' ',
      }
    : null;
  return { lead: m[1], list, heading: m[4] ? m[4].length : 0, length: m[0].length };
}

interface Line {
  start: number;
  text: string;
}

function splitLines(value: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const text of value.split('\n')) {
    lines.push({ start, text });
    start += text.length + 1;
  }
  return lines;
}

/** Indexes of the lines a selection touches (a selection ending at column 0 stops before that line). */
function touched(lines: Line[], s: number, e: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const { start, text } = lines[i];
    const end = start + text.length;
    if (end < s) continue;
    if (start > e || (start === e && e > s)) break;
    out.push(i);
  }
  return out;
}

/**
 * Give some lines a new prefix and map the selection through: an offset in
 * the old prefix lands at the start of the line's text, an offset in the text
 * keeps its place in the text.
 */
function rewritePrefixes(value: string, s: number, e: number, next: Map<number, string>): ToggleResult {
  const lines = splitLines(value);
  const map = (offset: number) => {
    let shift = 0;
    for (let i = 0; i < lines.length; i++) {
      const { start, text } = lines[i];
      const prefix = next.get(i);
      const oldLen = prefix === undefined ? 0 : parsePrefix(text).length;
      const newLen = prefix === undefined ? 0 : prefix.length;
      if (offset <= start + text.length) {
        const col = offset - start;
        if (prefix === undefined) return offset + shift;
        return start + shift + (col <= oldLen ? newLen : col - oldLen + newLen);
      }
      shift += newLen - oldLen;
    }
    return offset + shift;
  };
  const out = lines.map(({ text }, i) => {
    const prefix = next.get(i);
    return prefix === undefined ? text : prefix + text.slice(parsePrefix(text).length);
  });
  return { value: out.join('\n'), selStart: map(s), selEnd: map(e) };
}

const isBlank = (text: string) => text.trim() === '';

function listMarker(kind: ListKind, n: number, like?: Prefix['list']): string {
  if (kind === 'number') return `${n}. `;
  const bullet = like && like.kind !== 'number' ? like.marker : '-';
  return kind === 'task' ? `${bullet} [ ] ` : `${bullet} `;
}

/**
 * Set the touched lines to a heading of `level` (1-6), or back to text (0).
 * Applying the level the lines already have turns them back to text. A list
 * row made a heading leaves the list (the heading then separates the rows
 * above and below); a heading turned back to text between list rows gets the
 * neighbouring row's bullet back.
 */
export function setHeading(value: string, s: number, e: number, level: number): ToggleResult {
  const lines = splitLines(value);
  const idx = touched(lines, s, e).filter((i) => !isBlank(lines[i].text));
  if (idx.length === 0) return { value, selStart: s, selEnd: e };
  const prefixes = idx.map((i) => parsePrefix(lines[i].text));
  const target = level > 0 && prefixes.every((p) => p.heading === level) ? 0 : level;
  const next = new Map<number, string>();
  idx.forEach((i, k) => {
    const p = prefixes[k];
    if (target > 0) {
      next.set(i, `${p.lead}${'#'.repeat(target)} `);
      return;
    }
    if (p.heading === 0) return;
    const neighbour = [i - 1, i + 1]
      .map((j) => lines[j])
      .filter((l): l is Line => !!l && !isBlank(l.text))
      .map((l) => parsePrefix(l.text))
      .find((n) => n.list && n.lead === p.lead);
    next.set(i, neighbour?.list ? p.lead + listMarker(neighbour.list.kind, 1, neighbour.list) : p.lead);
  });
  return rewritePrefixes(value, s, e, next);
}

/**
 * Toggle a list kind on the touched lines. When every non-blank line already
 * is that kind, the markers come off; otherwise every line becomes that kind
 * (numbers counted 1, 2, 3 ... per indent). Heading hashes are dropped.
 */
export function toggleList(value: string, s: number, e: number, kind: ListKind): ToggleResult {
  const lines = splitLines(value);
  const idx = touched(lines, s, e).filter((i) => !isBlank(lines[i].text));
  if (idx.length === 0) {
    // An empty line: start a list there.
    const [i] = touched(lines, s, e);
    if (i === undefined) return { value, selStart: s, selEnd: e };
    return rewritePrefixes(value, s, e, new Map([[i, parsePrefix(lines[i].text).lead + listMarker(kind, 1)]]));
  }
  const prefixes = idx.map((i) => parsePrefix(lines[i].text));
  const remove = prefixes.every((p) => p.list?.kind === kind);
  const counters = new Map<string, number>();
  const next = new Map<number, string>();
  idx.forEach((i, k) => {
    const p = prefixes[k];
    if (remove) {
      next.set(i, p.lead);
      return;
    }
    const n = (counters.get(p.lead) ?? 0) + 1;
    counters.set(p.lead, n);
    next.set(i, p.lead + listMarker(kind, n, p.list));
  });
  return rewritePrefixes(value, s, e, next);
}

/** Tick or untick the task boxes on the touched lines; null when none has one. */
export function toggleTaskChecked(value: string, s: number, e: number): ToggleResult | null {
  const lines = splitLines(value);
  const idx = touched(lines, s, e).filter((i) => parsePrefix(lines[i].text).list?.kind === 'task');
  if (idx.length === 0) return null;
  const check = idx.some((i) => !parsePrefix(lines[i].text).list!.checked);
  const next = new Map<number, string>();
  for (const i of idx) {
    const p = parsePrefix(lines[i].text);
    next.set(i, `${p.lead}${p.list!.marker} [${check ? 'x' : ' '}] ${'#'.repeat(p.heading)}${p.heading ? ' ' : ''}`);
  }
  return rewritePrefixes(value, s, e, next);
}

/**
 * Backspace with the caret right after a list marker or heading hashes
 * removes that marker (the row becomes plain text), the way word processors
 * drop a bullet. Null when the caret is anywhere else.
 */
export function backspaceMarker(value: string, s: number, e: number): ToggleResult | null {
  if (s !== e) return null;
  const lines = splitLines(value);
  const i = touched(lines, s, e)[0];
  if (i === undefined) return null;
  const p = parsePrefix(lines[i].text);
  if (!p.list && !p.heading) return null;
  if (s !== lines[i].start + p.length) return null;
  return rewritePrefixes(value, s, e, new Map([[i, p.lead]]));
}

/**
 * Enter inside a list row continues the list: the new row gets the same
 * marker (next number, empty task box). Enter on a row with only its marker
 * ends the list by clearing that row. Null outside lists.
 */
export function continueListOnEnter(value: string, s: number, e: number): ToggleResult | null {
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const p = parsePrefix(value.slice(lineStart, s));
  if (!p.list || p.heading) return null;
  if (s < lineStart + p.length) return null;
  const lineEnd = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e);
  const restOfRow = value.slice(lineStart + p.length, lineEnd);
  if (isBlank(restOfRow) && s === e) {
    const cleared = value.slice(0, lineStart) + value.slice(lineEnd);
    return { value: cleared, selStart: lineStart, selEnd: lineStart };
  }
  const marker =
    p.list.kind === 'number'
      ? `${parseInt(p.list.marker, 10) + 1}${p.list.marker.slice(-1)} `
      : p.list.kind === 'task'
        ? `${p.list.marker} [ ] `
        : `${p.list.marker} `;
  const insert = `\n${p.lead}${marker}`;
  const out = value.slice(0, s) + insert + value.slice(e);
  return { value: out, selStart: s + insert.length, selEnd: s + insert.length };
}

const URL_RE = /^(https?:\/\/|www\.|powernote:\/\/)\S+$/i;

export function isUrl(text: string): boolean {
  return URL_RE.test(text.trim());
}

/**
 * Ctrl+K: wrap the selection as a link with the address selected, ready to
 * type or paste over. With no selection, insert one with its text selected.
 */
export function insertLink(value: string, s: number, e: number): ToggleResult {
  const selected = value.slice(s, e);
  if (selected && !selected.includes('\n')) {
    if (isUrl(selected)) {
      const out = `${value.slice(0, s)}[](${selected.trim()})${value.slice(e)}`;
      return { value: out, selStart: s + 1, selEnd: s + 1 };
    }
    const out = `${value.slice(0, s)}[${selected}](https://)${value.slice(e)}`;
    const at = s + selected.length + 3;
    return { value: out, selStart: at, selEnd: at + 'https://'.length };
  }
  const out = `${value.slice(0, s)}[link](https://)${value.slice(e)}`;
  return { value: out, selStart: s + 1, selEnd: s + 5 };
}

/** Pasting a URL over selected text on one line links that text. Null otherwise. */
export function pasteUrlOverSelection(value: string, s: number, e: number, pasted: string): ToggleResult | null {
  const selected = value.slice(s, e);
  if (!selected.trim() || selected.includes('\n') || !isUrl(pasted) || isUrl(selected)) return null;
  const out = `${value.slice(0, s)}[${selected}](${pasted.trim()})${value.slice(e)}`;
  const end = s + selected.length + pasted.trim().length + 4;
  return { value: out, selStart: end, selEnd: end };
}
