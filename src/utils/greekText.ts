/**
 * Placeholder bars for text too small to read (REQ-CANVAS-051).
 *
 * Far zoomed out, a 16 px line is 2-3 px tall. Instead of mounting the block's
 * HTML, the canvas draws one bar per line of text, heavier for headings. The
 * bars come from the markdown source alone: no layout, no DOM.
 */

/** Weight of a body bar and of a heading bar (picks the fill alpha). */
export const WEIGHT_BODY = 1;
export const WEIGHT_HEADING = 2;

const MAX_ROWS = 200;
const INDENT = 14;
const CHAR_WIDTH = 0.5;
const CACHE_LIMIT = 2000;

const cache = new Map<string, number[]>();

interface Row {
  indent: number;
  chars: number;
  heading: boolean;
}

function rowsOf(text: string): { indent: number; chars: number; heading: boolean }[] {
  const out: Row[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) continue;
    if (/^\|?[\s:|-]+\|?$/.test(t) && t.includes('-')) continue;
    const heading = /^#{1,6}(\s|$)/.test(t);
    let indent = 0;
    let body = t;
    if (heading) {
      body = t.replace(/^#{1,6}\s*/, '');
    } else {
      const m = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (m) {
        indent = INDENT * Math.floor(m[1].replace(/\t/g, '  ').length / 2) + INDENT;
        body = m[2].replace(/^\[[ xX]\]\s*/, '');
      }
    }
    out.push({ indent, chars: Math.max(1, body.length), heading });
  }
  return out;
}

/**
 * Flat [x, y, w, h, weight, ...] bars in the block's own coordinates:
 * one per wrapped row, spread evenly over the block's height.
 */
export function greekBars(text: string, fontSize: number, width: number, height: number): number[] {
  if (!text || !text.trim() || width <= 0 || height <= 0) return [];
  const key = `${fontSize}|${width}|${height}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const charW = fontSize * CHAR_WIDTH;
  const rows: { x: number; w: number; weight: number }[] = [];
  outer: for (const line of rowsOf(text)) {
    const avail = Math.max(charW * 4, width - line.indent);
    const perRow = Math.max(1, Math.floor(avail / charW));
    const n = Math.ceil(line.chars / perRow);
    for (let i = 0; i < n; i++) {
      if (rows.length >= MAX_ROWS) break outer;
      const last = i === n - 1;
      const w = last ? Math.max(charW * 2, Math.min(avail * 0.96, (line.chars - perRow * i) * charW)) : avail * 0.96;
      rows.push({ x: line.indent, w, weight: line.heading ? WEIGHT_HEADING : WEIGHT_BODY });
    }
  }
  const bars: number[] = [];
  if (rows.length) {
    const pitch = height / rows.length;
    rows.forEach((r, i) => {
      const h = Math.min(pitch * 0.5, fontSize * 0.55) * (r.weight === WEIGHT_HEADING ? 1.4 : 1);
      bars.push(r.x, i * pitch + (pitch - h) / 2, r.w, h, r.weight);
    });
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, bars);
  return bars;
}

/** Is this fill light enough that the text on it is light too? */
export function isLightFill(fill: string | undefined): boolean {
  if (!fill) return false;
  let hex = fill.trim().replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}/.test(hex)) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

/** Konva scene function for the "text-greek" shape: one fill per weight. */
export function greekSceneFunc(ctx: unknown, shape: { getAttr(name: string): unknown }): void {
  const bars = shape.getAttr('bars') as number[] | undefined;
  if (!bars || !bars.length) return;
  const c = (ctx as { _context: CanvasRenderingContext2D })._context;
  const rgb = shape.getAttr('light') ? '255,255,255' : '20,24,26';
  for (const weight of [WEIGHT_BODY, WEIGHT_HEADING]) {
    c.fillStyle = `rgba(${rgb},${weight === WEIGHT_HEADING ? 0.55 : 0.28})`;
    c.beginPath();
    let any = false;
    for (let i = 0; i + 4 < bars.length; i += 5) {
      if (bars[i + 4] !== weight) continue;
      c.rect(bars[i], bars[i + 1], bars[i + 2], bars[i + 3]);
      any = true;
    }
    if (any) c.fill();
  }
}
