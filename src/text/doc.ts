/**
 * Document helpers shared by the editor, the toolbar and the canvas: the
 * plain-text offset mapping the test handle uses, the formats active at a
 * selection, and whole-document mark toggles for blocks that are selected
 * but not being edited (REQ-TEXT-050).
 */
import type { MarkType, Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { Transform } from 'prosemirror-transform';
import { schema } from './schema';
import { parseMarkdown } from './parse';
import { serializeMarkdown } from './serialize';

const n = schema.nodes;

// ---------------------------------------------------------------- plain-text offsets

/**
 * The document as plain text, the way the test handle counts offsets:
 * textblocks (paragraphs, headings, list rows, cells, code) are joined by one
 * `\n`; a hard break is `\n`; any other inline leaf (math, image, raw HTML)
 * counts as one character (U+FFFC). Block structure (list markers, heading
 * hashes, table pipes) takes no characters, so an offset is the same number
 * the user would reach by counting what they see.
 */
export function plainText(doc: PMNode): string {
  let out = '';
  let first = true;
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    if (!first) out += '\n';
    first = false;
    node.forEach((child) => {
      if (child.isText) out += child.text ?? '';
      else if (child.type === n.hard_break) out += '\n';
      else out += '￼';
    });
    return false;
  });
  return out;
}

/** Document position for a plain-text offset (clamped). */
export function posFromOffset(doc: PMNode, offset: number): number {
  let remaining = Math.max(0, offset);
  let result = -1;
  let lastEnd = 1;
  let first = true;
  doc.descendants((node, pos) => {
    if (result >= 0 || !node.isTextblock) return result < 0;
    if (!first) {
      if (remaining === 0) {
        result = lastEnd;
        return false;
      }
      remaining -= 1;
    }
    first = false;
    let at = pos + 1;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      const len = child.isText ? (child.text ?? '').length : 1;
      if (remaining <= len && (child.isText || remaining === 0)) {
        result = at + (child.isText ? remaining : 0);
        return false;
      }
      if (!child.isText && remaining === 1) {
        result = at + 1;
        return false;
      }
      remaining -= len;
      at += child.nodeSize;
    }
    if (remaining === 0) {
      result = at;
      return false;
    }
    lastEnd = at;
    return false;
  });
  if (result >= 0) return result;
  return lastEnd;
}

/** Plain-text offset for a document position (positions outside text snap to the nearest textblock). */
export function offsetFromPos(doc: PMNode, pos: number): number {
  let offset = 0;
  let first = true;
  let found = -1;
  doc.descendants((node, nodePos) => {
    if (found >= 0) return false;
    if (!node.isTextblock) {
      if (pos <= nodePos) {
        found = offset;
        return false;
      }
      return true;
    }
    if (!first) offset += 1;
    first = false;
    const start = nodePos + 1;
    if (pos < start) {
      found = offset;
      return false;
    }
    let at = start;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      const len = child.isText ? (child.text ?? '').length : 1;
      if (pos <= at + child.nodeSize) {
        found = offset + (child.isText ? Math.min(len, pos - at) : pos > at ? 1 : 0);
        return false;
      }
      offset += len;
      at += child.nodeSize;
    }
    if (pos <= nodePos + node.nodeSize) {
      found = offset;
      return false;
    }
    return false;
  });
  return found >= 0 ? found : offset;
}

// ---------------------------------------------------------------- active formats

export type ListKind = 'bullet' | 'number' | 'task';

export interface ActiveFormats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  /** 0 = paragraph. */
  heading: number;
  list: ListKind | null;
  link: boolean;
}

export const NO_FORMATS: ActiveFormats = {
  bold: false, italic: false, underline: false, strike: false, code: false, heading: 0, list: null, link: false,
};

/** True when every piece of text between `from` and `to` carries the mark (and there is some text). */
export function rangeAllHasMark(doc: PMNode, from: number, to: number, type: MarkType): boolean {
  let any = false;
  let all = true;
  doc.nodesBetween(from, to, (node) => {
    if (!all) return false;
    if (node.isText || node.isAtom && node.isInline && node.type !== n.hard_break) {
      any = true;
      if (!type.isInSet(node.marks)) all = false;
    }
    return true;
  });
  return any && all;
}

function markActive(state: EditorState, type: MarkType): boolean {
  const { from, to, empty, $from } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  return rangeAllHasMark(state.doc, from, to, type);
}

/** The formats that are on at the caret, or on all of the selection (REQ-TEXT-051). */
export function activeFormats(state: EditorState): ActiveFormats {
  const { $from } = state.selection;
  const parent = $from.parent;
  let list: ListKind | null = null;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === n.list_item) {
      list = node.attrs.checked !== null ? 'task' : $from.node(d - 1).type === n.ordered_list ? 'number' : 'bullet';
      break;
    }
  }
  return {
    bold: markActive(state, schema.marks.strong),
    italic: markActive(state, schema.marks.em),
    underline: markActive(state, schema.marks.underline),
    strike: markActive(state, schema.marks.strike),
    code: markActive(state, schema.marks.code),
    heading: parent.type === n.heading ? parent.attrs.level : 0,
    list,
    // A caret at either edge of a link still counts as inside it (REQ-TEXT-051).
    link: !!(schema.marks.link.isInSet(state.storedMarks ?? $from.marks())
      || ($from.nodeAfter && schema.marks.link.isInSet($from.nodeAfter.marks) && $from.nodeBefore && schema.marks.link.isInSet($from.nodeBefore.marks))),
  };
}

// ---------------------------------------------------------------- task boxes

/** Flip the n-th task box of a markdown text (a checkbox click on the finished block). */
export function toggleTaskAt(markdown: string, index: number): string {
  const doc = parseMarkdown(markdown);
  let seen = 0;
  let target = -1;
  let checked = false;
  doc.descendants((node, pos) => {
    if (target >= 0) return false;
    if (node.type === n.list_item && node.attrs.checked !== null) {
      if (seen === index) {
        target = pos;
        checked = node.attrs.checked;
      }
      seen++;
    }
    return true;
  });
  if (target < 0) return markdown;
  const tr = new Transform(doc).setNodeMarkup(target, undefined, { checked: !checked });
  return serializeMarkdown(tr.doc);
}
