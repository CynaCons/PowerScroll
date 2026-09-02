// ── Node types ──────────────────────────────────────────────

export type NodeType = 'text' | 'image' | 'shape' | 'gantt' | 'diagram';

export interface TextNodeData {
  text: string;
  fontSize: number;
  fontFamily: string;
  fontStyle: string; // 'normal' | 'bold' | 'italic' | 'bold italic'
  fill: string;
}

export interface ImageCrop {
  x: number; // crop offset from left (0-1 ratio)
  y: number; // crop offset from top (0-1 ratio)
  width: number; // visible width ratio (0-1)
  height: number; // visible height ratio (0-1)
}

export interface ImageNodeData {
  src: string; // base64 data URI only (offline-complete; never a URL)
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
  crop?: ImageCrop; // PowerPoint-style non-destructive crop
  note?: string; // Optional caption/legend text
  rotation?: number; // Degrees (0, 90, 180, 270)
  /** Thumbnail display state. Node width/height always match the current display size. */
  mini?: boolean;
  /** Remembered mini display width (canvas px). Clamped to [48, 480]. */
  miniWidth?: number;
  /** Stashed full-size display width while mini is on. */
  fullWidth?: number;
  /** Stashed full-size display height while mini is on. */
  fullHeight?: number;
}

/**
 * `arc` is a stroked half-circle (v0.34+). It exists because a UML required
 * interface is a socket, and no combination of the other five can produce one.
 */
export type ShapeType = 'rect' | 'circle' | 'triangle' | 'arrow' | 'line' | 'arc';

export interface ShapeNodeData {
  shapeType: ShapeType;
  fill: string;           // hex color or 'transparent'
  stroke: string;         // hex color
  strokeWidth: number;    // 1-10
  strokeDash: number[];   // [] solid, [8,4] dashed, [2,2] dotted
  /** Rounded rect corners (v0.34+). UML states and node boxes are rounded. */
  cornerRadius?: number;
  /** Degrees (v0.34+). Orients an arc's opening and directional triangles. */
  rotation?: number;
  /** Endpoint attachment for arrows and lines. Absent keeps pre-v0.72 files valid. */
  startBinding?: ArrowBinding | null;
  endBinding?: ArrowBinding | null;
}

export interface ArrowBinding {
  elementId: string;
  /** Position on the target's unrotated box, expressed as [0..1, 0..1]. */
  fixedPoint: [number, number];
}

// Gantt node — embeds a PowerPlanner chart document.
// The chart `doc` is the canonical GanttDocument schema; we store it inline
// so the notebook file remains fully self-contained.
export interface GanttNodeData {
  // Stored as `unknown` to avoid pulling the full GanttDocument type into
  // PowerScroll's type system; the renderer validates at mount.
  doc: unknown;
  showCriticalPath?: boolean;
  showBaseline?: boolean;
  theme?: 'dark' | 'light' | 'print' | 'auto';
}

/**
 * A diagram frame (v0.34+) — a first-class canvas object, like an image.
 *
 * The node owns the source in whichever language built it (PlantUML, Mermaid,
 * SVG or draw.io); the marks it generates are ordinary shape and text nodes
 * carrying `groupId === <this node's id>`. So the frame is what you select,
 * move and delete, and its contents stay individually editable underneath.
 * Membership is derived from groupId, never stored.
 */
/**
 * Rendered snapshot of a diagram, produced by an extension renderer (v0.64+).
 * A frame carrying one displays the image and owns no member nodes; the
 * stored `source` remains the editable truth and the export payload.
 */
export interface DiagramRenderSnapshot {
  /** data:image/svg+xml;base64,... or data:image/png;base64,... — never a URL. */
  src: string;
  /** CSS px of the rendered artwork (aspect source of truth). */
  naturalWidth: number;
  naturalHeight: number;
  renderer: 'drawio-viewer';
  /** Upstream version of the renderer asset (drawio release). */
  rendererVersion: string;
  /** Epoch ms of the render. */
  at: number;
}

export interface DiagramNodeData {
  /** Source text this diagram was built from — PlantUML, Mermaid, SVG or draw.io. */
  source: string;
  /** Title shown on the frame band. */
  title: string;
  /** Present ⇔ this frame displays a snapshot and has zero member nodes. */
  render?: DiagramRenderSnapshot;
}

export type NodeData =
  | TextNodeData
  | ImageNodeData
  | ShapeNodeData
  | GanttNodeData
  | DiagramNodeData;

export interface CanvasNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;          // z-index layer 1-5 (default: 3)
  data: NodeData;
  /** Flat group membership (v0.27+). Same id = same group. */
  groupId?: string | null;
  /** Arrows/lines attached to this node. Derived from their endpoint bindings. */
  boundElements?: { id: string; type: 'arrow' }[];
}

// ── Drawing strokes ─────────────────────────────────────────

export interface Stroke {
  id: string;
  points: number[]; // flat [x1,y1,x2,y2,...] for Konva Line
  color: string;
  strokeWidth: number;
  /** Flat group membership (v0.27+), shared with shape nodes. */
  groupId?: string | null;
  /**
   * Per-point pen pressure 0..1, parallel to `points` (pressures.length ===
   * points.length / 2). Only recorded for stylus input (v0.42+). Absent —
   * every mouse/finger stroke and every stroke saved before v0.42 — means
   * constant width.
   */
  pressures?: number[];
}

/** Optional group index entry (derived membership is canonical). */
export interface GroupRecord {
  id: string;
}

export interface DrawOptions {
  color: string;
  strokeWidth: number;
  eraserMode: 'stroke' | 'zone';
  eraserSize: number;
  isErasing: boolean;
  /**
   * What a single finger does while a drawing tool is active (v0.42+).
   * `auto` — finger draws until the first pen contact is seen, then fingers
   * pan (Samsung-style palm-friendly default); `always` — finger always
   * draws; `never` — finger always pans. Device setting, kept in
   * localStorage, not in the notebook file.
   */
  touchDraw: 'auto' | 'always' | 'never';
  /** Device preference for magnetic alignment and equal-gap object snaps. */
  snapToObjects: boolean;
}

// ── Hierarchy types ─────────────────────────────────────────

/**
 * A named vertical scroll — one column band on a page (v0.31+).
 *
 * The record owns IDENTITY only: a stable id and a title. Membership is
 * deliberately NOT stored. Which blocks belong to a scroll is derived from
 * their `x`, using the same band test the page guides draw with, so dragging a
 * block into another scroll's band moves it there — which is what dragging it
 * there means. Storing membership would let the two disagree, and an agent
 * appending to the "owning" scroll would then stack under a block that is no
 * longer visually in it.
 */
export interface ScrollRecord {
  id: string;
  /** Shown on the canvas header and in the sidebar. Empty = unnamed, no header drawn. */
  title: string;
  /** Band index. 0 is the leftmost scroll. */
  column: number;
  /**
   * Band width in canvas px. Absent means A4_WIDTH.
   * Written only by the explicit "Fit scroll to content" action — never derived.
   */
  width?: number;
}

export interface Page {
  id: string;
  title: string;
  nodes: CanvasNode[];
  strokes?: Stroke[];
  /** Optional group records for this page (ids only; members use groupId). */
  groups?: GroupRecord[];
  /** Named scroll bands (v0.31+). Hydrated for older pages on load. */
  scrolls?: ScrollRecord[];
  /**
   * Per-page look (v0.40+) — an OVERRIDE, not a copy.
   *
   * Absent means inherit the notebook default, which is what every page written
   * before this existed already is, so old files need no migration. Partial for
   * the same reason: a page may pin its guide style and still follow the
   * notebook's colour. Always read it through `resolvePageSettings`.
   */
  settings?: Partial<WorkspaceSettings>;
}

export interface Section {
  id: string;
  title: string;
  pages: Page[];
}

/**
 * Canvas guide overlay: detached A4 page cards, one continuous vertical scroll
 * of A4 pages, dot/line grid, or blank.
 */
export type BackgroundMode = 'pages' | 'scroll' | 'grid' | 'none';

/** Canvas fill color presets (including paper texture tone) */
export type CanvasBgColor = '#ffffff' | '#f5f5f5' | '#e5e5e5' | 'paper';

/** Notebook-level UI preferences persisted inside `#powernote-data` */
export interface WorkspaceSettings {
  backgroundMode: BackgroundMode;
  bgColor: CanvasBgColor;
}

export interface WorkspaceData {
  version: string;
  filename: string;
  sections: Section[];
  editorVersion?: string; // App version that created/last updated this file
  saveRevision?: number;  // Incremented on each Ctrl+S save
  /** Canvas look — optional on older files; hydrated with defaults on load */
  settings?: WorkspaceSettings;
}

// ── Tool types ──────────────────────────────────────────────

export type ToolType = 'select' | 'text' | 'draw' | 'lasso' | 'shape' | 'image' | 'gantt' | 'diagram';

export interface ShapeOptions {
  shapeType: ShapeType;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeDash: number[];
}

export interface TextOptions {
  fontSize: number;
  fontFamily: string;
  fontStyle: string;
  fill: string;
}

// ── Viewport ────────────────────────────────────────────────

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}
