import { nodeAt, R_LABEL, R_TOPIC, type TreeLayout, type TreeNode, type TreeRel } from '../../board/treeLayout';

const DIM_ALPHA = 0.25;

/**
 * Draws the board tree on one 2D canvas, on demand: nothing runs at rest. A
 * frame is only requested by `invalidate()`, and keeps requesting itself only
 * while an animation (growth, pulse, view tween, focus ring) is still playing.
 */

interface View { k: number; x: number; y: number }

interface Decor { i: number; kind: 'lock' | 'cross'; x: number; y: number }

export interface TreeDebugNode {
  key: string;
  /** Index of the parent node, -1 for the hub. */
  parent: number;
  kind: string;
  cardId?: string;
  state?: string;
  fault: boolean;
  topic: string | null;
  x: number;
  y: number;
  r: number;
  sx: number;
  sy: number;
  /** Name of the connected agent holding this card, else null. */
  agent: string | null;
  agentColor: string | null;
  /** The agent is working on this card (sign of life within the quiet window): the comet circles it. */
  live: boolean;
  /** A comet is circling the card right now (live, and motion is allowed). */
  comet: boolean;
  /** Waits on a card that is not finished: carries the lock. */
  locked: boolean;
  /** Dependencies to or from other topics: carries the small arrow marker. */
  crossDeps: number;
}

export interface TreeDebug {
  nodes(): TreeDebugNode[];
  /** Same-topic dependency arrows drawn at rest: node indices, from the card that must finish to the one that waits. */
  deps(): Array<{ from: number; to: number }>;
  /** Lines drawn from the hovered card to the cards it waits on and the cards waiting on it. */
  hoverLinks(): Array<{ from: number; to: number; accent: boolean }>;
  stats(): { frames: number; layouts: number; lastFrameMs: number; animating: boolean };
  view(): View;
}

type Palette = Record<'bg' | 'paper' | 'ink' | 'muted' | 'faint' | 'rule' | 'accent' | 'onInk', string>;

const PALETTE_VARS: Record<keyof Palette, string> = {
  bg: '--tree-bg', paper: '--tree-paper', ink: '--tree-ink', muted: '--tree-muted',
  faint: '--tree-faint', rule: '--tree-rule', accent: '--tree-accent', onInk: '--tree-on-ink',
};
const FALLBACK: Palette = {
  bg: '#EEF1F0', paper: '#FFFFFF', ink: '#14181A', muted: '#5C6467',
  faint: '#8A9295', rule: '#C3CBC9', accent: '#B4552D', onInk: '#FFFFFF',
};

const K_MIN = 0.15;
const K_MAX = 6;
const TAU = Math.PI * 2;
const GROW_MS = 350;
const PULSE_MS = 900;
const TWEEN_MS = 300;
const FOCUS_MS = 1600;
const CLICK_SLOP = 4;
const TOPIC_NAME_K = 0.45;
const TITLE_K = 1.7;
/** Screen px radius from which twigs, leaves and rings are worth drawing. */
const DETAIL_PX = 5;
const INITIALS_PX = 8;
const CELL = 8;
const MAX_TITLES = 250;
const CULL_PAD = 26;
/** Agent rings, halos and name tags. Tags keep one on-screen size at every zoom. */
const LIVE_FRAME_MS = 80;
/** One turn of the working comet, and the number of dots in its head and tail. */
const COMET_TURN_MS = 2400;
const COMET_TAIL = 9;
const TAG_MIN_K = 0.3;
const TAG_H = 16;
const TAG_PAD = 6;
const TAG_MAX_TEXT = 118;
/** Dependency arrows, lock badges and cross-topic markers. */
const ARROW_PX = 1.5;
const HEAD_MIN_PX = 5;
const HEAD_MAX_PX = 8.5;
const HOVER_HEAD_PX = 6.5;
const MARK_PX = 5.5;
const BADGE_R = 6.5;
const COLUMN_NAME: Record<string, string> = { todo: 'To do', doing: 'Doing', waiting: 'Waiting', done: 'Done' };
const TIP_ROWS = 6;
const MONO = 'ui-monospace, "JetBrains Mono", Consolas, monospace';

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const clampK = (k: number) => Math.max(K_MIN, Math.min(K_MAX, k));
/** exp(100 * this) = 1.05: a 100 px wheel notch zooms by 5%. */
const WHEEL_ZOOM_PER_PIXEL = Math.log(1.05) / 100;
const KEY_ZOOM_STEP = 1.1;

/** White or ink text, whichever reads better on a `#rrggbb` fill. */
function textOn(fill: string, light: string, dark: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(fill.trim());
  if (!match) return light;
  const value = parseInt(match[1], 16);
  const luma = (0.299 * (value >> 16) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;
  return luma > 0.62 ? dark : light;
}

interface Batch {
  stubs: Path2D; solid: Path2D; dashed: Path2D; grey: Path2D; hollow: Path2D; inked: Path2D;
  faulty: Path2D; topics: Path2D; topicsFault: Path2D; track: Path2D; ringInk: Path2D;
  ringFault: Path2D; twigsOff: Path2D; twigsOn: Path2D; leaves: Path2D;
}

const makeBatch = (): Batch => ({
  stubs: new Path2D(), solid: new Path2D(), dashed: new Path2D(), grey: new Path2D(), hollow: new Path2D(),
  inked: new Path2D(), faulty: new Path2D(), topics: new Path2D(), topicsFault: new Path2D(),
  track: new Path2D(), ringInk: new Path2D(), ringFault: new Path2D(), twigsOff: new Path2D(),
  twigsOn: new Path2D(), leaves: new Path2D(),
});

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class BoardTreeRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private layout: TreeLayout | null = null;
  private keyIndex = new Map<string, number>();
  private title = 'Board';
  private W = 0;
  private H = 0;
  private dpr = 1;
  private view: View = { k: 1, x: 0, y: 0 };
  private tween: { from: View; to: View; t0: number } | null = null;
  private userMoved = false;
  private raf = 0;
  private animUntil = 0;
  private destroyed = false;
  private frames = 0;
  private layouts = 0;
  private lastFrameMs = 0;
  private palette: Palette = { ...FALLBACK };
  private sans = 'system-ui, sans-serif';

  // Per-node animation state, aligned with layout.nodes; positions as last drawn.
  private rx = new Float32Array(0);
  private ry = new Float32Array(0);
  private fromX = new Float32Array(0);
  private fromY = new Float32Array(0);
  private bornAt = new Float64Array(0);
  private pulseAt = new Float64Array(0);
  private grow = new Uint8Array(0);

  private focus: { key: string; at: number } | null = null;
  private spotlight: string | null = null;
  /** Per node: on the path hub -> topic -> ... -> the spotlighted agent's node. Null when no spotlight applies. */
  private lit: Uint8Array | null = null;
  private liveNodes: number[] = [];
  private liveTimer = 0;
  private agentNotes: Record<string, string> = {};
  private needIndex = -1;
  private hover = -1;
  /** While a card with dependencies is hovered: it, what it is linked to, and their paths to the hub. */
  private hoverLit: Uint8Array | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private press: { x: number; y: number; moved: boolean } | null = null;
  private pinch: { d: number; cx: number; cy: number } | null = null;
  private occupancy = new Uint8Array(0);
  private readonly measured = new Map<string, number>();
  private readonly clipped = new Map<string, string>();
  private readonly cleanups: Array<() => void> = [];
  private readonly hook: TreeDebug;

  constructor(
    private readonly container: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly tip: HTMLElement,
    private readonly onOpenCard: (cardId: string) => void,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is not available');
    this.ctx = context;
    this.readPalette();

    const listen = <T extends EventTarget>(
      target: T,
      type: string,
      handler: (event: never) => void,
      options?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, handler as EventListener, options);
      this.cleanups.push(() => target.removeEventListener(type, handler as EventListener, options));
    };

    listen(canvas, 'wheel', this.onWheel, { passive: false });
    listen(canvas, 'pointerdown', this.onPointerDown);
    listen(canvas, 'pointermove', this.onPointerMove);
    listen(canvas, 'pointerup', this.onPointerUp);
    listen(canvas, 'pointercancel', this.onPointerUp);
    listen(canvas, 'pointerleave', this.onPointerLeave);
    listen(canvas, 'keydown', this.onKeyDown);
    listen(document, 'visibilitychange', () => { this.syncLive(); this.invalidate(); });

    const resizer = new ResizeObserver(() => this.measure());
    resizer.observe(container);
    this.cleanups.push(() => resizer.disconnect());

    // Colours follow the theme: the OS setting and the app's own data-theme.
    const onTheme = () => { this.readPalette(); this.invalidate(); };
    const dark = matchMedia('(prefers-color-scheme: dark)');
    dark.addEventListener('change', onTheme);
    this.cleanups.push(() => dark.removeEventListener('change', onTheme));
    const themeWatcher = new MutationObserver(onTheme);
    themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.cleanups.push(() => themeWatcher.disconnect());

    this.hook = {
      nodes: () => {
        const rect = this.canvas.getBoundingClientRect();
        return (this.layout?.nodes ?? []).map((node) => ({
          key: node.key, parent: node.parent, kind: node.kind, cardId: node.cardId, state: node.state, fault: node.fault,
          topic: node.topic, x: node.x, y: node.y, r: node.r,
          sx: rect.left + node.x * this.view.k + this.view.x,
          sy: rect.top + node.y * this.view.k + this.view.y,
          agent: node.agent?.name ?? null,
          agentColor: node.agent?.color ?? null,
          live: Boolean(node.agent?.live),
          comet: Boolean(node.agent?.live) && !reducedMotion(),
          locked: node.locked,
          crossDeps: node.crossDeps,
        }));
      },
      deps: () => (this.layout?.edges ?? []).map(([from, to]) => ({ from, to })),
      hoverLinks: () => this.hoverRelations().map((rel) => ({
        from: rel.waitsOn ? rel.other : this.hover,
        to: rel.waitsOn ? this.hover : rel.other,
        accent: rel.accent,
      })),
      stats: () => ({
        frames: this.frames, layouts: this.layouts, lastFrameMs: this.lastFrameMs, animating: this.liveTimer !== 0,
      }),
      view: () => ({ ...this.view }),
    };
    (window as unknown as { __POWERNOTE_BOARD_TREE__?: TreeDebug }).__POWERNOTE_BOARD_TREE__ = this.hook;
    this.measure();
  }

  // ---- public API ----

  setTitle(title: string) {
    if (title === this.title) return;
    this.title = title;
    this.invalidate();
  }

  setLayout(layout: TreeLayout) {
    if (layout === this.layout) return;
    const previous = this.layout;
    const previousIndex = this.keyIndex;
    const now = performance.now();
    const count = layout.nodes.length;
    this.layout = layout;
    this.layouts++;
    this.keyIndex = new Map(layout.nodes.map((node, index) => [node.key, index]));
    this.rx = new Float32Array(count);
    this.ry = new Float32Array(count);
    this.fromX = new Float32Array(count);
    this.fromY = new Float32Array(count);
    this.bornAt = new Float64Array(count);
    this.pulseAt = new Float64Array(count);
    this.grow = new Uint8Array(count);

    if (previous && !reducedMotion()) {
      layout.nodes.forEach((node, index) => {
        const before = previousIndex.get(node.key);
        if (before === undefined) {
          // New nodes grow out of their parent.
          const parent = layout.nodes[node.parent] ?? node;
          this.bornAt[index] = now;
          this.fromX[index] = parent.x;
          this.fromY[index] = parent.y;
          this.grow[index] = 1;
          this.animUntil = Math.max(this.animUntil, now + GROW_MS);
          return;
        }
        const old = previous.nodes[before];
        if (
          old.state !== node.state || old.fault !== node.fault || old.checkDone !== node.checkDone
          || old.checkTotal !== node.checkTotal
        ) {
          this.pulseAt[index] = now;
          this.animUntil = Math.max(this.animUntil, now + PULSE_MS);
        }
        if (Math.abs(old.x - node.x) > 0.5 || Math.abs(old.y - node.y) > 0.5) {
          this.bornAt[index] = now;
          this.fromX[index] = old.x;
          this.fromY[index] = old.y;
          this.animUntil = Math.max(this.animUntil, now + GROW_MS);
        }
      });
    }

    this.hover = -1;
    this.hoverLit = null;
    this.tip.hidden = true;
    this.liveNodes = [];
    layout.nodes.forEach((node, index) => { if (node.agent?.live) this.liveNodes.push(index); });
    this.buildLit();

    if (!this.userMoved && this.W && this.H) this.goTo(this.fitTarget(), Boolean(previous));
    this.syncLive();
    this.invalidate();
  }

  /** What the tooltip says about each agent ("working now", "holding", "quiet 15 min"). */
  setAgentNotes(notes: Record<string, string>) {
    this.agentNotes = notes;
  }

  /**
   * Spotlight one agent: the view moves to its card and everything off the path
   * hub -> topic -> card dims. Clearing it restores the picture without moving the view.
   */
  setSpotlight(name: string | null) {
    if (name === this.spotlight) return;
    this.spotlight = name;
    this.buildLit();
    const layout = this.layout;
    const node = name && layout ? layout.nodes.find((item) => item.agent?.name === name) : undefined;
    if (node && this.W && this.H) {
      const k = clampK(Math.max(this.view.k, 2.4));
      this.userMoved = true;
      this.goTo({ k, x: this.W / 2 - k * node.x, y: this.H / 2 - k * node.y }, true);
    }
    this.invalidate();
  }

  /** The dependencies of the hovered card node, for the lines, the fade and the tooltip. */
  private hoverRelations(): TreeRel[] {
    const node = this.layout?.nodes[this.hover];
    if (!this.layout || !node || node.kind !== 'card') return [];
    return this.layout.related.get(this.hover) ?? [];
  }

  private buildHoverLit() {
    const layout = this.layout;
    const rels = this.hoverRelations();
    this.hoverLit = null;
    if (!layout || !rels.length) return;
    const lit = new Uint8Array(layout.nodes.length);
    const light = (index: number) => {
      for (let at = index; at >= 0 && !lit[at]; at = layout.nodes[at].parent) lit[at] = 1;
    };
    light(this.hover);
    for (const rel of rels) light(rel.other);
    lit[0] = 1;
    this.hoverLit = lit;
  }

  private buildLit() {
    const layout = this.layout;
    this.lit = null;
    if (!layout || !this.spotlight) return;
    const target = layout.nodes.findIndex((node) => node.agent?.name === this.spotlight);
    if (target < 0) return;
    const lit = new Uint8Array(layout.nodes.length);
    for (let at = target; at >= 0 && !lit[at]; at = layout.nodes[at].parent) lit[at] = 1;
    lit[0] = 1;
    this.lit = lit;
  }

  /**
   * The one place that decides whether the comets need frames: only while a
   * live node is inside the view, the page is visible and motion is allowed.
   */
  private syncLive() {
    let wanted = false;
    if (!this.destroyed && !document.hidden && !reducedMotion() && this.liveNodes.length && this.layout) {
      const { k, x, y } = this.view;
      for (const index of this.liveNodes) {
        const node = this.layout.nodes[index];
        const margin = (node.r + 12) * k;
        const sx = node.x * k + x;
        const sy = node.y * k + y;
        if (sx > -margin && sx < this.W + margin && sy > -margin && sy < this.H + margin) {
          wanted = true;
          break;
        }
      }
    }
    if (wanted && !this.liveTimer) this.liveTimer = window.setInterval(() => this.invalidate(), LIVE_FRAME_MS);
    else if (!wanted && this.liveTimer) {
      window.clearInterval(this.liveTimer);
      this.liveTimer = 0;
    }
  }

  /** Back to the whole tree; the view follows layout changes again. */
  fit() {
    this.userMoved = false;
    if (this.layout) this.goTo(this.fitTarget(), true);
    this.invalidate();
  }

  /** Tween to the next fault in card-number order; false when there is none. */
  nextFault(): boolean {
    const layout = this.layout;
    if (!layout) return false;
    const faults = layout.nodes
      .filter((node) => node.kind === 'card' && node.fault)
      .sort((left, right) => (left.number ?? 0) - (right.number ?? 0));
    if (!faults.length) return false;
    this.needIndex = (this.needIndex + 1) % faults.length;
    const node = faults[this.needIndex];
    const k = clampK(Math.max(this.view.k, 2.4));
    this.userMoved = true;
    this.focus = { key: node.key, at: performance.now() };
    this.goTo({ k, x: this.W / 2 - k * node.x, y: this.H / 2 - k * node.y }, true);
    this.invalidate();
    return true;
  }

  invalidate() {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.destroyed = true;
    if (this.liveTimer) window.clearInterval(this.liveTimer);
    this.liveTimer = 0;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    const win = window as unknown as { __POWERNOTE_BOARD_TREE__?: TreeDebug };
    if (win.__POWERNOTE_BOARD_TREE__ === this.hook) delete win.__POWERNOTE_BOARD_TREE__;
  }

  // ---- view ----

  private measure() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = width;
    this.H = height;
    const pixelWidth = Math.round(width * this.dpr);
    const pixelHeight = Math.round(height * this.dpr);
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    if (!this.userMoved && this.layout && width && height) {
      this.tween = null;
      this.view = this.fitTarget();
    }
    this.invalidate();
  }

  private boundsTarget(nodes: Array<{ x: number; y: number; r: number }>, maxK: number): View {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const node of nodes) {
      const margin = node.r + 10;
      x0 = Math.min(x0, node.x - margin);
      y0 = Math.min(y0, node.y - margin);
      x1 = Math.max(x1, node.x + margin);
      y1 = Math.max(y1, node.y + margin);
    }
    const padX = 20;
    const padTop = 48;
    const padBottom = 24;
    const k = clampK(Math.min(
      (this.W - 2 * padX) / Math.max(1, x1 - x0),
      (this.H - padTop - padBottom) / Math.max(1, y1 - y0),
      maxK,
    ));
    return {
      k,
      x: this.W / 2 - (k * (x0 + x1)) / 2,
      y: padTop + (this.H - padTop - padBottom) / 2 - (k * (y0 + y1)) / 2,
    };
  }

  private fitTarget(): View {
    return this.boundsTarget(this.layout?.nodes ?? [], 1.6);
  }

  private goTo(target: View, animate: boolean) {
    if (!animate || reducedMotion()) {
      this.tween = null;
      this.view = target;
      return;
    }
    this.tween = { from: { ...this.view }, to: target, t0: performance.now() };
  }

  private zoomTopic(topic: string) {
    const layout = this.layout;
    if (!layout) return;
    const picked: Array<{ x: number; y: number; r: number }> = layout.nodes.filter((node) => node.topic === topic);
    const head = layout.nodes.find((node) => node.kind === 'topic' && node.topic === topic);
    if (head) picked.push({ x: R_LABEL * Math.cos(head.angle), y: R_LABEL * Math.sin(head.angle), r: 4 });
    this.userMoved = true;
    this.goTo(this.boundsTarget(picked, 3.2), true);
    this.invalidate();
  }

  private zoomAt(px: number, py: number, factor: number) {
    const k = clampK(this.view.k * factor);
    const f = k / this.view.k;
    this.tween = null;
    this.view = { k, x: px - (px - this.view.x) * f, y: py - (py - this.view.y) * f };
    this.userMoved = true;
    this.invalidate();
  }

  // ---- input ----

  private local(event: { clientX: number; clientY: number }) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private hit(px: number, py: number): number {
    if (!this.layout) return -1;
    const { k, x, y } = this.view;
    return nodeAt(this.layout, (px - x) / k, (py - y) / k, Math.max(4, 7 / k));
  }

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const point = this.local(event);
    // One wheel notch is 5%, the same step as the canvas (it was 17%, which
    // jumped past the zoom you wanted). Line-mode wheels report notches, not
    // pixels; a free-spinning wheel is capped so one event is never a leap.
    // A trackpad pinch arrives as ctrl+wheel with small deltas of its own.
    const pixels = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
    const factor = event.ctrlKey
      ? Math.exp(-Math.max(-25, Math.min(25, pixels)) * 0.01)
      : Math.exp(-Math.max(-120, Math.min(120, pixels)) * WHEEL_ZOOM_PER_PIXEL);
    this.zoomAt(point.x, point.y, factor);
    this.setHover(-1, 0, 0);
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    this.canvas.setPointerCapture(event.pointerId);
    const point = this.local(event);
    this.pointers.set(event.pointerId, point);
    if (this.pointers.size === 1) this.press = { x: point.x, y: point.y, moved: false };
    else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this.press = null;
    }
    this.setHover(-1, 0, 0);
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const point = this.local(event);
    const tracked = this.pointers.get(event.pointerId);
    if (tracked) {
      const dx = point.x - tracked.x;
      const dy = point.y - tracked.y;
      tracked.x = point.x;
      tracked.y = point.y;
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        this.view = { ...this.view, x: this.view.x + cx - this.pinch.cx, y: this.view.y + cy - this.pinch.cy };
        this.zoomAt(cx, cy, d / (this.pinch.d || d));
        this.pinch = { d, cx, cy };
        return;
      }
      if (this.press) {
        if (!this.press.moved && Math.hypot(point.x - this.press.x, point.y - this.press.y) > CLICK_SLOP) {
          this.press.moved = true;
          this.canvas.style.cursor = 'grabbing';
        }
        if (this.press.moved) {
          this.tween = null;
          this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy };
          this.userMoved = true;
          this.invalidate();
        }
      }
      return;
    }
    const index = this.hit(point.x, point.y);
    this.canvas.style.cursor = index >= 0 ? 'pointer' : 'grab';
    this.setHover(event.pointerType === 'mouse' ? index : -1, point.x, point.y);
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const wasPress = this.press;
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    this.canvas.style.cursor = 'grab';
    if (this.pointers.size === 0) this.press = null;
    if (!wasPress || wasPress.moved || event.type !== 'pointerup') return;
    const point = this.local(event);
    const node = this.layout?.nodes[this.hit(point.x, point.y)];
    if (!node) return;
    if (node.kind === 'card' && node.cardId) this.onOpenCard(node.cardId);
    else if (node.kind === 'topic' && node.topic !== null) this.zoomTopic(node.topic);
  };

  private readonly onPointerLeave = () => this.setHover(-1, 0, 0);

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '0' || event.key === 'f') this.fit();
    else if (event.key === '+' || event.key === '=') this.zoomAt(this.W / 2, this.H / 2, KEY_ZOOM_STEP);
    else if (event.key === '-') this.zoomAt(this.W / 2, this.H / 2, 1 / KEY_ZOOM_STEP);
    else return;
    event.preventDefault();
  };

  private setHover(index: number, px: number, py: number) {
    const node = index >= 0 ? this.layout?.nodes[index] : undefined;
    if (!node) {
      if (this.hover !== -1) {
        this.hover = -1;
        this.tip.hidden = true;
        if (this.hoverLit) {
          this.hoverLit = null;
          this.invalidate();
        }
      }
      return;
    }
    if (index !== this.hover) {
      this.hover = index;
      const hadLit = this.hoverLit !== null;
      this.buildHoverLit();
      if (hadLit || this.hoverLit) this.invalidate();
      const note = node.kind === 'card' && node.agent ? this.agentNotes[node.agent.name] : undefined;
      this.tip.textContent = node.kind === 'card'
        ? `#${node.number} ${node.title ?? ''}`
        : `${node.topic} · click to zoom in`;
      if (node.kind === 'card' && node.agent) {
        const line = document.createElement('div');
        line.textContent = `${node.agent.name} - ${note ?? 'holding'}`;
        line.style.opacity = '0.8';
        this.tip.appendChild(line);
      }
      if (node.kind === 'card') {
        const rels = this.hoverRelations();
        this.addTipSection('Waits on', rels.filter((rel) => rel.waitsOn));
        this.addTipSection('Waited on by', rels.filter((rel) => !rel.waitsOn));
      }
      this.tip.hidden = false;
    }
    const width = this.tip.offsetWidth;
    const spot = this.tipSpot(px, py, width, this.tip.offsetHeight);
    if (spot) {
      this.tip.style.left = `${spot.x}px`;
      this.tip.style.top = `${spot.y}px`;
      return;
    }
    const left = px + 14 + width > this.W ? Math.max(4, px - 14 - width) : px + 14;
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${Math.min(py + 14, Math.max(4, this.H - 34))}px`;
  }

  /**
   * While links are drawn: a place for the tooltip clear of the hovered node, the related
   * nodes and the lines, on the side away from the related nodes; a corner if none fits.
   */
  private tipSpot(px: number, py: number, w: number, h: number): { x: number; y: number } | null {
    const layout = this.layout;
    const rels = this.hoverRelations();
    if (!layout || !rels.length) return null;
    const { k, x, y } = this.view;
    const at = (i: number) => ({ x: layout.nodes[i].x * k + x, y: layout.nodes[i].y * k + y });
    const ends = [this.hover, ...rels.map((rel) => rel.other)];
    const discs = ends.map((i) => ({ ...at(i), r: layout.nodes[i].r * k + 10 }));
    const here = discs[0];
    let cx = 0;
    let cy = 0;
    for (const d of discs.slice(1)) { cx += d.x / (discs.length - 1); cy += d.y / (discs.length - 1); }
    const hits = (left: number, top: number) => {
      if (left < 4 || top < 4 || left + w > this.W - 4 || top + h > this.H - 4) return true;
      if (discs.some((d) => left < d.x + d.r && left + w > d.x - d.r && top < d.y + d.r && top + h > d.y - d.r)) return true;
      return discs.slice(1).some((d) => {
        for (let step = 1; step < 16; step++) {
          const px1 = here.x + ((d.x - here.x) * step) / 16;
          const py1 = here.y + ((d.y - here.y) * step) / 16;
          if (px1 > left - 3 && px1 < left + w + 3 && py1 > top - 3 && py1 < top + h + 3) return true;
        }
        return false;
      });
    };
    const gap = 16;
    const near = [
      { x: here.x + here.r + gap - 10, y: here.y - h / 2 },
      { x: here.x - here.r - gap + 10 - w, y: here.y - h / 2 },
      { x: here.x - w / 2, y: here.y + here.r + gap - 10 },
      { x: here.x - w / 2, y: here.y - here.r - gap + 10 - h },
    ].sort((a, b) => Math.hypot(b.x + w / 2 - cx, b.y + h / 2 - cy) - Math.hypot(a.x + w / 2 - cx, a.y + h / 2 - cy));
    const corners = [
      { x: 8, y: this.H - h - 8 }, { x: this.W - w - 8, y: this.H - h - 8 },
      { x: 8, y: 8 }, { x: this.W - w - 8, y: 8 },
    ].sort((a, b) => Math.hypot(b.x + w / 2 - cx, b.y + h / 2 - cy) - Math.hypot(a.x + w / 2 - cx, a.y + h / 2 - cy));
    const pick = [...near, ...corners].find((c) => !hits(c.x, c.y)) ?? corners[0];
    void px;
    void py;
    return { x: Math.max(4, pick.x), y: Math.max(4, pick.y) };
  }

  private addTipSection(heading: string, rels: TreeRel[]) {
    if (!rels.length) return;
    const head = document.createElement('div');
    head.textContent = heading;
    head.style.cssText = 'margin-top:4px;font-size:11px;font-weight:600;opacity:0.8';
    this.tip.appendChild(head);
    for (const rel of rels.slice(0, TIP_ROWS)) {
      const row = document.createElement('div');
      row.dataset.testid = 'board-tree-tip-dep';
      row.textContent = `${rel.topic} · #${rel.number} ${rel.title} · ${COLUMN_NAME[rel.column] ?? rel.column}`;
      row.style.cssText = 'font-size:11px;opacity:0.9';
      this.tip.appendChild(row);
    }
    if (rels.length > TIP_ROWS) {
      const more = document.createElement('div');
      more.textContent = `+${rels.length - TIP_ROWS} more`;
      more.style.cssText = 'font-size:11px;opacity:0.7';
      this.tip.appendChild(more);
    }
  }

  // ---- drawing ----

  private readPalette() {
    const style = getComputedStyle(this.container);
    const next = { ...FALLBACK };
    for (const name of Object.keys(PALETTE_VARS) as Array<keyof Palette>) {
      next[name] = style.getPropertyValue(PALETTE_VARS[name]).trim() || FALLBACK[name];
    }
    this.palette = next;
    this.sans = style.fontFamily || this.sans;
  }

  private readonly frame = () => {
    this.raf = 0;
    if (this.destroyed) return;
    const now = performance.now();
    const tween = this.tween;
    if (tween) {
      const t = Math.min(1, Math.max(0, (now - tween.t0) / TWEEN_MS));
      const e = ease(t);
      this.view = t >= 1
        ? tween.to
        : {
          k: tween.from.k + (tween.to.k - tween.from.k) * e,
          x: tween.from.x + (tween.to.x - tween.from.x) * e,
          y: tween.from.y + (tween.to.y - tween.from.y) * e,
        };
      if (t >= 1) this.tween = null;
    }
    this.draw(now);
    this.syncLive();
    const focusing = this.focus !== null && now - this.focus.at < FOCUS_MS;
    if (this.tween || now < this.animUntil || focusing) this.invalidate();
  };

  private width(text: string): number {
    const key = this.ctx.font + text;
    let cached = this.measured.get(key);
    if (cached === undefined) {
      if (this.measured.size > 6000) this.measured.clear();
      cached = this.ctx.measureText(text).width;
      this.measured.set(key, cached);
    }
    return cached;
  }

  /** `text` cut with an ellipsis to fit `max` in the current font. */
  private fitText(text: string, max: number): string {
    const key = `${this.ctx.font}|${max}|${text}`;
    const cached = this.clipped.get(key);
    if (cached !== undefined) return cached;
    let out = text;
    if (this.width(text) > max) {
      let end = text.length;
      while (end > 1 && this.width(`${text.slice(0, end)}…`) > max) end--;
      out = `${text.slice(0, end)}…`;
    }
    if (this.clipped.size > 3000) this.clipped.clear();
    this.clipped.set(key, out);
    return out;
  }

  private draw(now: number) {
    const layout = this.layout;
    if (!layout || !this.W || !this.H || document.hidden) return;
    const started = performance.now();
    const { ctx, palette: P, view } = this;
    const { nodes } = layout;
    const { k } = view;
    const animating = now < this.animUntil;
    const showNames = k >= TOPIC_NAME_K;

    // The visible world rectangle: everything else is skipped.
    const vx0 = -view.x / k - CULL_PAD;
    const vy0 = -view.y / k - CULL_PAD;
    const vx1 = (this.W - view.x) / k + CULL_PAD;
    const vy1 = (this.H - view.y) / k + CULL_PAD;

    const spot = this.hoverLit ?? this.lit;
    const main = makeBatch();
    const dim = spot ? makeBatch() : null;
    const labelled: number[] = [];
    const pulsing: number[] = [];
    const seen: number[] = [];
    const held: number[] = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      let x = node.x;
      let y = node.y;
      let r = node.r;
      const batch = spot && !spot[i] && dim ? dim : main;
      if (animating && this.bornAt[i]) {
        const e = ease(Math.min(1, Math.max(0, (now - this.bornAt[i]) / GROW_MS)));
        x = this.fromX[i] + (x - this.fromX[i]) * e;
        y = this.fromY[i] + (y - this.fromY[i]) * e;
        if (this.grow[i]) r *= e;
      }
      this.rx[i] = x;
      this.ry[i] = y;

      if (i > 0) {
        if (node.kind === 'topic') {
          const cos = Math.cos(node.angle);
          const sin = Math.sin(node.angle);
          const to = showNames ? R_LABEL - 8 : R_TOPIC;
          if (to > 24) {
            batch.stubs.moveTo(24 * cos, 24 * sin);
            batch.stubs.lineTo(to * cos, to * sin);
          }
        } else {
          const px = this.rx[node.parent];
          const py = this.ry[node.parent];
          if (!(Math.max(x, px) < vx0 || Math.min(x, px) > vx1 || Math.max(y, py) < vy0 || Math.min(y, py) > vy1)) {
            const path = node.state === 'todo' ? batch.dashed : batch.solid;
            const parentRadius = Math.hypot(px, py);
            const parentAngle = Math.atan2(py, px);
            const radius = Math.hypot(x, y);
            const angle = Math.atan2(y, x);
            const mid = (parentRadius + radius) / 2;
            path.moveTo(px, py);
            path.bezierCurveTo(
              mid * Math.cos(parentAngle), mid * Math.sin(parentAngle),
              mid * Math.cos(angle), mid * Math.sin(angle), x, y,
            );
          }
        }
      }

      if (x + r < vx0 || x - r > vx1 || y + r < vy0 || y - r > vy1) continue;
      if (node.kind === 'hub') continue;
      seen.push(i);
      if (node.kind === 'card' && node.agent) held.push(i);
      if (animating && this.pulseAt[i] && now - this.pulseAt[i] < PULSE_MS) pulsing.push(i);
      const screenR = node.r * k;

      if (node.kind === 'topic') {
        const path = node.fault ? batch.topicsFault : batch.topics;
        path.moveTo(x + r, y);
        path.arc(x, y, r, 0, TAU);
        continue;
      }

      const big = node.state === 'doing' || node.state === 'waiting';
      if (node.state === 'todo') {
        const inner = Math.max(0.1, r - 0.75);
        batch.hollow.moveTo(x + inner, y);
        batch.hollow.arc(x, y, inner, 0, TAU);
      } else {
        const path = node.fault ? batch.faulty : batch.inked;
        path.moveTo(x + r, y);
        path.arc(x, y, r, 0, TAU);
      }
      if (screenR >= DETAIL_PX && node.checkTotal > 0) {
        // One twig per checklist step on the outward side; ticked steps carry a leaf.
        const total = Math.min(node.checkTotal, 16);
        const ticked = Math.round((node.checkDone * total) / node.checkTotal);
        const spread = big ? 1.5 : 1.25;
        const edge = r + (big ? 4.5 : 1.5);
        const length = big ? 6 : 4.5;
        for (let t = 0; t < total; t++) {
          const a = node.angle + (total === 1 ? 0 : (t / (total - 1) - 0.5) * 2 * spread);
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          const path = t < ticked ? batch.twigsOn : batch.twigsOff;
          path.moveTo(x + edge * cos, y + edge * sin);
          path.lineTo(x + (edge + length) * cos, y + (edge + length) * sin);
          if (t < ticked) {
            batch.leaves.moveTo(x + (edge + length) * cos + 1.3, y + (edge + length) * sin);
            batch.leaves.arc(x + (edge + length) * cos, y + (edge + length) * sin, 1.3, 0, TAU);
          }
        }
      }
      if (big && screenR >= DETAIL_PX) {
        const ring = r + 2.8;
        batch.track.moveTo(x + ring, y);
        batch.track.arc(x, y, ring, 0, TAU);
        if (node.checkTotal > 0 && node.checkDone > 0) {
          const path = node.fault ? batch.ringFault : batch.ringInk;
          path.moveTo(x, y - ring);
          path.arc(x, y, ring, -Math.PI / 2, -Math.PI / 2 + (TAU * node.checkDone) / node.checkTotal);
        }
        if (screenR >= INITIALS_PX) labelled.push(i);
      }
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * view.x, this.dpr * view.y);
    ctx.lineCap = 'round';
    ctx.setLineDash([]);

    this.paintHalos(held, spot);
    if (dim) this.paintBatch(dim, DIM_ALPHA);
    this.paintBatch(main, 1);
    ctx.globalAlpha = 1;
    const incident = this.drawDependencies(spot, vx0, vy0, vx1, vy1);
    if (showNames) this.drawTopicNames(vx0, vy0, vx1, vy1, spot);

    // Hub: solid, with the board title cut to fit.
    ctx.fillStyle = P.ink;
    ctx.beginPath();
    ctx.arc(0, 0, nodes[0].r, 0, TAU);
    ctx.fill();
    if (nodes[0].r * k >= 9) {
      ctx.fillStyle = P.onInk;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 8px ${this.sans}`;
      ctx.fillText(this.fitText(this.title, nodes[0].r * 2 - 6), 0, 0.5);
    }

    // Text inside nodes: "+N", agent initials, "?" for waiting.
    if (labelled.length) {
      ctx.fillStyle = P.onInk;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const i of labelled) {
        ctx.globalAlpha = spot && !spot[i] ? DIM_ALPHA : 1;
        const node = nodes[i];
        const x = this.rx[i];
        const y = this.ry[i];
        const text = node.state === 'waiting' ? '?' : node.initials;
        if (!text) continue;
        ctx.font = `500 9.5px ${MONO}`;
        ctx.fillText(text, x, y + 0.5);
      }
    }

    ctx.globalAlpha = 1;
    this.paintRings(held, now, spot);

    // Pulses and the focus ring are the only per-node strokes, and only while they play.
    if (pulsing.length) {
      ctx.lineWidth = 1.5;
      for (const i of pulsing) {
        const q = (now - this.pulseAt[i]) / PULSE_MS;
        ctx.strokeStyle = nodes[i].fault ? P.accent : P.ink;
        ctx.globalAlpha = 1 - q;
        ctx.beginPath();
        ctx.arc(this.rx[i], this.ry[i], nodes[i].r + 4 + q * 16, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const focus = this.focus;
    if (focus) {
      const f = (now - focus.at) / FOCUS_MS;
      const index = this.keyIndex.get(focus.key);
      if (f < 1 && index !== undefined) {
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = 2 / k + 1;
        ctx.globalAlpha = 1 - f * f;
        ctx.beginPath();
        ctx.arc(this.rx[index], this.ry[index], nodes[index].r + 9, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else this.focus = null;
    }

    if (k >= TAG_MIN_K) this.drawLabels(seen, held, spot, k >= TITLE_K ? this.placeDecor(seen, incident) : []);

    this.frames++;
    this.lastFrameMs = performance.now() - started;
  }

  /** One batch of shared paths: links, then twigs, nodes, progress rings and topic discs. */
  private paintBatch(batch: Batch, alpha: number) {
    const { ctx, palette: P } = this;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = P.rule; ctx.lineWidth = 1.2; ctx.stroke(batch.stubs);
    ctx.strokeStyle = P.muted; ctx.lineWidth = 1.5; ctx.stroke(batch.solid);
    ctx.strokeStyle = P.rule; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.stroke(batch.dashed);
    ctx.setLineDash([]);

    ctx.strokeStyle = P.rule; ctx.lineWidth = 1; ctx.stroke(batch.twigsOff);
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.3; ctx.stroke(batch.twigsOn);
    ctx.fillStyle = P.ink; ctx.fill(batch.leaves);

    ctx.fillStyle = P.muted; ctx.fill(batch.grey);
    ctx.fillStyle = P.bg; ctx.fill(batch.hollow);
    ctx.strokeStyle = P.faint; ctx.lineWidth = 1.5; ctx.stroke(batch.hollow);
    ctx.fillStyle = P.ink; ctx.fill(batch.inked);
    ctx.fillStyle = P.accent; ctx.fill(batch.faulty);

    ctx.strokeStyle = P.rule; ctx.lineWidth = 2; ctx.stroke(batch.track);
    ctx.strokeStyle = P.ink; ctx.stroke(batch.ringInk);
    ctx.strokeStyle = P.accent; ctx.stroke(batch.ringFault);

    ctx.fillStyle = P.paper; ctx.fill(batch.topics); ctx.fill(batch.topicsFault);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = P.ink; ctx.stroke(batch.topics);
    ctx.strokeStyle = P.accent; ctx.stroke(batch.topicsFault);
    ctx.globalAlpha = 1;
  }

  /** Distance from the node's centre to the arrow end: just outside its circle and agent ring. */
  private trimOf(node: TreeNode): number {
    const big = node.state === 'doing' || node.state === 'waiting';
    return node.r + (big ? 5.8 : 3) + 1.5 / this.view.k;
  }

  /** A filled triangle at the tip, pointing along (dx, dy). */
  private head(path: Path2D, tipX: number, tipY: number, dx: number, dy: number, size: number) {
    const baseX = tipX - dx * size;
    const baseY = tipY - dy * size;
    const wing = size * 0.45;
    path.moveTo(tipX, tipY);
    path.lineTo(baseX - dy * wing, baseY + dx * wing);
    path.lineTo(baseX + dy * wing, baseY - dx * wing);
    path.closePath();
  }

  /** Arrow head size in world units: 5 px at low zoom, 8.5 px once titles show. */
  private headSize(): number {
    const { k } = this.view;
    const t = Math.max(0, Math.min(1, (k - 0.6) / (TITLE_K - 0.6)));
    return (HEAD_MIN_PX + (HEAD_MAX_PX - HEAD_MIN_PX) * t) / k;
  }

  /**
   * Same-topic dependency arrows (straight, ink, constant screen width), then the hover lines.
   * Returns, per node, the world angles its arrows leave at, so badges keep clear of them.
   */
  private drawDependencies(
    spot: Uint8Array | null, vx0: number, vy0: number, vx1: number, vy1: number,
  ): Map<number, number[]> {
    const { ctx, palette: P, layout, view } = this;
    const incident = new Map<number, number[]>();
    if (!layout) return incident;
    const { k } = view;
    const nodes = layout.nodes;
    const wantAngles = k >= TITLE_K;
    const note = (index: number, angle: number) => {
      const list = incident.get(index);
      if (list) list.push(angle);
      else incident.set(index, [angle]);
    };
    const size = this.headSize();
    const draw = (path: Path2D, heads: Path2D, from: number, to: number, bend: number, headSize: number) => {
      const ax = this.rx[from];
      const ay = this.ry[from];
      const bx = this.rx[to];
      const by = this.ry[to];
      if (Math.max(ax, bx) < vx0 || Math.min(ax, bx) > vx1 || Math.max(ay, by) < vy0 || Math.min(ay, by) > vy1) return;
      const length = Math.hypot(bx - ax, by - ay);
      if (length < 1e-6) return;
      // Control point of a gentle curve; bend 0 is a straight line.
      const cx = (ax + bx) / 2 - ((by - ay) / length) * length * bend;
      const cy = (ay + by) / 2 + ((bx - ax) / length) * length * bend;
      const aimX = bend ? cx : bx;
      const aimY = bend ? cy : by;
      const startLen = Math.hypot(aimX - ax, aimY - ay) || 1;
      const sx = (aimX - ax) / startLen;
      const sy = (aimY - ay) / startLen;
      const fromX = bend ? cx : ax;
      const fromY = bend ? cy : ay;
      const endLen = Math.hypot(bx - fromX, by - fromY) || 1;
      const ex = (bx - fromX) / endLen;
      const ey = (by - fromY) / endLen;
      const trimA = this.trimOf(nodes[from]);
      const trimB = this.trimOf(nodes[to]);
      const room = length - trimA - trimB;
      if (room <= 0.5 / k) return;
      const headLen = Math.min(headSize, room * 0.7);
      const tipX = bx - ex * trimB;
      const tipY = by - ey * trimB;
      path.moveTo(ax + sx * trimA, ay + sy * trimA);
      const endX = tipX - ex * headLen * 0.8;
      const endY = tipY - ey * headLen * 0.8;
      if (bend) path.quadraticCurveTo(cx, cy, endX, endY);
      else path.lineTo(endX, endY);
      this.head(heads, tipX, tipY, ex, ey, headLen);
      if (wantAngles) {
        note(from, Math.atan2(sy, sx));
        note(to, Math.atan2(-ey, -ex));
      }
    };

    const full = new Path2D();
    const fullHeads = new Path2D();
    const faded = new Path2D();
    const fadedHeads = new Path2D();
    for (const [from, to] of layout.edges) {
      const dimmed = spot && (!spot[from] || !spot[to]);
      draw(dimmed ? faded : full, dimmed ? fadedHeads : fullHeads, from, to, 0, size);
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = ARROW_PX / k;
    ctx.strokeStyle = P.ink;
    ctx.fillStyle = P.ink;
    ctx.globalAlpha = DIM_ALPHA;
    ctx.stroke(faded);
    ctx.fill(fadedHeads);
    ctx.globalAlpha = 1;
    ctx.stroke(full);
    ctx.fill(fullHeads);

    // Hover: every card the hovered one waits on and every card waiting on it, any topic.
    const rels = this.hoverRelations();
    if (rels.length) {
      const ink = new Path2D();
      const inkHeads = new Path2D();
      const accent = new Path2D();
      const accentHeads = new Path2D();
      const hoverHead = HOVER_HEAD_PX / k;
      for (const rel of rels) {
        const from = rel.waitsOn ? rel.other : this.hover;
        const to = rel.waitsOn ? this.hover : rel.other;
        draw(rel.accent ? accent : ink, rel.accent ? accentHeads : inkHeads, from, to, 0.16, hoverHead);
      }
      ctx.stroke(ink);
      ctx.fill(inkHeads);
      ctx.strokeStyle = P.accent;
      ctx.fillStyle = P.accent;
      ctx.stroke(accent);
      ctx.fill(accentHeads);
    }
    return incident;
  }

  /** Lock badges and cross-topic markers, in screen space, once titles show. */
  private placeDecor(seen: number[], incident: Map<number, number[]>): Decor[] {
    const { layout, view } = this;
    const out: Decor[] = [];
    if (!layout) return out;
    const { k } = view;
    const clear = (index: number, angle: number) => {
      const used = incident.get(index);
      return !used || used.every((a) => Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle))) > 0.7);
    };
    for (const i of seen) {
      const node = layout.nodes[i];
      if (node.kind !== 'card' || (!node.locked && node.crossDeps === 0)) continue;
      const sx = this.rx[i] * k + view.x;
      const sy = this.ry[i] * k + view.y;
      const big = node.state === 'doing' || node.state === 'waiting';
      const edge = (node.r + (big ? 5.4 : 3)) * k + 1.5;
      const place = (kind: Decor['kind'], first: number) => {
        const reach = edge + (kind === 'lock' ? BADGE_R : MARK_PX + 1);
        const angle = clear(i, first) ? first : first + Math.PI;
        out.push({ i, kind, x: sx + Math.cos(angle) * reach, y: sy + Math.sin(angle) * reach });
      };
      if (node.locked) place('lock', -Math.PI / 4);
      if (node.crossDeps > 0) place('cross', Math.PI / 4);
    }
    return out;
  }

  private paintDecor(decor: Decor[], spot: Uint8Array | null) {
    const { ctx, palette: P } = this;
    ctx.lineCap = 'round';
    for (const { i, kind, x, y } of decor) {
      ctx.globalAlpha = spot && !spot[i] ? DIM_ALPHA : 1;
      if (kind === 'lock') {
        ctx.fillStyle = P.paper;
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, BADGE_R - 0.6, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = P.ink;
        ctx.fillRect(x - 2.6, y - 0.4, 5.2, 3.8);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(x, y - 0.6, 1.8, Math.PI, TAU);
        ctx.stroke();
      } else {
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x - MARK_PX, y + MARK_PX);
        ctx.lineTo(x + MARK_PX, y - MARK_PX);
        ctx.moveTo(x - 1, y - MARK_PX);
        ctx.lineTo(x + MARK_PX, y - MARK_PX);
        ctx.lineTo(x + MARK_PX, y + 1);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Soft disc in the agent's colour behind each live node. */
  private paintHalos(held: number[], spot: Uint8Array | null) {
    const { ctx, layout, view } = this;
    if (!layout) return;
    for (const i of held) {
      const node = layout.nodes[i];
      if (!node.agent?.live) continue;
      ctx.globalAlpha = (spot && !spot[i] ? DIM_ALPHA : 1) * 0.18;
      ctx.fillStyle = node.agent.color;
      ctx.beginPath();
      ctx.arc(this.rx[i], this.ry[i], Math.max(node.r * 1.8, 11 / view.k), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** World radius of the agent ring: just outside the progress ring, 3 screen px thick. */
  private ringRadius(node: { r: number; state?: string }): number {
    const big = node.state === 'doing' || node.state === 'waiting';
    return node.r + (big ? 5.4 : 3) + 1.5 / this.view.k;
  }

  /**
   * One pill per held node with the agent's name, radially outward of the node. It keeps one
   * on-screen size at every zoom, and tries other sides before it would run off the canvas
   * or onto a node, a title or another tag.
   */
  private placeTags(
    held: number[],
    spot: Uint8Array | null,
    radii: Map<number, number>,
    mark: (x0: number, y0: number, x1: number, y1: number, disc?: { x: number; y: number; r: number }, value?: number) => void,
    taken: (x0: number, y0: number, x1: number, y1: number, tagsOnly?: boolean) => boolean,
  ) {
    const { ctx, palette: P, layout, view } = this;
    if (!layout || !held.length) return;
    const { k } = view;
    ctx.font = `600 10.5px ${this.sans}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const order = held.filter((i) => layout.nodes[i].agent).sort((a, b) => {
      const left = layout.nodes[a].agent!;
      const right = layout.nodes[b].agent!;
      const rank = (agent: typeof left) => (agent.name === this.spotlight ? 0 : agent.live ? 1 : 2);
      return (rank(left) - rank(right)) || left.name.localeCompare(right.name);
    });
    const offsets = [0, 0.7, -0.7, 1.4, -1.4, Math.PI, Math.PI + 0.7, Math.PI - 0.7];
    for (const i of order) {
      const node = layout.nodes[i];
      const agent = node.agent!;
      const sx = this.rx[i] * k + view.x;
      const sy = this.ry[i] * k + view.y;
      if (sx < 0 || sx > this.W || sy < 0 || sy > this.H) continue;
      const faulty = node.fault;
      const text = this.fitText(agent.name, TAG_MAX_TEXT);
      const w = this.width(text) + TAG_PAD * 2;
      const reach = (radii.get(i) ?? 0) + 2;
      const boxes = offsets.map((offset) => {
        const a = node.angle + offset;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const half = Math.abs(cos) * w / 2 + Math.abs(sin) * TAG_H / 2;
        const cx = sx + cos * (reach + half);
        const cy = sy + sin * (reach + half);
        return { x: cx - w / 2, y: cy - TAG_H / 2 };
      });
      const inside = (box: { x: number; y: number }) =>
        box.x >= 2 && box.y >= 2 && box.x + w <= this.W - 2 && box.y + TAG_H <= this.H - 2;
      const free = (box: { x: number; y: number }, tagsOnly: boolean) =>
        inside(box) && !taken(box.x - 1, box.y - 1, box.x + w + 1, box.y + TAG_H + 1, tagsOnly);
      const box = boxes.find((candidate) => free(candidate, false))
        ?? boxes.find((candidate) => free(candidate, true))
        ?? {
          x: Math.max(2, Math.min(this.W - w - 2, boxes[0].x)),
          y: Math.max(2, Math.min(this.H - TAG_H - 2, boxes[0].y)),
        };
      mark(box.x - 1, box.y - 1, box.x + w + 1, box.y + TAG_H + 1, undefined, 2);

      ctx.globalAlpha = spot && !spot[i] ? DIM_ALPHA : 1;
      ctx.fillStyle = faulty ? P.accent : agent.color;
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, w, TAG_H, TAG_H / 2);
      ctx.fill();
      ctx.fillStyle = textOn(faulty ? P.accent : agent.color, P.onInk, P.ink);
      ctx.fillText(text, box.x + TAG_PAD, box.y + TAG_H / 2 + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The ring just outside each held node, solid in the agent's colour. While the agent is working
   * a comet circles it: a head with a fading tail, one turn every COMET_TURN_MS (REQ-BOARD-055).
   * Under reduced motion the ring is dashed instead and nothing moves.
   */
  private paintRings(held: number[], now: number, spot: Uint8Array | null) {
    const { ctx, layout, view } = this;
    if (!layout) return;
    const { k } = view;
    const moving = !reducedMotion();
    for (const i of held) {
      const node = layout.nodes[i];
      const agent = node.agent;
      if (!agent) continue;
      const x = this.rx[i];
      const y = this.ry[i];
      const radius = this.ringRadius(node);
      const dimmed = spot && !spot[i];
      ctx.strokeStyle = agent.color;
      ctx.globalAlpha = dimmed ? DIM_ALPHA : 1;
      const comet = agent.live && moving;
      ctx.lineWidth = (comet ? 2 : 3) / k;
      if (agent.live && !moving) ctx.setLineDash([5 / k, 4 / k]);
      else ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      if (comet) {
        // Phase from the card id too, so two working cards do not circle in step.
        const offset = (node.key.length * 0.7 + i * 1.3) % TAU;
        const head = (now / COMET_TURN_MS) * TAU + offset;
        const orbit = radius + 3 / k;
        ctx.fillStyle = agent.color;
        for (let step = COMET_TAIL - 1; step >= 0; step--) {
          const a = head - step * 0.17;
          const fade = 1 - step / COMET_TAIL;
          ctx.globalAlpha = (dimmed ? DIM_ALPHA : 1) * fade;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * orbit, y + Math.sin(a) * orbit, (1.2 + 2.3 * fade) / k, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = dimmed ? DIM_ALPHA : 1;
      }
      if (spot && spot[i] && this.spotlight === agent.name) {
        ctx.lineWidth = 1.6 / k;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(x, y, radius + 7 / k, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawTopicNames(vx0: number, vy0: number, vx1: number, vy1: number, spot: Uint8Array | null) {
    const { ctx, palette: P, layout } = this;
    if (!layout) return;
    ctx.font = `600 11px ${this.sans}`;
    ctx.textBaseline = 'middle';
    let colour = '';
    for (let index = 0; index < layout.nodes.length; index++) {
      const node = layout.nodes[index];
      if (node.kind !== 'topic' || node.topic === null) continue;
      const cos = Math.cos(node.angle);
      const sin = Math.sin(node.angle);
      const midX = ((R_LABEL + R_TOPIC) / 2) * cos;
      const midY = ((R_LABEL + R_TOPIC) / 2) * sin;
      if (midX < vx0 - 60 || midX > vx1 + 60 || midY < vy0 - 60 || midY > vy1 + 60) continue;
      ctx.globalAlpha = spot && !spot[index] ? DIM_ALPHA : 1;
      const next = node.fault ? P.accent : P.ink;
      if (next !== colour) {
        ctx.fillStyle = next;
        colour = next;
      }
      const text = this.fitText(node.topic, R_TOPIC - 13 - (R_LABEL - 4));
      ctx.save();
      // Names read outward along the branch; on the left half they flip so they are never upside down.
      if (cos >= 0) {
        ctx.rotate(node.angle);
        ctx.textAlign = 'right';
        ctx.fillText(text, R_TOPIC - 13, 0);
      } else {
        ctx.rotate(node.angle + Math.PI);
        ctx.textAlign = 'left';
        ctx.fillText(text, -(R_TOPIC - 13), 0);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Agent name tags, then card titles, in screen space. A coarse occupancy grid keeps every
   * label off every node and off every other label; tags are placed first so they win.
   */
  private drawLabels(seen: number[], held: number[], spot: Uint8Array | null, decor: Decor[]) {
    const { ctx, palette: P, layout, view } = this;
    if (!layout) return;
    const { k } = view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const cols = Math.ceil(this.W / CELL) + 1;
    const rows = Math.ceil(this.H / CELL) + 1;
    if (this.occupancy.length < cols * rows) this.occupancy = new Uint8Array(cols * rows);
    else this.occupancy.fill(0, 0, cols * rows);
    const grid = this.occupancy;

    const mark = (
      x0: number, y0: number, x1: number, y1: number,
      disc?: { x: number; y: number; r: number }, value = 1,
    ) => {
      const c0 = Math.max(0, Math.floor(x0 / CELL));
      const c1 = Math.min(cols - 1, Math.floor(x1 / CELL));
      const r0 = Math.max(0, Math.floor(y0 / CELL));
      const r1 = Math.min(rows - 1, Math.floor(y1 / CELL));
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          if (disc && Math.hypot((col + 0.5) * CELL - disc.x, (row + 0.5) * CELL - disc.y) > disc.r) continue;
          grid[row * cols + col] = value;
        }
      }
    };
    /** `tagsOnly` ignores nodes and titles and only reports other name tags. */
    const taken = (x0: number, y0: number, x1: number, y1: number, tagsOnly = false) => {
      const c0 = Math.max(0, Math.floor(x0 / CELL));
      const c1 = Math.min(cols - 1, Math.floor(x1 / CELL));
      const r0 = Math.max(0, Math.floor(y0 / CELL));
      const r1 = Math.min(rows - 1, Math.floor(y1 / CELL));
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const cx = (col + 0.5) * CELL;
          const cy = (row + 0.5) * CELL;
          const filled = grid[row * cols + col];
          if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1 && filled && (!tagsOnly || filled === 2)) return true;
        }
      }
      return false;
    };

    const radii = new Map<number, number>();
    for (const i of seen) {
      const node = layout.nodes[i];
      const sx = this.rx[i] * k + view.x;
      const sy = this.ry[i] * k + view.y;
      let reach = (node.r + (node.kind === 'card' ? 7 : 2)) * k;
      // A held node carries its ring, which is part of what labels must stay clear of.
      if (node.agent) reach = Math.max(reach, this.ringRadius(node) * k + 3);
      radii.set(i, reach);
      mark(sx - reach, sy - reach, sx + reach, sy + reach, { x: sx, y: sy, r: reach });
    }

    for (const item of decor) {
      mark(item.x - BADGE_R - 1, item.y - BADGE_R - 1, item.x + BADGE_R + 1, item.y + BADGE_R + 1, { x: item.x, y: item.y, r: BADGE_R + 1 });
    }
    this.paintDecor(decor, spot);
    this.placeTags(held, spot, radii, mark, taken);
    if (k < TITLE_K) return;

    const rank: Record<string, number> = { waiting: 0, doing: 1, todo: 2, done: 3 };
    const cards = seen
      .filter((i) => layout.nodes[i].kind === 'card' && (!spot || spot[i]))
      .sort((a, b) => {
        const left = layout.nodes[a];
        const right = layout.nodes[b];
        return (rank[left.state ?? 'done'] - rank[right.state ?? 'done']) || ((left.number ?? 0) - (right.number ?? 0));
      })
      .slice(0, MAX_TITLES);

    ctx.font = `500 11.5px ${this.sans}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const lines = new Path2D();
    const buckets: Record<'accent' | 'ink' | 'muted', Array<[string, number, number]>> = { accent: [], ink: [], muted: [] };
    for (const i of cards) {
      const node = layout.nodes[i];
      const raw = node.title ?? '';
      const text = raw.length > 28 ? `${raw.slice(0, 27)}…` : raw;
      const textWidth = this.width(text);
      const sx = this.rx[i] * k + view.x;
      const sy = this.ry[i] * k + view.y;
      const reach = radii.get(i) ?? 0;
      const sides = Math.cos(node.angle) >= 0 ? [1, -1] : [-1, 1];
      for (const side of sides) {
        const x0 = side > 0 ? sx + reach + 3 : sx - reach - 3 - textWidth;
        if (taken(x0 - 2, sy - 8, x0 + textWidth + 2, sy + 8)) continue;
        mark(x0 - 2, sy - 8, x0 + textWidth + 2, sy + 8);
        lines.moveTo(sx + side * (node.r * k + 2), sy);
        lines.lineTo(side > 0 ? x0 - 3 : x0 + textWidth + 3, sy);
        const bucket = node.fault ? 'accent' : node.state === 'doing' ? 'ink' : 'muted';
        buckets[bucket].push([text, x0, sy + 0.5]);
        break;
      }
    }
    ctx.strokeStyle = P.faint;
    ctx.lineWidth = 1;
    ctx.stroke(lines);
    for (const name of ['accent', 'ink', 'muted'] as const) {
      ctx.fillStyle = P[name];
      for (const [text, x, y] of buckets[name]) ctx.fillText(text, x, y);
    }
  }
}
