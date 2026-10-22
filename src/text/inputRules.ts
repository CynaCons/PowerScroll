/**
 * Line-start shortcuts (REQ-TEXT-057) and closed inline markers (REQ-TEXT-056):
 * `# `, `- `, `* `, `1. `, `[ ] `, `- [ ] `, `> `, and `**x**`, `~~x~~`,
 * `` `x` ``. A single `*` or `_` never formats. Ctrl+Z right after turns the
 * shortcut back into the typed characters (undoInputRule).
 */
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import type { MarkType } from 'prosemirror-model';
import { canJoin, findWrapping } from 'prosemirror-transform';
import { schema } from './schema';

const n = schema.nodes;

function taskRule(): InputRule {
  return new InputRule(/^(?:[-*+]\s)?\[( |x|X)\]\s$/, (state, match, start, end) => {
    const checked = match[1].toLowerCase() === 'x';
    const tr = state.tr.delete(start, end);
    const $ = tr.doc.resolve(start);
    if ($.depth >= 2 && $.node(-1).type === n.list_item) {
      // Already a list row: it gets a box.
      return tr.setNodeMarkup($.before(-1), undefined, { checked });
    }
    const range = $.blockRange();
    if (!range) return null;
    const wrapping = findWrapping(range, n.bullet_list);
    if (!wrapping) return null;
    tr.wrap(range, wrapping);
    tr.setNodeMarkup(range.start + 1, undefined, { checked });
    const before = tr.doc.resolve(range.start).nodeBefore;
    if (before && before.type === n.bullet_list && canJoin(tr.doc, range.start)) tr.join(range.start);
    return tr;
  });
}

/** `**bold**`, `~~strike~~`, `` `code` `` typed in full become the mark, markers gone. */
function closedMarkRule(regexp: RegExp, type: MarkType, markerLength: number): InputRule {
  return new InputRule(regexp, (state, match, start, end) => {
    const whole = match[1];
    const inner = match[2];
    if (!inner || /^\s|\s$/.test(inner)) return null;
    // `end` is where the typed character would go: the document holds the match
    // without its last character, so the closing marker is one shorter there.
    const textStart = start + match[0].length - whole.length;
    const tr = state.tr;
    if (markerLength > 1) tr.delete(end - (markerLength - 1), end);
    tr.delete(textStart, textStart + markerLength);
    tr.addMark(textStart, textStart + inner.length, type.create());
    tr.removeStoredMark(type);
    return tr;
  });
}

/**
 * A closed `$...$` with no space just inside the dollars becomes an inline
 * formula, `$$...$$` alone on a line a display formula (REQ-TEXT-067).
 * `costs $5 or $6` has a space inside and stays text (REQ-TEXT-056).
 */
function mathRules(): InputRule[] {
  const inline = new InputRule(/(?:^|[^$\\])(\$([^\s$](?:[^$\n]*?[^\s$])?)\$)$/, (state, match, start, end) => {
    const textStart = start + match[0].length - match[1].length;
    return state.tr.replaceWith(textStart, end, n.math.create({ src: match[2], display: false }));
  });
  const display = new InputRule(/^\$\$([^$\n]+?)\$\$$/, (state, match, start, end) =>
    state.tr.replaceWith(start, end, n.math.create({ src: match[1].trim(), display: true })));
  return [display, inline];
}

export function textInputRules() {
  return inputRules({
    rules: [
      ...mathRules(),
      textblockTypeInputRule(/^(#{1,6})\s$/, n.heading, (match) => ({ level: match[1].length })),
      wrappingInputRule(/^\s*>\s$/, n.blockquote),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        n.ordered_list,
        (match) => ({ order: +match[1] }),
        (match, node) => node.childCount + node.attrs.order === +match[1],
      ),
      taskRule(),
      wrappingInputRule(/^\s*([-*+])\s$/, n.bullet_list),
      closedMarkRule(/(?:^|[^*])(\*\*([^*]+)\*\*)$/, schema.marks.strong, 2),
      closedMarkRule(/(?:^|[^~])(~~([^~]+)~~)$/, schema.marks.strike, 2),
      closedMarkRule(/(?:^|[^`])(`([^`]+)`)$/, schema.marks.code, 1),
    ],
  });
}
