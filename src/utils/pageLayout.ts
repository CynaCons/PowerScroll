/**
 * Shared page geometry + text sizing constants.
 * Keep in sync with visual A4 guides on the canvas (96 DPI).
 */

/** A4 width at 96 DPI */
export const A4_WIDTH = 794;

/** User/agent scroll resize bounds. Kept here so every entry point agrees. */
export const MIN_SCROLL_WIDTH = 320;
export const MAX_SCROLL_WIDTH = 2400;

/** A4 height at 96 DPI */
export const A4_HEIGHT = 1123;

/** Gap between adjacent page cells */
export const PAGE_GAP = 40;

/** Left/top inset for the first page guide (visual only) */
export const PAGE_MARGIN = 60;

/** Blank pages kept below the last occupied one in scroll mode. */
export const SCROLL_HEADROOM_PAGES = 1;

/**
 * Length of the darker end-cap drawn at each end of a scroll page separator.
 * They read as a fold rather than a stray rule across the sheet.
 */
export const SCROLL_SEPARATOR_TICK = 12;

/**
 * Height reserved at the top of a scroll for its title header.
 *
 * Sized to clear BLOCK_TOP_INSET (48) so the header sits above the first block
 * of an existing notebook rather than on top of it — naming a scroll never
 * moves content that is already there.
 */
export const SCROLL_HEADER_HEIGHT = 40;

/** A scroll record's width contribution to the band test. */
export interface BandWidthSource {
  column: number;
  width?: number;
}

function hasCustomBandWidths(scrolls?: readonly BandWidthSource[]): boolean {
  return !!scrolls?.some((s) => typeof s.width === 'number' && s.width > 0 && s.width !== A4_WIDTH);
}

/** Width of a column band. Absent / default records are one A4 sheet. */
export function columnWidth(column: number, scrolls?: readonly BandWidthSource[]): number {
  if (!scrolls) return A4_WIDTH;
  const record = scrolls.find((s) => s.column === column);
  return record?.width && record.width > 0 ? record.width : A4_WIDTH;
}

/** Left edge of a column band. 0 is the leftmost. */
export function columnLeft(column: number, scrolls?: readonly BandWidthSource[]): number {
  if (!hasCustomBandWidths(scrolls)) {
    return PAGE_MARGIN + column * (A4_WIDTH + PAGE_GAP);
  }
  if (column === 0) return PAGE_MARGIN;
  if (column > 0) {
    let x = PAGE_MARGIN;
    for (let c = 0; c < column; c++) x += columnWidth(c, scrolls) + PAGE_GAP;
    return x;
  }
  let x = PAGE_MARGIN;
  for (let c = 0; c > column; c--) x -= columnWidth(c - 1, scrolls) + PAGE_GAP;
  return x;
}

/**
 * Which column band an x coordinate falls in.
 *
 * The single definition of a band boundary — page guides, block layout and
 * scroll membership all resolve through this, so they cannot drift apart.
 * When a scroll has been explicitly widened, pass the page's records so the
 * gap after that band still belongs to it (same rule as the uniform pitch).
 */
export function columnAt(x: number, scrolls?: readonly BandWidthSource[]): number {
  if (!hasCustomBandWidths(scrolls)) {
    return Math.floor((x - PAGE_MARGIN) / (A4_WIDTH + PAGE_GAP));
  }
  const list = scrolls!;
  if (x < PAGE_MARGIN) {
    const pitch = columnWidth(0, list) + PAGE_GAP;
    return Math.floor((x - PAGE_MARGIN) / pitch);
  }
  const maxCol = list.reduce((m, s) => Math.max(m, s.column), 0);
  let left = PAGE_MARGIN;
  for (let c = 0; c <= maxCol; c++) {
    const pitch = columnWidth(c, list) + PAGE_GAP;
    if (x < left + pitch) return c;
    left += pitch;
  }
  return maxCol + 1 + Math.floor((x - left) / (A4_WIDTH + PAGE_GAP));
}

/** Default width for newly placed text blocks (= one page) */
export const DEFAULT_TEXT_WIDTH = A4_WIDTH;

/** Minimum text block width (resize floor) */
export const MIN_TEXT_WIDTH = 60;

/** Soft maximum text block width (resize ceiling; not a product page max) */
export const MAX_TEXT_WIDTH = 5000;

/** Minimum text block height after content measure */
export const MIN_TEXT_HEIGHT = 24;

/** Canvas y of the scroll header's resting row. */
export const SCROLL_TITLE_RESTING_Y = 12;
/** Gap retained by scrollTitleY for callers which position a held header. */
export const SCROLL_TITLE_PIN_INSET = 10;

/** Resting headers are document headings in canvas units. */
export const SCROLL_TITLE_RESTING_HEIGHT = 34;
export const SCROLL_TITLE_RESTING_FONT_SIZE = 24;
export const SCROLL_TITLE_RESTING_FONT_STYLE = '700';
export const SCROLL_TITLE_RESTING_LETTER_SPACING = -0.015;
/** Held headers are screen-constant so they remain legible at every zoom. */
export const SCROLL_TITLE_HELD_HEIGHT_SCREEN = 32;
export const SCROLL_TITLE_HELD_FONT_SIZE_SCREEN = 15;
export const SCROLL_TITLE_HELD_FONT_STYLE = '600';
export const SCROLL_TITLE_HELD_FADE_SCREEN_HEIGHT = 22;
export const SCROLL_TITLE_PROGRESS_SCREEN_HEIGHT = 2;
/** Compatibility exports for external callers that still import the v0.62 names. */
export const SCROLL_TITLE_PINNED_FONT_SIZE = SCROLL_TITLE_HELD_FONT_SIZE_SCREEN;
export const SCROLL_TITLE_FONT_STYLE = SCROLL_TITLE_HELD_FONT_STYLE;
export const SCROLL_TITLE_PINNED_STRIP_HEIGHT = SCROLL_TITLE_HELD_HEIGHT_SCREEN;
export const SCROLL_TITLE_INK = '#14181A';
export const SCROLL_TITLE_HELD_FILL = '#FFFFFF';
export const SCROLL_TITLE_PINNED_FILL = SCROLL_TITLE_HELD_FILL;
export const SCROLL_TITLE_PINNED_OPACITY = 1;
export const SCROLL_TITLE_HAIRLINE = '#C3CBC9';
export const SCROLL_TITLE_HAIRLINE_WIDTH = 1;
/** Active-scroll mark on the bar. INK, never ACCENT. */
export const SCROLL_TITLE_ACTIVE_TICK = 2;

/**
 * Where a scroll title should draw, given where the viewport is (v0.35).
 *
 * At rest it sits at the top of the band. Once the viewport scrolls past that,
 * the title holds just below the top edge instead, so you never lose track of
 * which column you are reading — a frozen header row, in canvas coordinates.
 *
 * Pure so the behaviour is testable without a stage: the component only feeds
 * it the viewport.
 */
export function scrollTitleY(
  viewport: { y: number; scale: number },
  ceiling?: number | null,
): {
  y: number;
  holding: boolean;
} {
  const viewportTop = -viewport.y / (viewport.scale || 1);
  // At rest the header TOP is the ceiling row itself (T150) — including a
  // negative ceiling over legacy content, which a clamp would bury. Without a
  // ceiling the pre-existing 12-unit inset applies.
  const restRow = ceiling ?? SCROLL_TITLE_RESTING_Y;
  if (ceiling != null) {
    if (viewportTop > restRow) {
      return { y: viewportTop + SCROLL_TITLE_PIN_INSET, holding: true };
    }
    return { y: restRow, holding: false };
  }
  const y = Math.max(restRow, viewportTop + SCROLL_TITLE_PIN_INSET);
  return { y, holding: y > restRow + 0.5 };
}
