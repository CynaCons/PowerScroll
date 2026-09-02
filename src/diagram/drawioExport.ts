/**
 * Reverse of `transpileDrawio`: canvas members out as an mxfile.
 *
 * Two tiers, chosen by comparison rather than a dirty flag:
 *
 *   1. Verbatim — the target is a diagram frame whose stored source sniffs as
 *      draw.io, and re-transpiling that source reproduces the current members
 *      (same count, geometry within 0.5px, same fills/strokes). The stored XML
 *      is returned unchanged. Trivially lossless.
 *   2. Mapped — everything else (an edited import, a PlantUML/Mermaid/SVG
 *      frame, a plain Ctrl+G group). Each member is reverse-mapped into a
 *      well-formed `<mxfile><diagram><mxGraphModel>` document. Geometry is
 *      translated so the export's origin is (0, 0). Edges are floating
 *      (explicit `mxPoint`s, no source/target) because reconnecting would
 *      re-clip them and break the closure contract.
 *
 * Arc fallback: PowerScroll's `arc` is a stroked half-circle (UML socket).
 * draw.io's stencil sets include `shape=mxgraph.basic.arc` and a mockup
 * `shape=arc`, but those only render when the matching library is loaded — a
 * file that uses them opens as an empty box in a vanilla mxGraph viewer.
 * `ellipse` + `fillColor=none` is a built-in every diagrams.net / mxGraph
 * reader already understands. The cup is lost (a full ring instead of a
 * half-circle) and that loss is named in `report`. We do not write `shape=arc`.
 *
 * Never throws: a canvas that has to keep working on a group it did not
 * author gets an empty-but-well-formed mxfile and a report, not an exception.
 */

import type { CanvasNode, DiagramNodeData, ShapeNodeData, TextNodeData } from '../types/data';
import { diagramMembers, diagramSourceOf, FRAME_PAD, FRAME_TITLE_H } from './canvasOps';
import { transpileDrawio } from './drawio';

export interface ExportDrawioResult {
  xml: string;
  report: string[];
}

const GEOM_TOL = 0.5;

const ARC_REPORT =
  'arc shapes have no portable draw.io built-in; exported as an ellipse placeholder';

/** Same first test as `sniffFormat` — kept local so this file does not import `index`. */
function looksLikeDrawio(source: string): boolean {
  return /<mxfile[\s>]|<mxGraphModel[\s>]/i.test(source);
}

interface Pt {
  x: number;
  y: number;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ── Public entry ────────────────────────────────────────────

export function exportDrawio(frameOrGroupId: string, nodes: CanvasNode[]): ExportDrawioResult {
  try {
    return exportDrawioInner(frameOrGroupId, nodes);
  } catch (err) {
    return {
      xml: emptyMxfile('Export'),
      report: [`Could not export: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

function exportDrawioInner(frameOrGroupId: string, nodes: CanvasNode[]): ExportDrawioResult {
  const members = diagramMembers(nodes, frameOrGroupId);
  const frame = nodes.find((n) => n.id === frameOrGroupId && n.type === 'diagram');

  if (frame) {
    const source = diagramSourceOf(frame);
    if (source && looksLikeDrawio(source)) {
      // Snapshot frame (v0.64): the stored source IS the diagram — there are
      // no members to compare, and falling through would export an empty
      // mxfile. Verbatim, always.
      if ((frame.data as DiagramNodeData | undefined)?.render != null) {
        const report =
          members.length > 0
            ? [
                `${members.length} loose node${members.length === 1 ? '' : 's'} inside the frame group ` +
                  'were not exported — the stored draw.io source is the diagram.',
              ]
            : [];
        return { xml: source, report };
      }
      if (matchesStoredSource(frame, members, source)) {
        return { xml: source, report: [] };
      }
    }
  }

  return mapMembers(members, exportTitle(frame));
}

function exportTitle(frame: CanvasNode | undefined): string {
  if (!frame) return 'Group';
  const title = (frame.data as DiagramNodeData | undefined)?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : 'Diagram';
}

// ── Verbatim detection ──────────────────────────────────────

/**
 * Re-transpile the stored source at the same origin `rebuildDiagram` used
 * when the frame was placed, then match each current member to a unique
 * rebuilt node. Order is not trusted — the store can be rearranged without
 * the drawing changing — so this is a multiset match, not a zip.
 */
function matchesStoredSource(frame: CanvasNode, members: CanvasNode[], source: string): boolean {
  const rebuilt = transpileDrawio(source, {
    groupId: frame.id,
    origin: { x: frame.x + FRAME_PAD, y: frame.y + FRAME_TITLE_H + FRAME_PAD },
  });
  return drawingsMatch(members, rebuilt.nodes);
}

function drawingsMatch(a: CanvasNode[], b: CanvasNode[]): boolean {
  if (a.length !== b.length) return false;
  const used = new Array(b.length).fill(false);
  for (const left of a) {
    const idx = b.findIndex((right, i) => !used[i] && sameMark(left, right));
    if (idx < 0) return false;
    used[idx] = true;
  }
  return true;
}

function sameMark(a: CanvasNode, b: CanvasNode): boolean {
  if (a.type !== b.type) return false;
  if (!near(a.x, b.x) || !near(a.y, b.y) || !near(a.width, b.width) || !near(a.height, b.height)) {
    return false;
  }
  if (a.type === 'shape' && b.type === 'shape') {
    const da = a.data as ShapeNodeData;
    const db = b.data as ShapeNodeData;
    return (
      da.shapeType === db.shapeType &&
      sameColour(da.fill, db.fill) &&
      sameColour(da.stroke, db.stroke) &&
      near(da.strokeWidth ?? 0, db.strokeWidth ?? 0) &&
      sameDash(da.strokeDash, db.strokeDash) &&
      near(da.cornerRadius ?? 0, db.cornerRadius ?? 0) &&
      near(da.rotation ?? 0, db.rotation ?? 0)
    );
  }
  if (a.type === 'text' && b.type === 'text') {
    const da = a.data as TextNodeData;
    const db = b.data as TextNodeData;
    return da.text === db.text && sameColour(da.fill, db.fill);
  }
  return false;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= GEOM_TOL;
}

function sameColour(a: string | undefined, b: string | undefined): boolean {
  return normColour(a) === normColour(b);
}

function normColour(c: string | undefined): string {
  if (c == null || c === '' || c === 'transparent' || c.toLowerCase() === 'none') return 'transparent';
  return c.trim().toLowerCase();
}

function sameDash(a: number[] | undefined, b: number[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((n, i) => near(n, right[i]));
}

// ── Mapped tier ─────────────────────────────────────────────

function mapMembers(members: CanvasNode[], title: string): ExportDrawioResult {
  const report: string[] = [];
  const note = (msg: string) => {
    if (!report.includes(msg)) report.push(msg);
  };

  const exportable: CanvasNode[] = [];
  for (const node of members) {
    if (node.type === 'shape' || node.type === 'text') {
      exportable.push(node);
      continue;
    }
    if (node.type === 'image') note('image nodes are not exported');
    else if (node.type === 'gantt') note('gantt nodes are not exported');
    else if (node.type === 'diagram') note('nested diagram frames are not exported');
    else note(`${node.type} nodes are not exported`);
  }

  if (exportable.some((n) => n.type === 'shape' && (n.data as ShapeNodeData).shapeType === 'arc')) {
    note(ARC_REPORT);
  }

  const origin = originOf(exportable);
  const cells: string[] = [];
  let nextId = 2;

  for (const node of exportable) {
    const cell = cellOf(node, origin, String(nextId));
    if (cell) {
      cells.push(cell);
      nextId += 1;
    } else {
      note(`a ${describe(node)} could not be mapped`);
    }
  }

  const extent = extentOf(exportable, origin);
  return { xml: wrapMxfile(title, cells, extent), report };
}

function describe(node: CanvasNode): string {
  if (node.type === 'shape') return (node.data as ShapeNodeData).shapeType ?? 'shape';
  return node.type;
}

function isLink(data: ShapeNodeData): boolean {
  return data.shapeType === 'line' || data.shapeType === 'arrow';
}

function originOf(nodes: CanvasNode[]): Pt {
  if (nodes.length === 0) return { x: 0, y: 0 };
  let minX = Infinity;
  let minY = Infinity;
  for (const n of nodes) {
    const b = boundsOf(n);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
  }
  return {
    x: Number.isFinite(minX) ? minX : 0,
    y: Number.isFinite(minY) ? minY : 0,
  };
}

function boundsOf(n: CanvasNode): Box {
  if (n.type === 'shape' && isLink(n.data as ShapeNodeData)) {
    const x2 = n.x + n.width;
    const y2 = n.y + n.height;
    return {
      minX: Math.min(n.x, x2),
      minY: Math.min(n.y, y2),
      maxX: Math.max(n.x, x2),
      maxY: Math.max(n.y, y2),
    };
  }
  return { minX: n.x, minY: n.y, maxX: n.x + n.width, maxY: n.y + n.height };
}

function extentOf(nodes: CanvasNode[], origin: Pt): { w: number; h: number } {
  if (nodes.length === 0) return { w: 160, h: 120 };
  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    const b = boundsOf(n);
    maxX = Math.max(maxX, b.maxX - origin.x);
    maxY = Math.max(maxY, b.maxY - origin.y);
  }
  return { w: Math.max(160, Math.ceil(maxX) + 40), h: Math.max(120, Math.ceil(maxY) + 40) };
}

function cellOf(node: CanvasNode, origin: Pt, id: string): string | null {
  if (node.type === 'text') return textCell(node, node.data as TextNodeData, origin, id);
  if (node.type !== 'shape') return null;
  const data = node.data as ShapeNodeData;
  if (!data || !data.shapeType) return null;
  if (isLink(data)) return edgeCell(node, data, origin, id);
  return vertexCell(node, data, origin, id);
}

function vertexCell(node: CanvasNode, data: ShapeNodeData, origin: Pt, id: string): string {
  const x = node.x - origin.x;
  const y = node.y - origin.y;
  const w = Math.abs(node.width);
  const h = Math.abs(node.height);
  const style = vertexStyle(data);
  return (
    `<mxCell id="${esc(id)}" value="" style="${esc(style)}" vertex="1" parent="1">` +
    `<mxGeometry x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" as="geometry"/>` +
    `</mxCell>`
  );
}

function edgeCell(node: CanvasNode, data: ShapeNodeData, origin: Pt, id: string): string {
  const a: Pt = { x: node.x - origin.x, y: node.y - origin.y };
  const b: Pt = { x: node.x + node.width - origin.x, y: node.y + node.height - origin.y };
  const style = edgeStyle(data);
  return (
    `<mxCell id="${esc(id)}" value="" style="${esc(style)}" edge="1" parent="1">` +
    `<mxGeometry relative="1" as="geometry">` +
    `<mxPoint x="${fmt(a.x)}" y="${fmt(a.y)}" as="sourcePoint"/>` +
    `<mxPoint x="${fmt(b.x)}" y="${fmt(b.y)}" as="targetPoint"/>` +
    `</mxGeometry>` +
    `</mxCell>`
  );
}

function textCell(node: CanvasNode, data: TextNodeData, origin: Pt, id: string): string {
  const x = node.x - origin.x;
  const y = node.y - origin.y;
  const w = Math.max(1, Math.abs(node.width));
  const h = Math.max(1, Math.abs(node.height));
  const value = (data.text ?? '').replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
  const style = textStyle(data);
  return (
    `<mxCell id="${esc(id)}" value="${esc(value)}" style="${esc(style)}" vertex="1" parent="1">` +
    `<mxGeometry x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" as="geometry"/>` +
    `</mxCell>`
  );
}

function vertexStyle(data: ShapeNodeData): string {
  const bits: string[] = [];
  if (data.shapeType === 'circle' || data.shapeType === 'arc') {
    bits.push('ellipse');
  } else if (data.shapeType === 'triangle') {
    bits.push('triangle');
    bits.push('direction=north');
  } else if (data.shapeType === 'diamond') {
    bits.push('rhombus');
  } else {
    const radius = data.cornerRadius ?? 0;
    if (radius > 0) {
      bits.push('rounded=1');
      bits.push('absoluteArcSize=1');
      bits.push(`arcSize=${fmt(radius)}`);
    } else {
      bits.push('rounded=0');
    }
    const rot = data.rotation ?? 0;
    if (rot !== 0) bits.push(`rotation=${fmt(rot)}`);
  }
  bits.push('whiteSpace=wrap');
  bits.push('html=1');
  // Arc: fill is dropped on purpose — the portable fallback is a stroked
  // ellipse, and a filled ring would misstate the socket even more.
  if (data.shapeType === 'arc') {
    bits.push('fillColor=none');
  } else {
    bits.push(`fillColor=${mxColour(data.fill)}`);
  }
  bits.push(`strokeColor=${mxColour(data.stroke)}`);
  bits.push(`strokeWidth=${fmt(data.strokeWidth ?? 1)}`);
  pushDash(bits, data.strokeDash);
  return bits.join(';') + ';';
}

function edgeStyle(data: ShapeNodeData): string {
  const bits: string[] = [
    data.shapeType === 'arrow' ? 'endArrow=classic' : 'endArrow=none',
    'html=1',
    `strokeColor=${mxColour(data.stroke)}`,
    `strokeWidth=${fmt(data.strokeWidth ?? 1)}`,
  ];
  pushDash(bits, data.strokeDash);
  return bits.join(';') + ';';
}

function textStyle(data: TextNodeData): string {
  const bits: string[] = [
    'text',
    'html=1',
    'align=center',
    'verticalAlign=middle',
    `fontSize=${fmt(data.fontSize || 12)}`,
    `fontColor=${mxColour(data.fill, '#14181A')}`,
    'fillColor=none',
    'strokeColor=none',
  ];
  const flags = fontFlags(data.fontStyle);
  if (flags) bits.push(`fontStyle=${flags}`);
  return bits.join(';') + ';';
}

function fontFlags(raw: string | undefined): number {
  if (!raw) return 0;
  const s = raw.toLowerCase();
  let n = 0;
  if (s.includes('bold')) n |= 1;
  if (s.includes('italic')) n |= 2;
  return n;
}

function pushDash(bits: string[], dash: number[] | undefined): void {
  if (!dash || dash.length === 0) return;
  bits.push('dashed=1');
  bits.push(`dashPattern=${dash.map(fmt).join(' ')}`);
}

function mxColour(c: string | undefined, fallback = 'none'): string {
  if (c == null || c === '' || c === 'transparent' || c.toLowerCase() === 'none') return fallback;
  return c;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return String(r);
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapMxfile(title: string, cells: string[], extent: { w: number; h: number }): string {
  const name = esc(title);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<mxfile host="PowerScroll" type="device">\n` +
    `  <diagram id="export" name="${name}">\n` +
    `    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" page="1" pageWidth="${extent.w}" pageHeight="${extent.h}">\n` +
    `      <root>\n` +
    `        <mxCell id="0"/>\n` +
    `        <mxCell id="1" parent="0"/>\n` +
    cells.map((c) => `        ${c}`).join('\n') +
    (cells.length ? '\n' : '') +
    `      </root>\n` +
    `    </mxGraphModel>\n` +
    `  </diagram>\n` +
    `</mxfile>\n`
  );
}

function emptyMxfile(title: string): string {
  return wrapMxfile(title, [], { w: 160, h: 120 });
}
