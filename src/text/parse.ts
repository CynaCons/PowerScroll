/**
 * Markdown → ProseMirror document, through `marked.lexer`: the tokenizer the
 * finished block always used, so the editor can only ever show what the
 * block shows. The app's normalisers run first (no setext headings,
 * under-indented numbered children padded), math is cut out before the lexer
 * sees it (the same regexes mathParser.ts used), and raw HTML is kept literal
 * as atoms.
 */
import { marked, type Token, type Tokens } from 'marked';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { schema } from './schema';
import { normalizeListIndents } from '../utils/listIndent';
import { neutralizeSetextHeadings } from '../utils/setext';

marked.setOptions({ breaks: true, gfm: true });

const n = schema.nodes;
const m = schema.marks;

// ---------------------------------------------------------------- math

/** Private-use sentinels: marked treats them as ordinary text. */
const PH_OPEN = '';
const PH_CLOSE = '';
const PH_RE = /(\d+)/g;

interface MathPiece { src: string; display: boolean; raw: string }

/**
 * Replace `$$..$$` and `$..$` with placeholders before lexing, so `$a*b$`
 * stays one piece of math. A backslash before a dollar keeps it literal.
 */
function cutMath(text: string): { text: string; pieces: MathPiece[] } {
  const pieces: MathPiece[] = [];
  const put = (src: string, display: boolean, raw: string) => {
    pieces.push({ src, display, raw });
    return `${PH_OPEN}${pieces.length - 1}${PH_CLOSE}`;
  };
  let out = text.replace(/(^|[^\\])\$\$([\s\S]+?[^\\])\$\$/g, (raw, pre: string, inner: string) => pre + put(inner.trim(), true, raw.slice(pre.length)));
  out = out.replace(/(^|[^$\\])\$([^\n$]+?)(?<!\\)\$(?!\$)/g, (raw, pre: string, inner: string) => pre + put(inner, false, raw.slice(pre.length)));
  return { text: out, pieces };
}

/** Put the original math source back into strings that are not inline text (code, html, hrefs). */
function restoreRaw(s: string, pieces: MathPiece[]): string {
  return s.replace(PH_RE, (_all, i) => pieces[+i]?.raw ?? '');
}

// ---------------------------------------------------------------- entities

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** marked leaves `&amp;` in text and the browser shows `&`; the doc holds `&`. */
function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[body.toLowerCase()] ?? all;
  });
}

// ---------------------------------------------------------------- inline

type InlineToken = Token & { tokens?: Token[]; text?: string; raw?: string };

function inline(tokens: Token[], marks: Mark[], pieces: MathPiece[]): PMNode[] {
  const out: PMNode[] = [];
  const text = (t: string, ms: Mark[]) => {
    if (t) out.push(schema.text(t, ms));
  };
  const textWithMath = (t: string, ms: Mark[]) => {
    let last = 0;
    for (const hit of t.matchAll(PH_RE)) {
      const at = hit.index ?? 0;
      text(t.slice(last, at), ms);
      const piece = pieces[+hit[1]];
      if (piece) out.push(n.math.create({ src: piece.src, display: piece.display }));
      last = at + hit[0].length;
    }
    text(t.slice(last), ms);
  };
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i++] as InlineToken;
    switch (t.type) {
      case 'text': {
        if (t.tokens) {
          out.push(...inline(t.tokens, marks, pieces));
          break;
        }
        textWithMath(decodeEntities((t.text ?? '').replace(/\u200b/g, '')), marks);
        break;
      }
      case 'escape':
        text(decodeEntities(t.text ?? ''), marks);
        break;
      case 'strong':
        out.push(...inline(t.tokens ?? [], [...marks, m.strong.create()], pieces));
        break;
      case 'em':
        out.push(...inline(t.tokens ?? [], [...marks, m.em.create()], pieces));
        break;
      case 'del':
        out.push(...inline(t.tokens ?? [], [...marks, m.strike.create()], pieces));
        break;
      case 'codespan':
        text(restoreRaw(decodeEntities(t.text ?? ''), pieces), [...marks, m.code.create()]);
        break;
      case 'br':
        out.push(n.hard_break.create());
        break;
      case 'link': {
        const link = t as Tokens.Link;
        const auto = link.raw === link.href || link.raw === `<${link.href}>`;
        const mark = m.link.create({ href: restoreRaw(link.href, pieces), title: link.title || null, auto });
        out.push(...inline(link.tokens ?? [], [...marks, mark], pieces));
        break;
      }
      case 'image': {
        const img = t as Tokens.Image;
        out.push(n.image.create({ src: restoreRaw(img.href, pieces), alt: img.text || null, title: img.title || null }));
        break;
      }
      case 'html': {
        const html = restoreRaw(t.text ?? '', pieces);
        if (/^<u>$/i.test(html)) {
          // <u>…</u> is how the app writes underline: find the closing tag.
          let depth = 1;
          let j = i;
          for (; j < tokens.length; j++) {
            const tj = tokens[j] as InlineToken;
            if (tj.type !== 'html') continue;
            if (/^<u>$/i.test(tj.text ?? '')) depth++;
            else if (/^<\/u>$/i.test(tj.text ?? '') && --depth === 0) break;
          }
          if (j < tokens.length) {
            out.push(...inline(tokens.slice(i, j), [...marks, m.underline.create()], pieces));
            i = j + 1;
            break;
          }
        }
        out.push(n.html_inline.create({ html }));
        break;
      }
      default:
        textWithMath(decodeEntities(t.raw ?? t.text ?? ''), marks);
    }
  }
  return out;
}

// ---------------------------------------------------------------- blocks

function blocks(tokens: Token[], pieces: MathPiece[]): PMNode[] {
  const out: PMNode[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'space':
      case 'checkbox':
        break;
      case 'heading': {
        const h = t as Tokens.Heading;
        out.push(n.heading.create({ level: h.depth }, inline(h.tokens, [], pieces)));
        break;
      }
      case 'paragraph':
        out.push(n.paragraph.create(null, inline((t as Tokens.Paragraph).tokens, [], pieces)));
        break;
      case 'text': {
        // A tight list item's body.
        const tt = t as Tokens.Text;
        out.push(n.paragraph.create(null, inline(tt.tokens ?? [tt], [], pieces)));
        break;
      }
      case 'blockquote':
        out.push(n.blockquote.create(null, blocks((t as Tokens.Blockquote).tokens, pieces)));
        break;
      case 'code': {
        const c = t as Tokens.Code;
        const body = restoreRaw(c.text, pieces);
        out.push(n.code_block.create({ params: c.lang || '' }, body ? [schema.text(body)] : []));
        break;
      }
      case 'hr':
        out.push(n.horizontal_rule.create());
        break;
      case 'html':
        out.push(n.html_block.create({ html: restoreRaw((t as Tokens.HTML).text, pieces).replace(/\n+$/, '') }));
        break;
      case 'list': {
        const list = t as Tokens.List;
        const items = list.items.map((it) => {
          const body = blocks(it.tokens, pieces);
          if (body.length === 0 || !body[0].isTextblock || body[0].type !== n.paragraph) body.unshift(n.paragraph.create());
          return n.list_item.create({ checked: it.task ? !!it.checked : null }, body);
        });
        const tight = !list.loose;
        out.push(
          list.ordered
            ? n.ordered_list.create({ order: typeof list.start === 'number' ? list.start : 1, tight }, items)
            : n.bullet_list.create({ tight }, items),
        );
        break;
      }
      case 'table': {
        const table = t as Tokens.Table;
        const cell = (type: typeof n.table_cell, c: Tokens.TableCell, align: string | null) =>
          type.create({ align: align || null }, inline(c.tokens, [], pieces));
        const rows = [n.table_row.create(null, table.header.map((c, i) => cell(n.table_header, c, table.align[i])))];
        for (const r of table.rows) rows.push(n.table_row.create(null, r.map((c, i) => cell(n.table_cell, c, table.align[i]))));
        out.push(n.table.create(null, rows));
        break;
      }
      default:
        out.push(n.paragraph.create(null, inline([{ type: 'text', raw: t.raw, text: t.raw } as Token], [], pieces)));
    }
  }
  return out;
}

const EMPTY_ROW = /^(\s*(?:[-*+]|\d{1,9}[.)])(?: \[[ xX]\])?) ?$/;

/**
 * A line holding only a list marker (`- `, `1. `, `- [ ] `) is an empty row,
 * as the editor writes it, wherever it stands; markdown alone would read
 * `- ` after a blank line as text. Fenced code is left alone.
 */
function markEmptyListRows(markdown: string): string {
  const lines = markdown.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = lines[i].match(EMPTY_ROW);
    if (m) lines[i] = `${m[1]} \u200b`;
  }
  return lines.join('\n');
}

/** Parse the app's markdown dialect into a document. Never throws on text. */
export function parseMarkdown(markdown: string): PMNode {
  const { text, pieces } = cutMath(markdown ?? '');
  const cleaned = normalizeListIndents(markEmptyListRows(neutralizeSetextHeadings(text)));
  let content: PMNode[];
  try {
    content = blocks(marked.lexer(cleaned), pieces);
  } catch {
    content = [n.paragraph.create(null, markdown ? [schema.text(markdown)] : [])];
  }
  return n.doc.create(null, content.length ? content : [n.paragraph.create()]);
}
