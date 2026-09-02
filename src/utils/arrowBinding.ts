import type { CanvasNode, ShapeNodeData } from '../types/data';

export const BINDING_DISTANCE = 12;

export interface Point { x: number; y: number; }

function rotationFor(node: CanvasNode): number {
  const data = node.data as { rotation?: number };
  return data.rotation ?? 0;
}

function rotate(point: Point, centre: Point, degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - centre.x;
  const y = point.y - centre.y;
  return { x: centre.x + x * cos - y * sin, y: centre.y + x * sin + y * cos };
}

function centre(node: CanvasNode): Point {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function unrotatePoint(node: CanvasNode, point: Point): Point {
  return rotate(point, centre(node), -rotationFor(node));
}

function shapeType(node: CanvasNode): string | undefined {
  return node.type === 'shape' ? (node.data as ShapeNodeData).shapeType : undefined;
}

export function isBindableNode(node: CanvasNode): boolean {
  if (node.type === 'image' || node.type === 'text') return true;
  const type = shapeType(node);
  return type === 'rect' || type === 'circle' || type === 'triangle' || type === 'diamond';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function closestOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1);
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function distanceSq(a: Point, b: Point): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  return x * x + y * y;
}

function localContains(node: CanvasNode, point: Point): boolean {
  const x = point.x - node.x;
  const y = point.y - node.y;
  const w = node.width;
  const h = node.height;
  const kind = shapeType(node);
  if (!kind || kind === 'rect' || node.type === 'image' || node.type === 'text') return x >= 0 && x <= w && y >= 0 && y <= h;
  if (kind === 'circle') {
    const rx = w / 2, ry = h / 2;
    return rx > 0 && ry > 0 && ((x - rx) / rx) ** 2 + ((y - ry) / ry) ** 2 <= 1;
  }
  if (kind === 'diamond') return Math.abs(x - w / 2) / (w / 2) + Math.abs(y - h / 2) / (h / 2) <= 1;
  // Triangle vertices: top, bottom-right, bottom-left.
  return y >= 0 && y <= h && y >= 2 * Math.abs(x - w / 2) - h;
}

/** The closest outline point, with the node's visual rotation taken into account. */
export function closestPointOnOutline(node: CanvasNode, point: Point): Point {
  const p = unrotatePoint(node, point);
  const x0 = node.x, y0 = node.y, w = node.width, h = node.height;
  const kind = shapeType(node);
  let local: Point;
  if (kind === 'circle') {
    const cx = x0 + w / 2, cy = y0 + h / 2;
    const dx = p.x - cx, dy = p.y - cy;
    const rx = Math.max(w / 2, 0.0001), ry = Math.max(h / 2, 0.0001);
    const scale = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2 || 1);
    local = { x: cx + dx * scale, y: cy + dy * scale };
  } else if (kind === 'triangle' || kind === 'diamond') {
    const vertices = kind === 'triangle'
      ? [{ x: x0 + w / 2, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }]
      : [{ x: x0 + w / 2, y: y0 }, { x: x0 + w, y: y0 + h / 2 }, { x: x0 + w / 2, y: y0 + h }, { x: x0, y: y0 + h / 2 }];
    const candidates = vertices.map((a, i) => closestOnSegment(p, a, vertices[(i + 1) % vertices.length]));
    local = candidates.reduce((best, candidate) => distanceSq(candidate, p) < distanceSq(best, p) ? candidate : best);
  } else {
    const inside = localContains(node, p);
    if (inside) {
      const candidates = [
        { x: x0, y: p.y }, { x: x0 + w, y: p.y }, { x: p.x, y: y0 }, { x: p.x, y: y0 + h },
      ];
      local = candidates.reduce((best, candidate) => distanceSq(candidate, p) < distanceSq(best, p) ? candidate : best);
    } else {
      local = { x: clamp(p.x, x0, x0 + w), y: clamp(p.y, y0, y0 + h) };
    }
  }
  return rotate(local, centre(node), rotationFor(node));
}

export function fixedPointFor(node: CanvasNode, point: Point): [number, number] {
  const p = unrotatePoint(node, point);
  return [
    node.width ? (p.x - node.x) / node.width : 0.5,
    node.height ? (p.y - node.y) / node.height : 0.5,
  ];
}

export function anchorFor(node: CanvasNode, fixedPoint: [number, number]): Point {
  return rotate({ x: node.x + node.width * fixedPoint[0], y: node.y + node.height * fixedPoint[1] }, centre(node), rotationFor(node));
}

export function bindingCandidate(nodes: CanvasNode[], point: Point, excludedId?: string, distance = BINDING_DISTANCE): CanvasNode | null {
  const candidates = nodes.filter((node) => node.id !== excludedId && isBindableNode(node)).map((node) => {
    const outline = closestPointOnOutline(node, point);
    return { node, outline, distanceSq: distanceSq(outline, point), inside: localContains(node, unrotatePoint(node, point)) };
  }).filter(({ distanceSq: d, inside }) => inside || d <= distance * distance);
  candidates.sort((a, b) => (a.node.width * a.node.height) - (b.node.width * b.node.height) || a.distanceSq - b.distanceSq);
  return candidates[0]?.node ?? null;
}

/** Recalculate the endpoints of arrows bound to any changed target. */
export function recomputeBoundArrows(nodes: CanvasNode[], changedIds: Iterable<string>): CanvasNode[] {
  const changed = new Set(changedIds);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.filter((node) => {
    const data = node.data as ShapeNodeData;
    return node.type === 'shape' && (data.shapeType === 'arrow' || data.shapeType === 'line')
      && (!!data.startBinding && changed.has(data.startBinding.elementId) || !!data.endBinding && changed.has(data.endBinding.elementId));
  }).map((arrow) => {
    const data = arrow.data as ShapeNodeData;
    const start = data.startBinding && byId.get(data.startBinding.elementId)
      ? anchorFor(byId.get(data.startBinding.elementId)!, data.startBinding.fixedPoint) : { x: arrow.x, y: arrow.y };
    const end = data.endBinding && byId.get(data.endBinding.elementId)
      ? anchorFor(byId.get(data.endBinding.elementId)!, data.endBinding.fixedPoint) : { x: arrow.x + arrow.width, y: arrow.y + arrow.height };
    return { ...arrow, x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
  });
}
