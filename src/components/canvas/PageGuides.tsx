import { Rect, Line, Group, Text } from 'react-konva';
import type { BackgroundMode, CanvasNode, ScrollRecord } from '../../types/data';
import {
  A4_WIDTH,
  A4_HEIGHT,
  PAGE_GAP,
  PAGE_MARGIN as MARGIN,
  SCROLL_HEADROOM_PAGES,
  columnAt,
  columnLeft,
  columnWidth,
} from '../../utils/pageLayout';

export type { BackgroundMode };

// Grid mode spacing
const GRID_SPACING = 100;
const GRID_EXTENT = 5000; // how far grid lines extend

// Scroll mode: pages stacked with no vertical gap, so the column reads as one
// continuous sheet and a page boundary is just a rule across it. Geometry lives
// in pageLayout so the guides and the bridge measure from the same numbers.

interface PageGuidesProps {
  mode: BackgroundMode;
  nodes: CanvasNode[];
  scrolls?: ScrollRecord[];
  viewportScale?: number;
}

/**
 * Calculate which page cells are occupied by content.
 * Returns a set of "col,row" keys for pages that should be rendered.
 */
function getOccupiedPages(nodes: CanvasNode[]): Set<string> {
  const occupied = new Set<string>();
  // Always show the first page (0,0)
  occupied.add('0,0');

  for (const node of nodes) {
    // Which page columns/rows does this node touch?
    const colStart = Math.floor((node.x - MARGIN) / (A4_WIDTH + PAGE_GAP));
    const colEnd = Math.floor((node.x + (node.width || 200) - MARGIN) / (A4_WIDTH + PAGE_GAP));
    const rowStart = Math.floor(node.y / (A4_HEIGHT + PAGE_GAP));
    const rowEnd = Math.floor((node.y + (node.height || 30)) / (A4_HEIGHT + PAGE_GAP));

    for (let c = Math.min(colStart, 0); c <= Math.max(colEnd, 0); c++) {
      for (let r = Math.min(rowStart, 0); r <= Math.max(rowEnd, 0); r++) {
        occupied.add(`${c},${r}`);
      }
    }
  }

  // Also add adjacent pages (one step in each direction from occupied)
  const withAdjacent = new Set(occupied);
  for (const key of occupied) {
    const [c, r] = key.split(',').map(Number);
    withAdjacent.add(`${c},${r - 1}`);
    withAdjacent.add(`${c},${r + 1}`);
    withAdjacent.add(`${c - 1},${r}`);
    withAdjacent.add(`${c + 1},${r}`);
  }

  return withAdjacent;
}

function renderPages(nodes: CanvasNode[], scrolls?: ScrollRecord[]) {
  const occupied = getOccupiedPages(nodes);
  const elements: JSX.Element[] = [];

  for (const key of occupied) {
    const [col, row] = key.split(',').map(Number);
    const x = columnLeft(col, scrolls);
    const w = columnWidth(col, scrolls);
    const y = row * (A4_HEIGHT + PAGE_GAP);

    elements.push(
      <Rect
        key={`page-bg-${key}`}
        name="page-sheet"
        x={x}
        y={y}
        width={w}
        height={A4_HEIGHT}
        fill="#ffffff"
        shadowColor="rgba(0,0,0,0.08)"
        shadowBlur={8}
        shadowOffsetY={2}
        cornerRadius={2}
        listening={false}
      />,
    );

    // Dashed border
    const pts = [
      { id: 'top', points: [x, y, x + w, y] },
      { id: 'bottom', points: [x, y + A4_HEIGHT, x + w, y + A4_HEIGHT] },
      { id: 'left', points: [x, y, x, y + A4_HEIGHT] },
      { id: 'right', points: [x + w, y, x + w, y + A4_HEIGHT] },
    ];

    for (const { id, points } of pts) {
      elements.push(
        <Line
          key={`page-${id}-${key}`}
          points={points}
          stroke="#d4d4d4"
          strokeWidth={0.5}
          dash={[6, 4]}
          listening={false}
        />,
      );
    }
  }

  return elements;
}

/**
 * Vertical + horizontal extent of the scroll, in whole pages.
 *
 * Columns still sit `A4_WIDTH + PAGE_GAP` apart — scroll only removes the gap
 * BETWEEN stacked pages, so a multi-column page keeps its existing layout and
 * each column becomes its own scroll.
 */
export function scrollPageRange(nodes: CanvasNode[], scrolls?: ScrollRecord[]) {
  const columns = new Set<number>([0]);
  let minY = 0;
  let maxY = 0;

  for (const node of nodes) {
    const colStart = columnAt(node.x, scrolls);
    const colEnd = columnAt(node.x + (node.width || 200), scrolls);
    for (let c = colStart; c <= colEnd; c++) columns.add(c);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y + (node.height || 30));
  }

  return {
    columns,
    firstRow: Math.floor(minY / A4_HEIGHT),
    lastRow: Math.floor(maxY / A4_HEIGHT) + SCROLL_HEADROOM_PAGES,
  };
}

function renderScroll(nodes: CanvasNode[], scrolls?: ScrollRecord[], viewportScale = 1) {
  const { columns, firstRow, lastRow } = scrollPageRange(nodes, scrolls);
  const elements: JSX.Element[] = [];

  for (const col of columns) {
    const x = columnLeft(col, scrolls);
    const w = columnWidth(col, scrolls);
    for (let row = firstRow; row <= lastRow; row++) {
      const topInset = row === firstRow ? 0 : 8;
      const bottomInset = row === lastRow ? 0 : 8;
      const y = row * A4_HEIGHT + topInset;
      const h = A4_HEIGHT - topInset - bottomInset;
      elements.push(
        <Rect
          key={`scroll-sheet-${col}-${row}`}
          name="scroll-sheet"
          x={x}
          y={y}
          width={w}
          height={h}
          fill="#ffffff"
          shadowColor="rgba(0,0,0,0.08)"
          shadowBlur={8}
          shadowOffsetY={2}
          cornerRadius={[topInset ? 6 : 2, topInset ? 6 : 2, bottomInset ? 6 : 2, bottomInset ? 6 : 2]}
          listening={false}
        />,
        <Rect
          key={`scroll-border-${col}-${row}`}
          x={x}
          y={y}
          width={w}
          height={h}
          stroke="#d4d4d4"
          strokeWidth={0.5}
          dash={[6, 4]}
          cornerRadius={[topInset ? 6 : 2, topInset ? 6 : 2, bottomInset ? 6 : 2, bottomInset ? 6 : 2]}
          listening={false}
        />,
      );
      if (row > firstRow) {
        const gapY = row * A4_HEIGHT - 8;
        const pageNumberSize = Math.min(36, 11 / Math.max(viewportScale, 0.1));
        elements.push(
          <Rect key={`scroll-gap-${col}-${row}`} name="scroll-sheet-gap" x={x} y={gapY} width={w} height={16} fill="rgba(0,0,0,0)" listening={false} />,
          ...(viewportScale >= 0.3 ? [<Text key={`scroll-page-${col}-${row}`} name="scroll-page-number" x={x} y={gapY + (16 - pageNumberSize) / 2} width={w} text={String(row - firstRow + 1)} align="center" fontSize={pageNumberSize} fontFamily="ui-monospace, Consolas, monospace" fill="#5C6467" listening={false} />] : []),
        );
      }
    }
  }

  return elements;
}

function renderGrid() {
  const elements: JSX.Element[] = [];
  const start = -GRID_EXTENT;
  const end = GRID_EXTENT;

  // Vertical lines
  for (let x = start; x <= end; x += GRID_SPACING) {
    const isMajor = x % (GRID_SPACING * 5) === 0;
    elements.push(
      <Line
        key={`grid-v-${x}`}
        points={[x, start, x, end]}
        stroke={isMajor ? '#c8c8c8' : '#dedede'}
        strokeWidth={isMajor ? 1 : 0.5}
        dash={isMajor ? undefined : [4, 6]}
        listening={false}
      />,
    );
  }

  // Horizontal lines
  for (let y = start; y <= end; y += GRID_SPACING) {
    const isMajor = y % (GRID_SPACING * 5) === 0;
    elements.push(
      <Line
        key={`grid-h-${y}`}
        points={[start, y, end, y]}
        stroke={isMajor ? '#c8c8c8' : '#dedede'}
        strokeWidth={isMajor ? 1 : 0.5}
        dash={isMajor ? undefined : [4, 6]}
        listening={false}
      />,
    );
  }

  return elements;
}

export function PageGuides({ mode, nodes, scrolls, viewportScale }: PageGuidesProps) {
  if (mode === 'none') return null;
  if (mode === 'grid') return <Group listening={false}>{renderGrid()}</Group>;
  if (mode === 'scroll') return <Group listening={false}>{renderScroll(nodes, scrolls, viewportScale)}</Group>;
  return <Group listening={false}>{renderPages(nodes, scrolls)}</Group>;
}
