import { Fragment } from 'react';
import { Line } from 'react-konva';

export interface SnapLine {
  type: 'vertical' | 'horizontal';
  position: number;
  start: number;
  end: number;
}

/** A dashed measurement of one or two matching empty spaces. */
export interface GapGuide {
  kind: 'gap';
  axis: 'x' | 'y';
  position: number;
  gaps: { start: number; end: number }[];
}

export type SnapGuide = SnapLine | GapGuide;

export function SnapGuides({ lines }: { lines: SnapGuide[] }) {
  return <>
    {lines.map((line, i) => {
      if ('kind' in line) {
        return <Fragment key={i}>{line.gaps.map((gap, gapIndex) => {
          const tick = 6;
          const horizontal = line.axis === 'x';
          return <Fragment key={gapIndex}>
            <Line points={horizontal ? [gap.start, line.position, gap.end, line.position] : [line.position, gap.start, line.position, gap.end]} stroke="#f43f5e" strokeWidth={1} dash={[4, 4]} listening={false} />
            <Line points={horizontal ? [gap.start, line.position - tick, gap.start, line.position + tick] : [line.position - tick, gap.start, line.position + tick, gap.start]} stroke="#f43f5e" strokeWidth={1} listening={false} />
            <Line points={horizontal ? [gap.end, line.position - tick, gap.end, line.position + tick] : [line.position - tick, gap.end, line.position + tick, gap.end]} stroke="#f43f5e" strokeWidth={1} listening={false} />
          </Fragment>;
        })}</Fragment>;
      }
      return <Line key={i} points={line.type === 'vertical' ? [line.position, line.start - 20, line.position, line.end + 20] : [line.start - 20, line.position, line.end + 20, line.position]} stroke="#f43f5e" strokeWidth={1} dash={[4, 4]} listening={false} />;
    })}
  </>;
}

/** Snap distance in screen pixels. Divide by zoom before comparing canvas units. */
export const SNAP_THRESHOLD = 8;

export interface SnapNodeBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  excludeIds?: string[];
}

interface NodeBounds {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

function getNodeBounds(node: SnapNodeBounds): NodeBounds {
  const width = Math.abs(node.width);
  const height = Math.abs(node.height || 30);
  const left = Math.min(node.x, node.x + node.width);
  const top = Math.min(node.y, node.y + (node.height || 30));
  return { id: node.id, left, right: left + width, top, bottom: top + height, centerX: left + width / 2, centerY: top + height / 2 };
}

export interface SnapResult {
  x: number;
  y: number;
  lines: SnapGuide[];
}

interface AxisCandidate {
  offset: number;
  distance: number;
  guide: SnapGuide;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function gapCandidates(dragged: NodeBounds, others: NodeBounds[], axis: 'x' | 'y'): AxisCandidate[] {
  const horizontal = axis === 'x';
  const start = horizontal ? 'left' : 'top';
  const end = horizontal ? 'right' : 'bottom';
  const crossStart = horizontal ? 'top' : 'left';
  const crossEnd = horizontal ? 'bottom' : 'right';
  const size = horizontal ? dragged.right - dragged.left : dragged.bottom - dragged.top;
  const draggedStart = horizontal ? dragged.left : dragged.top;
  const relevant = others
    .filter((other) => overlaps(dragged[crossStart], dragged[crossEnd], other[crossStart], other[crossEnd]))
    .sort((a, b) => a[start] - b[start]);
  const candidates: AxisCandidate[] = [];

  for (let index = 0; index + 1 < relevant.length; index += 1) {
    const first = relevant[index];
    const second = relevant[index + 1];
    const gap = second[start] - first[end];
    if (gap <= 0) continue;
    const position = (Math.max(first[crossStart], second[crossStart], dragged[crossStart]) + Math.min(first[crossEnd], second[crossEnd], dragged[crossEnd])) / 2;
    const guide = (gaps: { start: number; end: number }[]): GapGuide => ({ kind: 'gap', axis, position, gaps });

    if (gap > size) {
      const target = first[end] + (gap - size) / 2;
      candidates.push({ offset: target - draggedStart, distance: Math.abs(target - draggedStart), guide: guide([{ start: first[end], end: second[start] }]) });
    }

    const rightTarget = second[end] + gap;
    candidates.push({
      offset: rightTarget - draggedStart,
      distance: Math.abs(rightTarget - draggedStart),
      guide: guide([{ start: first[end], end: second[start] }, { start: second[end], end: rightTarget }]),
    });
    const leftTarget = first[start] - gap - size;
    candidates.push({
      offset: leftTarget - draggedStart,
      distance: Math.abs(leftTarget - draggedStart),
      guide: guide([{ start: leftTarget + size, end: first[start] }, { start: first[end], end: second[start] }]),
    });
  }
  return candidates;
}

/** Point snaps win ties over equal-gap candidates. */
export function calculateSnap(draggedNode: SnapNodeBounds, allNodes: SnapNodeBounds[], threshold = SNAP_THRESHOLD): SnapResult {
  const dragged = getNodeBounds(draggedNode);
  const excluded = new Set([draggedNode.id, ...(draggedNode.excludeIds ?? [])]);
  const others = allNodes.filter((node) => !excluded.has(node.id)).map(getNodeBounds);
  if (others.length === 0) return { x: draggedNode.x, y: draggedNode.y, lines: [] };

  const snapAxis = (axis: 'x' | 'y'): AxisCandidate | null => {
    const horizontal = axis === 'x';
    const draggedEdges = horizontal ? [dragged.left, dragged.centerX, dragged.right] : [dragged.top, dragged.centerY, dragged.bottom];
    let best: AxisCandidate | null = null;
    for (const other of others) {
      const otherEdges = horizontal ? [other.left, other.centerX, other.right] : [other.top, other.centerY, other.bottom];
      for (const dragEdge of draggedEdges) for (const otherEdge of otherEdges) {
        const distance = Math.abs(dragEdge - otherEdge);
        if (!best || distance < best.distance) {
          const crossStart = horizontal ? Math.min(dragged.top, other.top) : Math.min(dragged.left, other.left);
          const crossEnd = horizontal ? Math.max(dragged.bottom, other.bottom) : Math.max(dragged.right, other.right);
          best = {
            offset: otherEdge - dragEdge,
            distance,
            guide: horizontal
              ? { type: 'vertical', position: otherEdge, start: crossStart, end: crossEnd }
              : { type: 'horizontal', position: otherEdge, start: crossStart, end: crossEnd },
          };
        }
      }
    }
    for (const candidate of gapCandidates(dragged, others, axis)) {
      if (!best || candidate.distance < best.distance) best = candidate;
    }
    return best && best.distance <= threshold ? best : null;
  };

  const xSnap = snapAxis('x');
  const ySnap = snapAxis('y');
  return {
    x: draggedNode.x + (xSnap?.offset ?? 0),
    y: draggedNode.y + (ySnap?.offset ?? 0),
    lines: [xSnap?.guide, ySnap?.guide].filter((guide): guide is SnapGuide => !!guide),
  };
}

/** The single object-snap gate: Shift places freely and the setting disables it. */
export function calculateObjectSnap(
  draggedNode: SnapNodeBounds,
  allNodes: SnapNodeBounds[],
  options: { snapToObjects: boolean; shiftKey: boolean; viewportScale: number },
): SnapResult {
  if (!options.snapToObjects || options.shiftKey) return { x: draggedNode.x, y: draggedNode.y, lines: [] };
  return calculateSnap(draggedNode, allNodes, SNAP_THRESHOLD / Math.max(options.viewportScale, 0.1));
}

/** How close a node must come to a scroll's edge before the magnet takes it. */
export const SCROLL_SNAP_THRESHOLD = 14;

/** Magnetic snap to scroll-band edges, independent of the object-snap setting. */
export function calculateScrollSnap(
  dragged: { x: number; y: number; width: number },
  columnLeftOf: (column: number) => number,
  columnWidth: number | ((column: number) => number),
  columnCount: number,
  threshold = SCROLL_SNAP_THRESHOLD,
): { x: number; line: SnapLine | null } {
  if (threshold <= 0 || columnCount <= 0) return { x: dragged.x, line: null };
  const width = Math.abs(dragged.width);
  const widthOf = typeof columnWidth === 'function' ? columnWidth : () => columnWidth;
  let best: { x: number; at: number } | null = null;
  for (let column = 0; column < columnCount; column += 1) {
    const left = columnLeftOf(column);
    const right = left + widthOf(column);
    const leftGap = Math.abs(dragged.x - left);
    if (leftGap <= threshold && (!best || leftGap < Math.abs(best.x - dragged.x))) best = { x: left, at: left };
    const rightGap = Math.abs(dragged.x + width - right);
    if (rightGap <= threshold && (!best || rightGap < Math.abs(best.x - dragged.x))) best = { x: right - width, at: right };
  }
  return best
    ? { x: best.x, line: { type: 'vertical', position: best.at, start: dragged.y - 400, end: dragged.y + 400 } }
    : { x: dragged.x, line: null };
}
