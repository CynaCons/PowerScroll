/**
 * What search looks at and how it matches (docs/SRS_SEARCH.md, v0.92.0).
 *
 * Everything is matched as the reader sees it (REQ-SEARCH-015): a text block
 * is parsed with the same markdown engine that draws it, so `**`, link
 * addresses and HTML tags are never part of the searchable text, and a phrase
 * that runs across formatting still matches. Matching ignores case and
 * accents (REQ-SEARCH-016) through a folded copy of the text that keeps a map
 * back to the original characters, so marks land on what is shown.
 */
import type { Node as PMNode } from 'prosemirror-model';
import type {
  BoardCard, CanvasNode, DiagramNodeData, ImageNodeData, Page, Section, ShapeNodeData, TextNodeData, WorkspaceData,
} from '../types/data';
import { parseMarkdown } from '../text/parse';

export type SearchKind = 'text' | 'diagram' | 'shape' | 'image' | 'card' | 'page' | 'section' | 'scroll';
export type SearchScope = 'page' | 'notebook';

/** Something search can find, and where choosing it should take the user. */
export interface SearchEntry {
  kind: SearchKind;
  /** Shown before the snippet: "Text", "Card #12", "Page title"... */
  label: string;
  text: string;
  sectionId: string;
  pageId: string;
  /** Node id for canvas kinds, card id for cards; absent for titles. */
  targetId?: string;
  /** One heading per group in notebook results (REQ-SEARCH-018). */
  group: string;
  groupTitle: string;
}

export interface SnippetPart {
  text: string;
  mark: boolean;
}

export interface SearchResult {
  entry: SearchEntry;
  parts: SnippetPart[];
  /** Occurrences in the whole entry, not only in the snippet. */
  count: number;
}

// ---------------------------------------------------------------- readable text

const CACHE_LIMIT = 20000;
const readableCache = new Map<string, string>();

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function docText(doc: PMNode): string {
  const blocks: string[] = [];
  doc.descendants((node) => {
    if (node.isTextblock) {
      let line = '';
      node.forEach((child) => {
        if (child.isText) line += child.text ?? '';
        else if (child.type.name === 'hard_break') line += '\n';
        else if (child.type.name === 'math') line += String(child.attrs.src ?? '');
        else if (child.type.name === 'image') line += String(child.attrs.alt ?? '');
        else if (child.type.name === 'html_inline') line += stripTags(String(child.attrs.html ?? ''));
      });
      blocks.push(line);
      return false;
    }
    if (node.isLeaf && node.type.name === 'html_block') {
      blocks.push(stripTags(String(node.attrs.html ?? '')));
      return false;
    }
    return true;
  });
  return blocks.join('\n');
}

/** A text block's markdown as the reader sees it (REQ-SEARCH-015). */
export function readableMarkdown(markdown: string): string {
  const hit = readableCache.get(markdown);
  if (hit !== undefined) return hit;
  let out: string;
  try {
    out = docText(parseMarkdown(markdown));
  } catch {
    out = markdown;
  }
  return remember(readableCache, markdown, out);
}

const LABEL_ATTRS = ['value', 'label', 'tooltip'];

/**
 * A diagram's words. draw.io and SVG sources are XML: their labels live in
 * `value`/`label` attributes (often holding HTML) and in text nodes, so only
 * those are searched, never element or attribute names. PlantUML and Mermaid
 * sources are text already.
 */
export function readableDiagramSource(source: string): string {
  const trimmed = source.trim();
  if (!trimmed.startsWith('<')) return source;
  const hit = readableCache.get(source);
  if (hit !== undefined) return hit;
  const words: string[] = [];
  try {
    const xml = new DOMParser().parseFromString(trimmed, 'text/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('not xml');
    const walk = (el: Element) => {
      for (const name of LABEL_ATTRS) {
        const v = el.getAttribute(name);
        if (v) words.push(stripTags(v));
      }
      el.childNodes.forEach((child) => {
        if (child.nodeType === 1) walk(child as Element);
        else if (child.nodeType === 3 || child.nodeType === 4) {
          const t = (child.textContent ?? '').trim();
          // A compressed draw.io page is one long base64 run; it is not words.
          if (t && !(t.length > 80 && !/\s/.test(t))) words.push(t);
        }
      });
    };
    walk(xml.documentElement);
  } catch {
    words.push(stripTags(trimmed));
  }
  return remember(readableCache, source, words.join('\n'));
}

// ---------------------------------------------------------------- folding

interface Folded {
  text: string;
  /** map[i] = index in the original of folded character i; one extra entry for the end. */
  map: number[];
}

const foldCache = new Map<string, Folded>();
const COMBINING = /[̀-ͯ]/g;

/** Lower case, no accents, whitespace runs as one space. */
export function fold(s: string): Folded {
  const hit = foldCache.get(s);
  if (hit) return hit;
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 0x2028 || code === 0x2029) {
      if (text.endsWith(' ')) continue;
      text += ' ';
      map.push(i);
      continue;
    }
    if (code < 128) {
      text += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : s[i];
      map.push(i);
      continue;
    }
    for (const c of s[i].normalize('NFD').replace(COMBINING, '').toLowerCase()) {
      text += c;
      map.push(i);
    }
  }
  map.push(s.length);
  return remember(foldCache, s, { text, map });
}

/** The query folded the same way, trimmed. */
export function foldQuery(query: string): string {
  return fold(query.trim()).text;
}

/** Every non-overlapping occurrence of a folded query, as ranges of the original text. */
export function findMatches(text: string, foldedQuery: string): Array<[number, number]> {
  if (!foldedQuery) return [];
  const f = fold(text);
  const out: Array<[number, number]> = [];
  let at = f.text.indexOf(foldedQuery);
  while (at >= 0) {
    const end = at + foldedQuery.length;
    out.push([f.map[at], f.map[end - 1] + 1]);
    at = f.text.indexOf(foldedQuery, end);
  }
  return out;
}

const BEFORE = 40;
const WINDOW = 160;

/** A one-line window around the first match, every match inside it marked (REQ-SEARCH-017). */
export function snippet(text: string, matches: Array<[number, number]>): SnippetPart[] {
  const [first] = matches;
  let start = Math.max(0, first[0] - BEFORE);
  if (start > 0) {
    const space = text.lastIndexOf(' ', start);
    if (space >= 0 && first[0] - space <= BEFORE + 15) start = space + 1;
  }
  const end = Math.min(text.length, Math.max(start + WINDOW, first[1]));
  const parts: SnippetPart[] = [];
  const flat = (s: string) => s.replace(/\s+/g, ' ');
  let at = start;
  if (start > 0) parts.push({ text: '…', mark: false });
  for (const [a, b] of matches) {
    if (a >= end) break;
    if (a < at) continue;
    if (a > at) parts.push({ text: flat(text.slice(at, a)), mark: false });
    parts.push({ text: flat(text.slice(a, Math.min(b, end))), mark: true });
    at = Math.min(b, end);
  }
  if (at < end) parts.push({ text: flat(text.slice(at, end)), mark: false });
  if (end < text.length) parts.push({ text: '…', mark: false });
  if (parts.length && !parts[0].mark && start === 0) parts[0].text = parts[0].text.replace(/^\s+/, '');
  return parts;
}

// ---------------------------------------------------------------- entries

const KIND_LABEL: Record<Exclude<SearchKind, 'card'>, string> = {
  text: 'Text',
  diagram: 'Diagram',
  shape: 'Shape',
  image: 'Image',
  page: 'Page title',
  section: 'Section title',
  scroll: 'Scroll title',
};

function nodeEntry(node: CanvasNode, base: Omit<SearchEntry, 'kind' | 'label' | 'text'>): SearchEntry | null {
  const make = (kind: SearchEntry['kind'], text: string): SearchEntry | null =>
    text.trim() ? { ...base, kind, label: KIND_LABEL[kind as Exclude<SearchKind, 'card'>], text, targetId: node.id } : null;
  switch (node.type) {
    case 'text':
      return make('text', readableMarkdown((node.data as TextNodeData).text ?? ''));
    case 'diagram': {
      const d = node.data as DiagramNodeData;
      return make('diagram', [d.title ?? '', readableDiagramSource(d.source ?? '')].filter(Boolean).join('\n'));
    }
    case 'shape':
      return make('shape', (node.data as ShapeNodeData).label?.text ?? '');
    case 'image': {
      const d = node.data as ImageNodeData;
      return make('image', [d.note ?? '', d.alt ?? ''].filter(Boolean).join('\n'));
    }
    default:
      return null;
  }
}

function cardText(card: BoardCard): string {
  return [
    card.title,
    readableMarkdown(card.description ?? ''),
    ...card.checklist.map((item) => item.text),
    ...card.notes.map((note) => readableMarkdown(note.text)),
  ].filter((s) => s && s.trim()).join('\n');
}

const COLUMN_ORDER = ['todo', 'doing', 'waiting', 'done'];

function pageEntries(section: Section, page: Page, liveNodes: CanvasNode[] | null, withTitle: boolean): SearchEntry[] {
  const group = `page:${page.id}`;
  const base = { sectionId: section.id, pageId: page.id, group, groupTitle: `${section.title} > ${page.title}` };
  const out: SearchEntry[] = [];
  if (withTitle && page.title.trim()) out.push({ ...base, kind: 'page', label: KIND_LABEL.page, text: page.title });
  if (page.kind === 'board') {
    const cards = (page.board?.cards ?? [])
      .filter((card) => !card.archivedAt)
      .sort((a, b) => COLUMN_ORDER.indexOf(a.column) - COLUMN_ORDER.indexOf(b.column) || a.order - b.order);
    for (const card of cards) {
      out.push({ ...base, kind: 'card', label: `Card #${card.number}`, text: cardText(card), targetId: card.id });
    }
    return out;
  }
  for (const scroll of page.scrolls ?? []) {
    if (scroll.title.trim()) out.push({ ...base, kind: 'scroll', label: KIND_LABEL.scroll, text: scroll.title, targetId: scroll.id });
  }
  // Reading order: top to bottom, then left to right.
  const nodes = [...(liveNodes ?? page.nodes)].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const node of nodes) {
    const entry = nodeEntry(node, base);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Everything in scope, in notebook order (REQ-SEARCH-013, REQ-SEARCH-014).
 * The active page's canvas nodes come from the live canvas store, which is
 * ahead of the copy saved on the workspace page.
 */
export function collectEntries(
  workspace: WorkspaceData,
  scope: SearchScope,
  activeSectionId: string,
  activePageId: string,
  liveNodes: CanvasNode[],
): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const section of workspace.sections) {
    if (scope === 'notebook' && section.title.trim()) {
      const first = section.pages[0];
      out.push({
        kind: 'section', label: KIND_LABEL.section, text: section.title,
        sectionId: section.id, pageId: first?.id ?? '',
        group: `section:${section.id}`, groupTitle: section.title,
      });
    }
    for (const page of section.pages) {
      const isActive = section.id === activeSectionId && page.id === activePageId;
      if (scope === 'page' && !isActive) continue;
      const live = isActive && page.kind !== 'board' ? liveNodes : null;
      out.push(...pageEntries(section, page, live, scope === 'notebook'));
    }
  }
  return out;
}

/** Prepare every entry for matching, so the first keystroke costs no more than the next. */
export function warmEntries(entries: SearchEntry[]): void {
  for (const entry of entries) fold(entry.text);
}

/** Entries that contain the query, each with its snippet. */
export function runSearch(entries: SearchEntry[], query: string): SearchResult[] {
  const q = foldQuery(query);
  if (!q) return [];
  const out: SearchResult[] = [];
  for (const entry of entries) {
    if (!fold(entry.text).text.includes(q)) continue;
    const matches = findMatches(entry.text, q);
    out.push({ entry, parts: snippet(entry.text, matches), count: matches.length });
  }
  return out;
}
