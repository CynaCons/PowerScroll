/**
 * Editor commands beyond what prosemirror-commands gives: headings and list
 * kinds over the touched rows (REQ-TEXT-041..044), task boxes, moving rows,
 * the list-aware Enter/Backspace/Tab (REQ-TEXT-058) and links.
 *
 * Block commands walk the touched textblocks from last to first so the
 * positions read from the original document stay valid while it changes.
 */
import {
  EditorState, TextSelection, type Command, type Transaction,
} from 'prosemirror-state';
import type { Node as PMNode, ResolvedPos, NodeType, Attrs } from 'prosemirror-model';
import { canJoin, findWrapping } from 'prosemirror-transform';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { addRowAfter, goToNextCell, isInTable } from 'prosemirror-tables';
import { chainCommands, createParagraphNear, liftEmptyBlock, newlineInCode, splitBlock } from 'prosemirror-commands';
import { schema, isListNode } from './schema';
import type { ListKind } from './doc';

const n = schema.nodes;

// ---------------------------------------------------------------- helpers

interface Touched { pos: number; node: PMNode }

/** The textblocks the selection touches, in document order (table cells excluded). */
function touchedTextblocks(state: EditorState): Touched[] {
  const out: Touched[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === n.table) return false;
    if (node.isTextblock) {
      out.push({ pos, node });
      return false;
    }
    return true;
  });
  return out;
}

/** Depth of the list item holding $pos, or -1. */
function listItemDepth($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type === n.list_item) return d;
  return -1;
}

/** Run a command on the transaction's current document with a caret at `pos`, appending its steps. */
function runAt(tr: Transaction, pos: number, command: Command): boolean {
  const state = EditorState.create({ doc: tr.doc, selection: TextSelection.create(tr.doc, pos) });
  let ok = false;
  command(state, (t) => {
    for (const step of t.steps) tr.step(step);
    ok = true;
  });
  return ok;
}

/** Map a textblock's start position through the steps added since `since`. */
function mapBlock(tr: Transaction, pos: number, since: number): number {
  const $ = tr.doc.resolve(tr.mapping.slice(since).map(pos + 1));
  return $.before($.depth);
}

/** Lift the textblock at `pos` out of every list it is in; returns its new position. */
function liftOutOfLists(tr: Transaction, pos: number): number {
  for (let guard = 0; guard < 12; guard++) {
    const $ = tr.doc.resolve(pos + 1);
    if (listItemDepth($) < 0) return pos;
    const since = tr.steps.length;
    if (!runAt(tr, pos + 1, liftListItem(n.list_item))) return pos;
    pos = mapBlock(tr, pos, since);
  }
  return pos;
}

function listTypeFor(kind: ListKind): NodeType {
  return kind === 'number' ? n.ordered_list : n.bullet_list;
}

function rowKind($: ResolvedPos): ListKind | null {
  const d = listItemDepth($);
  if (d < 0) return null;
  if ($.node(d).attrs.checked !== null) return 'task';
  return $.node(d - 1).type === n.ordered_list ? 'number' : 'bullet';
}

/** Wrap the (paragraph or heading) textblock at `pos` into a fresh single-row list of `kind`. */
function wrapRow(tr: Transaction, pos: number, kind: ListKind): void {
  let node = tr.doc.nodeAt(pos)!;
  if (node.type === n.heading) {
    tr.setBlockType(pos + 1, pos + 1, n.paragraph);
    node = tr.doc.nodeAt(pos)!;
  }
  const $ = tr.doc.resolve(pos + 1);
  const range = $.blockRange();
  if (!range) return;
  const listType = listTypeFor(kind);
  const wrapping = findWrapping(range, listType, listType === n.ordered_list ? { order: 1 } : {});
  if (!wrapping) return;
  tr.wrap(range, wrapping);
  tr.setNodeMarkup(range.start + 1, undefined, { checked: kind === 'task' ? false : null });
}

/** Make the row holding the textblock at `pos` a row of `kind`, leaving its siblings as they are. */
function changeRowKind(tr: Transaction, pos: number, kind: ListKind): void {
  const $ = tr.doc.resolve(pos + 1);
  const d = listItemDepth($);
  if (d < 0) return;
  const item = $.node(d);
  const list = $.node(d - 1);
  const itemPos = $.before(d);
  const index = $.index(d - 1);
  // Isolate the row in its own list: split after it, then before it.
  if (index < list.childCount - 1) tr.split($.after(d), 1);
  let listPos = $.before(d - 1);
  if (index > 0) {
    tr.split(itemPos, 1);
    listPos = itemPos + 1;
  }
  const listType = listTypeFor(kind);
  const attrs: Attrs = listType === n.ordered_list ? { order: 1, tight: list.attrs.tight } : { tight: list.attrs.tight };
  tr.setNodeMarkup(listPos, listType, attrs);
  tr.setNodeMarkup(listPos + 1, undefined, { checked: kind === 'task' ? item.attrs.checked ?? false : null });
}

/** Join every pair of neighbouring lists of the same type, bottom-up. */
function joinAdjacentLists(tr: Transaction, node: PMNode = tr.doc, base = 0): void {
  if (node.isTextblock || node.isLeaf) return;
  // Offsets of children are read once; joins only touch positions after the current child.
  const offsets: number[] = [];
  node.forEach((_child, offset) => offsets.push(offset));
  for (let i = node.childCount - 1; i >= 0; i--) {
    const child = node.child(i);
    const childPos = base + offsets[i];
    joinAdjacentLists(tr, child, childPos + 1);
    if (i === 0) continue;
    const prev = node.child(i - 1);
    if (isListNode(prev) && prev.type === child.type && canJoin(tr.doc, childPos)) tr.join(childPos);
  }
}

/**
 * Block commands work on lines: a paragraph holding line breaks (`a\nb`) that
 * the selection touches is first split into one paragraph per line, so the
 * heading or marker lands on the lines the user sees, not the whole paragraph.
 * Returns the touched textblocks of the split document.
 */
function splitTouchedLines(tr: Transaction): Touched[] {
  const { from, to } = tr.selection;
  const targets: Touched[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === n.table) return false;
    if (!node.isTextblock) return true;
    const $ = tr.doc.resolve(pos);
    const parent = $.parent;
    if ((node.type === n.paragraph || node.type === n.heading) && (parent.type === n.doc || parent.type === n.blockquote)) {
      let breaks = false;
      node.forEach((child) => {
        if (child.type === n.hard_break) breaks = true;
      });
      if (breaks) targets.push({ pos, node });
    }
    return false;
  });
  for (const t of targets.reverse()) {
    const breaks: number[] = [];
    t.node.forEach((child, offset) => {
      if (child.type === n.hard_break) breaks.push(t.pos + 1 + offset);
    });
    for (const b of breaks.reverse()) {
      tr.delete(b, b + 1);
      tr.split(b);
    }
  }
  const out: Touched[] = [];
  tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
    if (node.type === n.table) return false;
    if (node.isTextblock) {
      out.push({ pos, node });
      return false;
    }
    return true;
  });
  return out;
}

// ---------------------------------------------------------------- headings

/** Ctrl+Shift+N / toolbar: level 1-6, or 0 for text; a level the row already has turns it back to text. */
export function setHeading(level: number): Command {
  return (state, dispatch) => {
    if (touchedTextblocks(state).length === 0) return false;
    const tr = state.tr;
    const blocks = splitTouchedLines(tr).filter((b) => b.node.type === n.paragraph || b.node.type === n.heading);
    if (blocks.length === 0) return false;
    const toText = level === 0 || blocks.every((b) => b.node.type === n.heading && b.node.attrs.level === level);
    for (const b of [...blocks].reverse()) {
      if (!toText) {
        // A heading leaves its list (REQ-TEXT-042).
        const pos = liftOutOfLists(tr, b.pos);
        tr.setBlockType(pos + 1, pos + 1, n.heading, { level });
      } else {
        // Back to text is an ordinary paragraph, never a row of a neighbouring list (REQ-TEXT-073).
        tr.setBlockType(b.pos + 1, b.pos + 1, n.paragraph);
      }
    }
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

// ---------------------------------------------------------------- lists

/** Ctrl+Shift+8/7/9 / toolbar: the touched rows become this kind; when all already are, the markers go. */
export function toggleList(kind: ListKind): Command {
  return (state, dispatch) => {
    if (touchedTextblocks(state).length === 0) return false;
    const tr = state.tr;
    const all = splitTouchedLines(tr).filter((b) => b.node.type === n.paragraph || b.node.type === n.heading);
    const blocks = all.length > 1 ? all.filter((b) => b.node.content.size > 0) : all;
    if (blocks.length === 0) return false;
    const allSame = blocks.every((b) => rowKind(tr.doc.resolve(b.pos + 1)) === kind);
    for (const b of [...blocks].reverse()) {
      if (allSame) {
        liftOutOfLists(tr, b.pos);
        continue;
      }
      if (listItemDepth(tr.doc.resolve(b.pos + 1)) >= 0) changeRowKind(tr, b.pos, kind);
      else wrapRow(tr, b.pos, kind);
    }
    joinAdjacentLists(tr);
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Ctrl+Enter: tick the touched task rows, or untick them when all are ticked. */
export const toggleTaskChecked: Command = (state, dispatch) => {
  const items = new Map<number, PMNode>();
  for (const b of touchedTextblocks(state)) {
    const $ = state.doc.resolve(b.pos + 1);
    const d = listItemDepth($);
    if (d >= 0 && $.node(d).attrs.checked !== null) items.set($.before(d), $.node(d));
  }
  if (items.size === 0) return false;
  const check = [...items.values()].some((item) => !item.attrs.checked);
  const tr = state.tr;
  for (const [pos] of items) tr.setNodeMarkup(pos, undefined, { checked: check });
  if (dispatch) dispatch(tr);
  return true;
};

/** Set a task row's box by the row's position (checkbox clicks). */
export function setTaskChecked(pos: number, checked: boolean): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || node.type !== n.list_item || node.attrs.checked === null) return false;
    if (dispatch) dispatch(state.tr.setNodeMarkup(pos, undefined, { checked }));
    return true;
  };
}

/** Alt+Up / Alt+Down: move the row (list item, or top-level block) past its neighbour. */
export function moveRow(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const { $from, from, to } = state.selection;
    if ($from.depth === 0) return false;
    let d = listItemDepth($from);
    if (d < 0) d = 1;
    for (let k = $from.depth; k > 0; k--) if ($from.node(k).type === n.table) return false;
    const parent = $from.node(d - 1);
    const index = $from.index(d - 1);
    const row = $from.node(d);
    const rowPos = $from.before(d);
    const rowEnd = $from.after(d);
    if (dir < 0 && index === 0) return false;
    if (dir > 0 && index === parent.childCount - 1) return false;
    const other = parent.child(index + dir);
    const tr = state.tr;
    tr.delete(rowPos, rowEnd);
    const insertAt = dir < 0 ? rowPos - other.nodeSize : rowPos + other.nodeSize;
    tr.insert(insertAt, row);
    const shift = dir * other.nodeSize;
    tr.setSelection(TextSelection.create(tr.doc, from + shift, to + shift));
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

// ---------------------------------------------------------------- keys in lists

/** Enter: continue the list; on an empty row, end it (REQ-TEXT-058). */
export const enterInList: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const d = listItemDepth($from);
  if (d < 0 || $from.depth !== d + 1 || $from.parent.type.spec.code) return false;
  if (empty && $from.parent.content.size === 0) return liftListItem(n.list_item)(state, dispatch);
  return splitListItem(n.list_item)(state, (tr) => {
    // A new task row starts unticked.
    const $new = tr.selection.$from;
    const nd = listItemDepth($new);
    if (nd >= 0 && $new.node(nd).attrs.checked === true) tr.setNodeMarkup($new.before(nd), undefined, { checked: false });
    dispatch?.(tr.scrollIntoView());
  });
};

export const enterKey: Command = chainCommands(enterInList, newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock);

/** Backspace at the start of a row drops its marker first: box, then bullet; a heading becomes text. */
export const backspaceMarker: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0) return false;
  if ($from.parent.type === n.heading) {
    if (dispatch) dispatch(state.tr.setBlockType($from.pos, $from.pos, n.paragraph));
    return true;
  }
  const d = listItemDepth($from);
  if (d < 0 || $from.depth !== d + 1 || $from.index(d) !== 0) return false;
  if ($from.node(d).attrs.checked !== null) {
    if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(d), undefined, { checked: null }));
    return true;
  }
  return liftListItem(n.list_item)(state, dispatch);
};

/** Tab in a table moves to the next cell, adding a row after the last one (REQ-TEXT-068). */
const tabInTable: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  if (goToNextCell(1)(state, dispatch)) return true;
  return addRowAfter(state, (tr) => {
    const next = EditorState.create({ doc: tr.doc, selection: tr.selection });
    goToNextCell(1)(next, (t) => {
      for (const step of t.steps) tr.step(step);
      tr.setSelection(t.selection.map(tr.doc, tr.mapping.slice(tr.steps.length - t.steps.length)));
    });
    dispatch?.(tr.scrollIntoView());
  });
};

/** Tab nests a row; outside a list nothing visible happens (never a code block). */
export const tabKey: Command = (state, dispatch) => tabInTable(state, dispatch) || sinkListItem(n.list_item)(state, dispatch) || true;

/** Shift+Tab un-nests a nested row; a top-level row (nothing to un-nest) stays as it is. */
export const shiftTabKey: Command = (state, dispatch) => {
  if (isInTable(state)) return goToNextCell(-1)(state, dispatch) || true;
  const { $from } = state.selection;
  const d = listItemDepth($from);
  if (d >= 2 && $from.node(d - 2).type === n.list_item) return liftListItem(n.list_item)(state, dispatch) || true;
  return true;
};

// ---------------------------------------------------------------- links

const URL_RE = /^(https?:\/\/|www\.|powernote:\/\/|mailto:)\S+$/i;

export function isUrl(text: string): boolean {
  return URL_RE.test(text.trim());
}

/** The extent of the link mark around `pos` (the caret inside a link), or null. */
export function linkRangeAt(doc: PMNode, pos: number): { from: number; to: number; href: string } | null {
  const $ = doc.resolve(pos);
  const parent = $.parent;
  if (!parent.isTextblock) return null;
  const mark = schema.marks.link.isInSet($.marks()) ?? (
    $.nodeAfter && schema.marks.link.isInSet($.nodeAfter.marks)
  );
  if (!mark) return null;
  const start = $.start();
  let from = pos;
  let to = pos;
  // Walk the inline children to find the run carrying this exact mark.
  let at = start;
  let found = false;
  parent.forEach((child) => {
    const has = mark.isInSet(child.marks);
    const end = at + child.nodeSize;
    if (has && at <= pos && pos <= end) found = true;
    at = end;
  });
  if (!found) return null;
  at = start;
  let runFrom = -1;
  let runTo = -1;
  parent.forEach((child) => {
    const has = mark.isInSet(child.marks);
    const end = at + child.nodeSize;
    if (has) {
      if (runFrom < 0) runFrom = at;
      runTo = end;
      if (at <= pos && pos <= end) {
        from = runFrom;
        to = runTo;
      }
    } else if (end <= pos) {
      runFrom = -1;
    }
    at = end;
  });
  if (from === to) return null;
  return { from, to, href: mark.attrs.href };
}

/** An address typed without a scheme (`example.com`, `www.x.org`) is stored with https:// (REQ-TEXT-071). */
export function normalizeHref(href: string): string {
  const url = href.trim();
  if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('/')) return url;
  return /^(www\.|[\w-]+(\.[\w-]+)*\.[a-z]{2,})(?=[/?#:]|$)/i.test(url) ? `https://${url}` : url;
}

/**
 * Apply (or, with an empty address, remove) a link over a range; with nothing
 * selected the address is inserted as its own linked text, separated from the
 * word before it (REQ-TEXT-071).
 */
export function applyLink(from: number, to: number, href: string): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    const url = normalizeHref(href);
    if (from === to) {
      if (!url) return false;
      const before = state.doc.textBetween(Math.max(0, from - 1), from, '\n', '\n');
      const lead = before && !/\s/.test(before) ? ' ' : '';
      tr.insertText(lead + url, from, to);
      tr.addMark(from + lead.length, from + lead.length + url.length, schema.marks.link.create({ href: url, auto: true }));
      tr.setSelection(TextSelection.create(tr.doc, from + lead.length + url.length));
    } else {
      tr.removeMark(from, to, schema.marks.link);
      if (url) tr.addMark(from, to, schema.marks.link.create({ href: url }));
      tr.setSelection(TextSelection.create(tr.doc, to));
    }
    if (dispatch) dispatch(tr);
    return true;
  };
}
