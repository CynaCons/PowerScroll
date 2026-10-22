/**
 * Formatting for text blocks that are selected but not being edited
 * (REQ-TEXT-050, REQ-TEXT-052): Bold/Italic/Underline/Strike apply to all of
 * a block's text, read back as "all text has it", and the old whole-block
 * `fontStyle` is folded into marks the first time such a block is formatted.
 */
import type { MarkType, Node as PMNode } from 'prosemirror-model';
import { Transform } from 'prosemirror-transform';
import { schema, FORMAT_MARK, type FormatKind } from './schema';
import { parseMarkdown } from './parse';
import { serializeMarkdown } from './serialize';
import { rangeAllHasMark } from './doc';

export type BlockTextData = { text: string; fontStyle?: string };

/** Mark every piece of text in the document. */
function addMarkToDoc(doc: PMNode, type: MarkType): PMNode {
  const tr = new Transform(doc);
  tr.addMark(0, doc.content.size, type.create());
  return tr.doc;
}

function removeMarkFromDoc(doc: PMNode, type: MarkType): PMNode {
  const tr = new Transform(doc);
  tr.removeMark(0, doc.content.size, type);
  return tr.doc;
}

/**
 * The block's document, with the legacy whole-block bold/italic (files saved
 * before the redesign) read as bold/italic on all of the text.
 */
export function docWithLegacyStyle(data: BlockTextData): PMNode {
  let doc = parseMarkdown(data.text);
  const style = data.fontStyle ?? 'normal';
  if (style.includes('bold')) doc = addMarkToDoc(doc, schema.marks.strong);
  if (style.includes('italic')) doc = addMarkToDoc(doc, schema.marks.em);
  return doc;
}

const allHas = (doc: PMNode, kind: FormatKind) =>
  rangeAllHasMark(doc, 0, doc.content.size, schema.marks[FORMAT_MARK[kind]]);

/** Which formats are on for all the text of all the given blocks. */
export function blockFormats(blocks: BlockTextData[]): Record<FormatKind, boolean> {
  const docs = blocks.map(docWithLegacyStyle);
  const every = (kind: FormatKind) => docs.length > 0 && docs.every((doc) => allHas(doc, kind));
  return { bold: every('bold'), italic: every('italic'), underline: every('underline'), strike: every('strike'), code: every('code') };
}

/**
 * Toggle a format on all the text of the given blocks: when any block lacks
 * it anywhere, every block gets it everywhere; otherwise it is removed from
 * all. Returns the new text of each block; `fontStyle` is always 'normal'
 * afterwards since the formatting now lives in the text.
 */
export function toggleBlockFormat(blocks: BlockTextData[], kind: FormatKind): { text: string; fontStyle: string }[] {
  const type = schema.marks[FORMAT_MARK[kind]];
  const docs = blocks.map(docWithLegacyStyle);
  const remove = docs.every((doc) => allHas(doc, kind));
  return docs.map((doc) => ({
    text: serializeMarkdown(remove ? removeMarkFromDoc(doc, type) : addMarkToDoc(doc, type)),
    fontStyle: 'normal',
  }));
}
