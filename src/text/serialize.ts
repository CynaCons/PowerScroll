/**
 * ProseMirror document → the app's markdown dialect (docs/DESIGN_TEXT.md):
 * `-` bullets, ordered children indented by 4, a single newline for a line
 * break, `- [ ]` task rows, GFM tables, `$..$` / `$$..$$` math, `<u>` for
 * underline, bare autolinks. Text the user typed is escaped so it reads back
 * as typed (REQ-TEXT-056).
 */
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { schema } from './schema';

const n = schema.nodes;

// ---------------------------------------------------------------- escaping

const WORD = /[\p{L}\p{N}]/u;

/** Escape the characters that would otherwise format, inside a run of text. */
function escapeInline(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const prev = text[i - 1] ?? '';
    const next = text[i + 1] ?? '';
    switch (c) {
      case '\\':
      case '*':
      case '`':
      case '[':
      case '$':
        out += '\\' + c;
        break;
      case '_':
        out += WORD.test(prev) && WORD.test(next) ? c : '\\_';
        break;
      case '~':
        out += next === '~' || prev === '~' ? '\\~' : c;
        break;
      case '<':
        out += /[a-zA-Z/!?]/.test(next) ? '\\<' : c;
        break;
      case '!':
        out += next === '[' ? '\\!' : c;
        break;
      case '&':
        out += /^(#x[0-9a-f]+|#\d+|[a-z]+);/i.test(text.slice(i + 1)) ? '\\&' : c;
        break;
      default:
        out += c;
    }
  }
  return out;
}

/** Escape what would start a block at the beginning of a line of text. */
function escapeLineStart(line: string): string {
  if (/^\s*(?:[-=*_]\s*){1,}$/.test(line) && line.trim()) return line.replace(/^(\s*)/, '$1\\');
  return line
    .replace(/^(\s*)(#{1,6})(?=\s|$)/, '$1\\$2')
    .replace(/^(\s*)>/, '$1\\>')
    .replace(/^(\s*)([-+*])(?=\s|$)/, '$1\\$2')
    .replace(/^(\s*\d{1,9})([.)])(?=\s|$)/, '$1\\$2')
    .replace(/^(\s*)\|/, '$1\\|')
    .replace(/^(\s*)(```|~~~)/, '$1\\$2');
}

// ---------------------------------------------------------------- inline

interface MarkIO { open: string; close: string }

function markIO(mark: Mark, runText: string): MarkIO {
  switch (mark.type.name) {
    case 'strong': return { open: '**', close: '**' };
    case 'em': return { open: '*', close: '*' };
    case 'underline': return { open: '<u>', close: '</u>' };
    case 'strike': return { open: '~~', close: '~~' };
    case 'code': {
      const longest = (runText.match(/`+/g) ?? []).reduce((a, b) => Math.max(a, b.length), 0);
      const fence = '`'.repeat(longest + 1);
      const pad = runText.startsWith('`') || runText.endsWith('`') ? ' ' : '';
      return { open: fence + pad, close: pad + fence };
    }
    case 'link': {
      if (mark.attrs.auto && runText === mark.attrs.href) return { open: '', close: '' };
      const href = String(mark.attrs.href).replace(/[()"\s]/g, (c) => (c === ' ' ? '%20' : '\\' + c));
      const title = mark.attrs.title ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"` : '';
      return { open: '[', close: `](${href}${title})` };
    }
    default: return { open: '', close: '' };
  }
}

interface InlineOptions { tableCell?: boolean }

/** Serialize the inline content of a textblock (or table cell). */
export function serializeInline(parent: PMNode, options: InlineOptions = {}): string {
  // Break the content into pieces: each piece is a text run or a leaf with a mark set.
  type Piece = { text: string; marks: readonly Mark[]; leaf?: PMNode };
  const pieces: Piece[] = [];
  parent.forEach((child) => {
    if (child.isText) pieces.push({ text: child.text ?? '', marks: child.marks });
    else pieces.push({ text: '', marks: child.marks, leaf: child });
  });

  // Whitespace at the edges of a formatted run stays outside the markers.
  const hasFormat = (ms: readonly Mark[]) => ms.some((mk) => mk.type.name !== 'code' && mk.type.name !== 'link');
  const expelled: Piece[] = [];
  for (const p of pieces) {
    if (p.leaf || !hasFormat(p.marks) || p.marks.some((mk) => mk.type.name === 'code')) {
      expelled.push(p);
      continue;
    }
    const lead = p.text.match(/^\s*/)![0];
    const trail = p.text.length > lead.length ? p.text.match(/\s*$/)![0] : '';
    const core = p.text.slice(lead.length, p.text.length - trail.length);
    if (lead) expelled.push({ text: lead, marks: [] });
    if (core) expelled.push({ text: core, marks: p.marks });
    if (trail) expelled.push({ text: trail, marks: [] });
  }

  // Text of the whole run a mark covers from piece i on (for code fences and autolinks).
  const runText = (start: number, mark: Mark) => {
    let s = '';
    for (let j = start; j < expelled.length && mark.isInSet(expelled[j].marks); j++) {
      const q = expelled[j];
      s += q.leaf ? leafText(q.leaf) : q.text;
    }
    return s;
  };

  let out = '';
  let atLineStart = true;
  const active: { mark: Mark; io: MarkIO }[] = [];
  const write = (s: string) => {
    if (!s) return;
    out += s;
    atLineStart = s.endsWith('\n');
  };
  const writeText = (text: string) => {
    if (!text) return;
    const lines = escapeInline(text).split('\n');
    const first = atLineStart ? escapeLineStart(lines[0]) : lines[0];
    const rest = lines.slice(1).map(escapeLineStart);
    write([first, ...rest].join('\n'));
  };

  expelled.forEach((p, i) => {
    const marks = p.marks;
    // Close marks that end here (innermost first), open the new ones in schema order.
    let keep = 0;
    while (keep < active.length && keep < marks.length && active[keep].mark.eq(marks[keep])) keep++;
    while (active.length > keep) write(active.pop()!.io.close);
    for (let k = keep; k < marks.length; k++) {
      const io = markIO(marks[k], runText(i, marks[k]));
      active.push({ mark: marks[k], io });
      write(io.open);
    }
    if (p.leaf) {
      const leaf = p.leaf;
      if (leaf.type === n.hard_break) write(options.tableCell ? '<br>' : '\n');
      else if (leaf.type === n.math) write(leaf.attrs.display ? `$$${leaf.attrs.src}$$` : `$${leaf.attrs.src}$`);
      else if (leaf.type === n.image) {
        const title = leaf.attrs.title ? ` "${String(leaf.attrs.title).replace(/"/g, '\\"')}"` : '';
        write(`![${(leaf.attrs.alt ?? '').replace(/[[\]]/g, '\\$&')}](${leaf.attrs.src}${title})`);
      } else if (leaf.type === n.html_inline) write(leaf.attrs.html);
      else write(leaf.textContent);
    } else if (p.marks.some((mk) => mk.type.name === 'code')) {
      write(p.text.replace(/\n/g, ' '));
    } else {
      writeText(p.text);
    }
  });
  while (active.length) write(active.pop()!.io.close);
  return options.tableCell ? out.replace(/\|/g, '\\|').replace(/\n/g, ' ') : out;
}

function leafText(leaf: PMNode): string {
  if (leaf.type === n.hard_break) return '\n';
  if (leaf.type === n.math) return leaf.attrs.src;
  return leaf.textContent;
}

// ---------------------------------------------------------------- blocks

function indent(text: string, first: string, rest: string): string {
  return text
    .split('\n')
    .map((line, i) => (i === 0 ? first + line : line ? rest + line : line))
    .join('\n');
}

function serializeList(list: PMNode): string {
  const ordered = list.type === n.ordered_list;
  const start: number = ordered ? list.attrs.order : 1;
  const width = ordered ? String(start + list.childCount - 1).length + 2 : 2;
  const pad = ' '.repeat(ordered ? Math.max(4, width) : 2);
  const items: string[] = [];
  list.forEach((item, _off, i) => {
    const marker = ordered ? `${String(start + i).padStart(width - 2, ' ')}. ` : '- ';
    const box = item.attrs.checked === null ? '' : item.attrs.checked ? '[x] ' : '[ ] ';
    const body = serializeBlocks(item, list.attrs.tight);
    // An empty row is its marker alone (`- `); the parser reads that as a row.
    items.push(indent(body, marker + box, pad));
  });
  return items.join(list.attrs.tight ? '\n' : '\n\n');
}

function serializeBlock(node: PMNode, tight: boolean, parent: PMNode): string {
  switch (node.type) {
    case n.paragraph:
      // A blank line made with Enter is kept as a line holding <br>, which any
      // markdown renderer shows as a blank line (REQ-TEXT-069). Inside a list
      // row an empty paragraph is just the empty row.
      if (node.content.size === 0 && (parent.type === n.doc || parent.type === n.blockquote)) return '<br>';
      return serializeInline(node);
    case n.heading:
      return `${'#'.repeat(node.attrs.level)} ${serializeInline(node)}`;
    case n.blockquote:
      return serializeBlocks(node, tight).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
    case n.code_block: {
      const body = node.textContent;
      const longest = (body.match(/`{3,}/g) ?? []).reduce((a, b) => Math.max(a, b.length), 2);
      const fence = '`'.repeat(longest + 1);
      return `${fence}${node.attrs.params}\n${body}\n${fence}`;
    }
    case n.horizontal_rule:
      return '---';
    case n.bullet_list:
    case n.ordered_list:
      return serializeList(node);
    case n.html_block:
      return node.attrs.html;
    case n.table: {
      const rows: string[][] = [];
      const aligns: (string | null)[] = [];
      node.forEach((row, _o, r) => {
        const cells: string[] = [];
        row.forEach((cell, _co, c) => {
          cells.push(serializeInline(cell, { tableCell: true }));
          if (r === 0) aligns[c] = cell.attrs.align ?? null;
        });
        rows.push(cells);
      });
      if (rows.length === 0) return '';
      const header = rows[0];
      const delim = header.map((_c, i) => (aligns[i] === 'left' ? ':---' : aligns[i] === 'center' ? ':---:' : aligns[i] === 'right' ? '---:' : '---'));
      const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
      return [line(header), `|${delim.join('|')}|`, ...rows.slice(1).map(line)].join('\n');
    }
    default:
      return node.isTextblock ? serializeInline(node) : node.textContent;
  }
}

/** Serialize a sequence of blocks (a doc, list item, or blockquote body). */
function serializeBlocks(parent: PMNode, tight = false): string {
  const parts: string[] = [];
  parent.forEach((child, _off, i) => {
    const text = serializeBlock(child, tight, parent);
    if (i === 0) {
      parts.push(text);
      return;
    }
    // Inside a tight list item, a nested list follows its paragraph on the next line.
    const prev = parent.child(i - 1);
    const joiner = tight && parent.type === n.list_item && (child.type === n.bullet_list || child.type === n.ordered_list) && prev.isTextblock
      ? '\n'
      : '\n\n';
    parts.push(joiner + text);
  });
  return parts.join('');
}

/** Serialize a document to the app's markdown dialect. */
export function serializeMarkdown(doc: PMNode): string {
  return serializeBlocks(doc);
}
