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
import { neutralizeSetextHeadings, EMPTY_ROW_MARK } from '../utils/setext';

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
  let out = text.replace(/(^|[^\\])\$\$((?:[^$\\]|\\[\s\S])+?)\$\$/g, (raw, pre: string, inner: string) => pre + put(inner.trim(), true, raw.slice(pre.length)));
  out = out.replace(/(^|[^$\\])\$([^\n$]+?)(?<!\\)\$(?!\$)/g, (raw, pre: string, inner: string) => pre + put(inner, false, raw.slice(pre.length)));
  return { text: out, pieces };
}

/** Put the original math source back into strings that are not inline text (code, html, hrefs). */
function restoreRaw(s: string, pieces: MathPiece[]): string {
  return s.replace(PH_RE, (_all, i) => pieces[+i]?.raw ?? '');
}

// ---------------------------------------------------------------- entities

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', deg: '°',
  euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶', middot: '·', bull: '•', hellip: '…',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  rarr: '→', larr: '←', uarr: '↑', darr: '↓', harr: '↔', times: '×', divide: '÷', plusmn: '±', ne: '≠', le: '≤', ge: '≥',
  infin: '∞', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', pi: 'π', mu: 'μ', sigma: 'σ', omega: 'ω', check: '✓',
};

let decoder: HTMLTextAreaElement | null = null;

/**
 * marked leaves `&amp;`, `&copy;`, `&#169;` in text and the browser shows the
 * character; the doc holds the character (REQ-TEXT-064). In a page the
 * browser decodes every entity; elsewhere a table of the common ones.
 */
function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  if (typeof document !== 'undefined') {
    decoder ??= document.createElement('textarea');
    decoder.innerHTML = s.replace(/</g, '&lt;');
    return decoder.value;
  }
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[body.toLowerCase()] ?? all;
  });
}

// ---------------------------------------------------------------- inline

type InlineToken = Token & { tokens?: Token[]; text?: string; raw?: string };

const HTML_MARKS: Record<string, string> = {
  u: 'underline', strong: 'strong', b: 'strong', em: 'em', i: 'em', del: 'strike', s: 'strike', strike: 'strike',
};

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
      if (piece) out.push(n.math.create({ src: piece.src, display: piece.display }, undefined, ms));
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
        textWithMath(decodeEntities((t.text ?? '').replace(EMPTY_ROW_MARK, '')), marks);
        break;
      }
      case 'escape':
        text(decodeEntities(t.text ?? ''), marks);
        break;
      case 'checkbox':
        // A task row's box in a loose list arrives as an inline token; the box is the row's state (REQ-TEXT-063).
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
        out.push(n.hard_break.create(null, undefined, marks));
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
        // The image keeps the marks around it, e.g. the link of `[![alt](img)](url)`.
        out.push(n.image.create({ src: restoreRaw(img.href, pieces), alt: img.text || null, title: img.title || null }, undefined, marks));
        break;
      }
      case 'html': {
        const html = restoreRaw(t.text ?? '', pieces);
        // <u>, and the inline HTML forms the serializer falls back to when
        // markdown delimiters would not flank (REQ-TEXT-075), become marks.
        const open = html.match(/^<(u|strong|b|em|i|del|s|strike)>$/i);
        const markName = open && HTML_MARKS[open[1].toLowerCase()];
        if (open && markName) {
          const tag = open[1].toLowerCase();
          const opens = new RegExp(`^<${tag}>$`, 'i');
          const closes = new RegExp(`^</${tag}>$`, 'i');
          let depth = 1;
          let j = i;
          for (; j < tokens.length; j++) {
            const tj = tokens[j] as InlineToken;
            if (tj.type !== 'html') continue;
            if (opens.test(tj.text ?? '')) depth++;
            else if (closes.test(tj.text ?? '') && --depth === 0) break;
          }
          if (j < tokens.length) {
            out.push(...inline(tokens.slice(i, j), [...marks, m[markName].create()], pieces));
            i = j + 1;
            break;
          }
        }
        out.push(n.html_inline.create({ html }, undefined, marks));
        break;
      }
      default:
        textWithMath(decodeEntities(t.raw ?? t.text ?? ''), marks);
    }
  }
  return out;
}

/**
 * HTML rendering collapsed runs of spaces and the indentation of continuation
 * lines; the editor shows text as it is (`white-space: pre-wrap`), so the
 * parser collapses them the way the finished block always looked. Code
 * spans keep their spaces.
 */
function tidyWhitespace(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  nodes.forEach((node, i) => {
    if (!node.isText || m.code.isInSet(node.marks)) {
      out.push(node);
      return;
    }
    let s = (node.text ?? '').replace(/[ \t]+/g, ' ');
    const prev = nodes[i - 1];
    const next = nodes[i + 1];
    if (!prev || prev.type === n.hard_break) s = s.replace(/^ +/, '');
    if (!next || next.type === n.hard_break) s = s.replace(/ +$/, '');
    if (s) out.push(schema.text(s, node.marks));
  });
  return out;
}

const inlineContent = (tokens: Token[], pieces: MathPiece[]) => tidyWhitespace(inline(tokens, [], pieces));

// ---------------------------------------------------------------- blocks

const OPEN_TAG = /^\s*<([a-zA-Z][\w-]*)(?:\s[^>]*)?>/;
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'col', 'wbr', 'area', 'base', 'embed', 'param', 'track']);

/**
 * An HTML block that opens a tag closed by a later HTML block (e.g.
 * `<details>…` and `</details>` around markdown) is one raw block: it renders
 * as the browser always did, with the markdown between rendered inside it.
 * Returns the index of the closing token, or -1.
 */
function findClosingHtml(tokens: Token[], i: number): number {
  const open = (tokens[i] as Tokens.HTML).text.match(OPEN_TAG);
  if (!open || VOID_TAGS.has(open[1].toLowerCase())) return -1;
  const tag = open[1].toLowerCase();
  const closes = new RegExp(`^\\s*</${tag}>\\s*$`, 'i');
  if (new RegExp(`</${tag}>`, 'i').test((tokens[i] as Tokens.HTML).text)) return -1;
  for (let j = i + 1; j < tokens.length; j++) {
    const tj = tokens[j];
    if (tj.type === 'html' && closes.test((tj as Tokens.HTML).text)) return j;
  }
  return -1;
}

function blocks(tokens: Token[], pieces: MathPiece[]): PMNode[] {
  const out: PMNode[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.type) {
      case 'space':
      case 'checkbox':
      case 'def':
        // Link reference definitions never show; marked already resolved the links that use them.
        break;
      case 'heading': {
        const h = t as Tokens.Heading;
        out.push(n.heading.create({ level: h.depth }, inlineContent(h.tokens, pieces)));
        break;
      }
      case 'paragraph':
        out.push(n.paragraph.create(null, inlineContent((t as Tokens.Paragraph).tokens, pieces)));
        break;
      case 'text': {
        // A tight list item's body.
        const tt = t as Tokens.Text;
        out.push(n.paragraph.create(null, inlineContent(tt.tokens ?? [tt], pieces)));
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
      case 'html': {
        const html = restoreRaw((t as Tokens.HTML).text, pieces).replace(/\n+$/, '');
        // A line holding only <br> is how a blank line (empty paragraph) is stored (REQ-TEXT-069).
        if (/^<br\s*\/?>$/i.test(html)) {
          out.push(n.paragraph.create());
          break;
        }
        const close = findClosingHtml(tokens, i);
        if (close > i) {
          const raw = tokens.slice(i, close + 1).map((tk) => tk.raw).join('').replace(/\n+$/, '');
          const inner = tokens.slice(i + 1, close).map((tk) => tk.raw).join('').trim();
          out.push(n.html_block.create({
            html: raw,
            open: html,
            inner: restoreRaw(inner, pieces),
            close: restoreRaw((tokens[close] as Tokens.HTML).text, pieces).trim(),
          }));
          i = close;
          break;
        }
        out.push(n.html_block.create({ html }));
        break;
      }
      case 'list': {
        const list = t as Tokens.List;
        const items = list.items.map((it) => {
          const body = blocks(it.tokens, pieces);
          if (body.length === 0) body.push(n.paragraph.create());
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
          type.create({ align: align || null }, inlineContent(c.tokens, pieces));
        const rows = [n.table_row.create(null, table.header.map((c, k) => cell(n.table_header, c, table.align[k])))];
        for (const r of table.rows) rows.push(n.table_row.create(null, r.map((c, k) => cell(n.table_cell, c, table.align[k]))));
        out.push(n.table.create(null, rows));
        break;
      }
      default:
        out.push(n.paragraph.create(null, inlineContent([{ type: 'text', raw: t.raw, text: t.raw } as Token], pieces)));
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
    const hit = lines[i].match(EMPTY_ROW);
    if (hit) lines[i] = `${hit[1]} ${EMPTY_ROW_MARK}`;
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
