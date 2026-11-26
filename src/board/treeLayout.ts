import type { BoardCard, BoardEvent } from '../types/data';
import { sameLabel } from '../components/board/lanes';

/** Geometry ported from the approved prototype: topics ring the hub, cards pack outward ring by ring. */
export const R_LABEL = 98;
export const R_TOPIC = 218;
export const R_CARD = 262;
export const DR = 38;
export const SP = 27;
export const GRID_CELL = 48;
/** Hit-test slack the grid is built for, in world units. */
const GRID_SLACK = 8;

export const NO_LABEL_TOPIC = 'No label';
const NO_LABEL_KEY = 't:__none__';

export type TreeKind = 'hub' | 'topic' | 'card';
export type TreeState = 'done' | 'doing' | 'waiting' | 'todo';

/** A connected agent that holds a card on this board. */
export interface TreeAgent {
  name: string;
  color: string;
  cardId: string;
  /** Acted within the last minute. */
  live: boolean;
}

export interface TreeNodeAgent {
  name: string;
  color: string;
  live: boolean;
}

export interface TreeNode {
  key: string;
  kind: TreeKind;
  x: number;
  y: number;
  r: number;
  angle: number;
  /** Index of the parent node, -1 for the hub. */
  parent: number;
  topic: string | null;
  cardId?: string;
  state?: TreeState;
  fault: boolean;
  checkTotal: number;
  checkDone: number;
  initials?: string;
  /** The connected agent holding this card. */
  agent?: TreeNodeAgent;
  title?: string;
  number?: number;
  /** Not ready: this card waits on a card that is not finished. */
  locked: boolean;
  /** Dependencies (either direction) that cross to another topic. */
  crossDeps: number;
  /** Card: queued, not locked, and next to pick up (first queued card of its topic, or its blockers are all done). */
  ready?: boolean;
  /** Topic: finished cards and all cards, for the progress arc. */
  doneCount?: number;
  cardCount?: number;
  /** Topic: radius of the "now" mark between finished and live work, and the wedge it spans; absent when one side is empty. */
  nowR?: number;
  span?: number;
}

/** One dependency seen from a card node: the node and card at the other end. */
export interface TreeRel {
  /** Node index of the other end. */
  other: number;
  cardId: string;
  topic: string;
  number: number;
  title: string;
  column: string;
  /** True when the hovered card waits on the other one; false when the other waits on it. */
  waitsOn: boolean;
  /** The other card is waiting for the owner. */
  accent: boolean;
}

export interface TreeLayout {
  nodes: TreeNode[];
  radius: number;
  signature: string;
  grid: Map<number, number[]>;
  /** Unfinished same-topic dependencies between two shown cards: [from (must finish), to (waits)] node indices. */
  edges: Array<[number, number]>;
  /** Per card node: every live dependency it takes part in, any topic. */
  related: Map<number, TreeRel[]>;
}

interface Item {
  card: BoardCard;
  fault: boolean;
  agent?: TreeNodeAgent;
}

interface Topic {
  key: string;
  name: string;
  items: Item[];
  fault: boolean;
}

const cellKey = (cx: number, cy: number) => (cx + 4096) * 8192 + (cy + 4096);

function initialsOf(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const parts = name.split(/[\s\-_.]+/).filter(Boolean);
  if (!parts.length) return undefined;
  const text = parts[1] ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
  return text.toUpperCase();
}

function checkCounts(card: BoardCard): [number, number] {
  let done = 0;
  for (const item of card.checklist) if (item.done) done++;
  return [done, card.checklist.length];
}

/** Topics in first-use order (the rule `boardLanes` uses), "No label" last; archived cards left out. */
function groupTopics(
  cards: BoardCard[],
  events: BoardEvent[],
  quiet: ReadonlySet<string>,
  held: ReadonlyMap<string, TreeAgent>,
): Topic[] {
  const live = cards.filter((card) => !card.archivedAt);
  const order: string[] = [];
  for (const card of [...live].sort((left, right) => left.createdAt - right.createdAt)) {
    for (const label of card.labels) if (!order.some((seen) => sameLabel(seen, label))) order.push(label);
  }
  const groups: BoardCard[][] = order.map(() => []);
  const loose: BoardCard[] = [];
  for (const card of live) {
    const first = card.labels[0];
    const index = first === undefined ? -1 : order.findIndex((seen) => sameLabel(seen, first));
    (index < 0 ? loose : groups[index]).push(card);
  }

  // Finish time: the last move to done, else the card's last update.
  const finished = new Map<string, number>();
  for (const event of events) {
    if (event.type === 'moved' && event.to === 'done' && event.cardId) finished.set(event.cardId, event.at);
  }
  const finishOf = (card: BoardCard) => finished.get(card.id) ?? card.updatedAt;
  const byOrder = (left: BoardCard, right: BoardCard) => left.order - right.order;

  const build = (key: string, name: string, list: BoardCard[]): Topic => {
    const column = (id: string) => list.filter((card) => card.column === id);
    const done = column('done').sort((left, right) => finishOf(left) - finishOf(right));
    const waiting = column('waiting').sort(byOrder);
    const doing = column('doing').sort(byOrder);
    const todo = column('todo').sort(byOrder);
    const isFault = (card: BoardCard) => card.column === 'waiting' || quiet.has(card.id);
    const holder = (card: BoardCard): TreeNodeAgent | undefined => {
      const agent = held.get(card.id);
      if (!agent || card.assignee !== agent.name) return undefined;
      // Quiet and waiting cards keep the fault look: their agent shows by name, not by motion.
      return { name: agent.name, color: agent.color, live: agent.live && !isFault(card) };
    };
    // Every live card gets its own node: done cards keep their time order, then waiting, doing, queued.
    const items: Item[] = [...done, ...waiting, ...doing, ...todo].map((card) => ({
      card, fault: isFault(card), agent: holder(card),
    }));
    return { key, name, items, fault: list.some(isFault) };
  };

  const topics = order.map((label, index) => build(`t:${label.trim().toLowerCase()}`, label, groups[index]));
  if (loose.length) topics.push(build(NO_LABEL_KEY, NO_LABEL_TOPIC, loose));
  return topics.filter((topic) => topic.items.length > 0);
}

/** What the dependency picture depends on: who waits on whom, and the state of what they wait on. */
function depsSignature(cards: BoardCard[]): string {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const parts: string[] = [];
  for (const card of cards) {
    if (card.archivedAt || !card.dependsOn?.length) continue;
    const ends = card.dependsOn.map((id) => {
      const target = byId.get(id);
      return target ? `${id}:${target.column}${target.archivedAt ? 'a' : ''}:${target.number}:${target.title}` : `${id}:x`;
    });
    parts.push(`${card.id}>${ends.join(',')}`);
  }
  return parts.join('\u0004');
}

function signatureOf(topics: Topic[], deps: string): string {
  return topics
    .map((topic) => {
      const parts = topic.items.map((item) => {
        const { card } = item;
        const [done, total] = checkCounts(card);
        const agent = item.agent ? `${item.agent.name}:${item.agent.color}:${item.agent.live ? 1 : 0}` : '';
        return `${card.id}|${card.column}|${done}/${total}|${card.assignee ?? ''}|${item.fault ? 1 : 0}|${agent}|${card.title}`;
      });
      return `${topic.name}${topic.fault ? '!' : ''}\u0001${parts.join('\u0002')}`;
    })
    .join('\u0003') + `\u0005${deps}`;
}

/** Dependency edges and per-card relations, indexed by node. Runs once per layout, never per frame. */
function linkDependencies(nodes: TreeNode[], cards: BoardCard[]) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const nodeOf = new Map<string, number>();
  nodes.forEach((node, index) => { if (node.kind === 'card' && node.cardId) nodeOf.set(node.cardId, index); });
  const finished = (card: BoardCard) => card.column === 'done' || Boolean(card.archivedAt);
  const edges: Array<[number, number]> = [];
  const related = new Map<number, TreeRel[]>();
  const push = (at: number, rel: TreeRel) => {
    const list = related.get(at);
    if (list) list.push(rel);
    else related.set(at, [rel]);
  };
  for (const card of cards) {
    if (card.archivedAt || !card.dependsOn?.length) continue;
    const to = nodeOf.get(card.id);
    if (to === undefined) continue;
    let locked = false;
    for (const id of new Set(card.dependsOn)) {
      const blocker = byId.get(id);
      if (!blocker || blocker.archivedAt) continue;
      const from = nodeOf.get(id);
      if (from === undefined || from === to) continue;
      if (!finished(blocker)) locked = true;
      const mine = nodes[to];
      const theirs = nodes[from];
      push(to, {
        other: from, cardId: blocker.id, topic: theirs.topic ?? '', number: blocker.number, title: blocker.title,
        column: blocker.column, waitsOn: true, accent: blocker.column === 'waiting',
      });
      push(from, {
        other: to, cardId: card.id, topic: mine.topic ?? '', number: card.number, title: card.title,
        column: card.column, waitsOn: false, accent: card.column === 'waiting',
      });
      if (mine.topic !== theirs.topic) {
        mine.crossDeps++;
        theirs.crossDeps++;
      } else if (!finished(blocker)) {
        edges.push([from, to]);
      }
    }
    if (locked && card.column !== 'done') nodes[to].locked = true;
  }
  return { edges, related };
}

/**
 * Per topic: the "now" radius between its outermost finished card and its innermost live one,
 * and which queued cards are ready next. Runs after dependencies so `locked` is known.
 */
function markProgress(nodes: TreeNode[], cards: BoardCard[]) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const topicOf = new Map<string, number>();
  nodes.forEach((node, index) => { if (node.kind === 'topic' && node.topic !== null) topicOf.set(node.topic, index); });
  const doneR = new Map<number, number>();
  const liveR = new Map<number, number>();
  const firstQueued = new Set<number>();
  nodes.forEach((node) => {
    if (node.kind !== 'card' || node.topic === null) return;
    const topic = topicOf.get(node.topic);
    if (topic === undefined) return;
    const radius = Math.hypot(node.x, node.y);
    if (node.state === 'done') doneR.set(topic, Math.max(doneR.get(topic) ?? 0, radius));
    else liveR.set(topic, Math.min(liveR.get(topic) ?? Infinity, radius));
    if (node.state === 'todo' && !node.locked) {
      const card = node.cardId ? byId.get(node.cardId) : undefined;
      const waited = Boolean(card?.dependsOn?.some((id) => byId.has(id)));
      // Nodes are pushed in board order within a ring, so the first unlocked queued node per topic is next up.
      if (!firstQueued.has(topic) || waited) node.ready = true;
      firstQueued.add(topic);
    }
  });
  for (const [topic, outer] of doneR) {
    const inner = liveR.get(topic);
    if (inner === undefined || inner <= outer) continue;
    nodes[topic].nowR = (outer + inner) / 2;
  }
}

function place(topics: Topic[], signature: string, cards: BoardCard[]): TreeLayout {
  const nodes: TreeNode[] = [{
    key: 'hub', kind: 'hub', x: 0, y: 0, r: 22, angle: 0, parent: -1, topic: null,
    fault: false, checkTotal: 0, checkDone: 0, locked: false, crossDeps: 0,
  }];
  const total = topics.reduce((sum, topic) => sum + 4 + topic.items.length, 0);
  let start = -Math.PI / 2;

  for (const topic of topics) {
    const width = (2 * Math.PI * (4 + topic.items.length)) / total;
    const mid = start + width / 2;
    start += width;
    const topicIndex = nodes.length;
    const doneCount = topic.items.filter((item) => item.card.column === 'done').length;
    nodes.push({
      key: topic.key, kind: 'topic', x: R_TOPIC * Math.cos(mid), y: R_TOPIC * Math.sin(mid), r: 8,
      angle: mid, parent: 0, topic: topic.name, fault: topic.fault, checkTotal: 0, checkDone: 0,
      locked: false, crossDeps: 0, doneCount, cardCount: topic.items.length, span: width,
    });

    const count = topic.items.length;
    const slotIndex = new Map(topic.items.map((item, i) => [item.card.id, i]));
    // Blockers that are drawn as arrows: same topic, not finished (archived cards are not items).
    const drawn: number[][] = topic.items.map((item, i) => {
      const found: number[] = [];
      for (const id of new Set(item.card.dependsOn ?? [])) {
        const j = slotIndex.get(id);
        if (j === undefined || j === i || topic.items[j].card.column === 'done') continue;
        found.push(j);
      }
      return found;
    });
    const ringOf = new Int32Array(count).fill(-1);
    const nodeOf = new Int32Array(count);
    const angleOf = new Float64Array(count);

    let previous = [{ index: topicIndex, a: mid }];
    let pending = topic.items.map((_, i) => i);
    for (let ring = 0; pending.length; ring++) {
      const radius = R_CARD + ring * DR;
      const geometric = Math.max(1, Math.floor((radius * width * 0.88) / SP));
      const capacity = Math.max(1, Math.min(geometric, ring + 1));
      // Ready: every blocker sits in an earlier ring. A cycle is broken by taking the first pending card.
      let ready = pending.filter((i) => drawn[i].every((j) => ringOf[j] >= 0));
      if (!ready.length) ready = [pending[0]];
      // Waiting cards go first so an arrow runs to the next ring; a fan may use the whole ring.
      const order = [...ready.filter((i) => drawn[i].length), ...ready.filter((i) => !drawn[i].length)];
      const row: Array<{ i: number; slots: number; big: boolean }> = [];
      let used = 0;
      for (const i of order) {
        const big = topic.items[i].card.column === 'doing' || topic.items[i].card.column === 'waiting';
        const slots = big ? 1.7 : 1;
        if (row.length && used + slots > (drawn[i].length ? geometric : capacity)) break;
        row.push({ i, slots, big });
        used += slots;
      }

      const step = SP / radius;
      const span = used * step;
      const first = mid - span / 2;
      // Sort key: a waiting card sits at the mean angle of its blockers, a free one at its even share of the row.
      const freeCount = row.filter((entry) => !drawn[entry.i].length).length;
      let freeSeen = 0;
      const keyed = row.map((entry) => {
        const placed = drawn[entry.i].filter((j) => ringOf[j] >= 0);
        let key: number;
        if (placed.length) key = placed.reduce((sum, j) => sum + angleOf[j], 0) / placed.length;
        else key = first + ((freeSeen++ + 0.5) / freeCount) * span;
        return { ...entry, key };
      });
      keyed.sort((left, right) => left.key - right.key || left.i - right.i);

      let consumed = 0;
      const current: Array<{ index: number; a: number }> = [];
      for (const { i, slots, big } of keyed) {
        const item = topic.items[i];
        const a = first + (consumed + slots / 2) * step;
        consumed += slots;
        let parent = previous[0];
        let chosen = false;
        // The tree line comes from the card this one waits on, when that card is one ring in.
        for (const j of drawn[i]) {
          if (ringOf[j] !== ring - 1) continue;
          const candidate = { index: nodeOf[j], a: angleOf[j] };
          if (!chosen || Math.abs(candidate.a - a) < Math.abs(parent.a - a)) parent = candidate;
          chosen = true;
        }
        if (!chosen) {
          for (const candidate of previous) {
            if (Math.abs(candidate.a - a) < Math.abs(parent.a - a)) parent = candidate;
          }
        }
        const base = {
          x: radius * Math.cos(a), y: radius * Math.sin(a), angle: a, parent: parent.index,
          topic: topic.name, checkTotal: 0, checkDone: 0, locked: false, crossDeps: 0,
        };
        const { card } = item;
        const [done, checks] = checkCounts(card);
        nodes.push({
          ...base, key: card.id, kind: 'card', r: big ? 12 : 6, cardId: card.id, state: card.column,
          fault: item.fault, checkDone: done, checkTotal: checks, number: card.number, title: card.title,
          initials: card.column === 'doing' || card.column === 'waiting' ? initialsOf(card.assignee) : undefined,
          agent: item.agent,
        });
        current.push({ index: nodes.length - 1, a });
        nodeOf[i] = nodes.length - 1;
        angleOf[i] = a;
      }
      for (const { i } of row) ringOf[i] = ring;
      pending = pending.filter((i) => ringOf[i] < 0);
      previous = current;
    }
  }

  const { edges, related } = linkDependencies(nodes, cards);
  markProgress(nodes, cards);

  const grid = new Map<number, number[]>();
  let radius = 0;
  nodes.forEach((node, index) => {
    radius = Math.max(radius, Math.hypot(node.x, node.y) + node.r);
    if (node.kind === 'hub') return;
    const reach = node.r + GRID_SLACK;
    const x0 = Math.floor((node.x - reach) / GRID_CELL);
    const x1 = Math.floor((node.x + reach) / GRID_CELL);
    const y0 = Math.floor((node.y - reach) / GRID_CELL);
    const y1 = Math.floor((node.y + reach) / GRID_CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = cellKey(cx, cy);
        const bucket = grid.get(key);
        if (bucket) bucket.push(index);
        else grid.set(key, [index]);
      }
    }
  });
  return { nodes, radius, signature, grid, edges, related };
}

/**
 * The board changes on every note and event; most of those do not change the
 * picture. The layouter keeps the last layout and hands back the very same
 * object while the signature of what is drawn is unchanged.
 */
export function createTreeLayouter() {
  let last: TreeLayout | null = null;
  return (
    cards: BoardCard[],
    events: BoardEvent[],
    quietCardIds: ReadonlySet<string>,
    agents: readonly TreeAgent[] = [],
  ): TreeLayout => {
    const held = new Map(agents.map((agent) => [agent.cardId, agent]));
    const topics = groupTopics(cards, events, quietCardIds, held);
    const signature = signatureOf(topics, depsSignature(cards));
    if (last && last.signature === signature) return last;
    last = place(topics, signature, cards);
    return last;
  };
}

/** The node under a world point, or -1. One grid cell is read; `slack` widens each node's reach (max 8). */
export function nodeAt(layout: TreeLayout, worldX: number, worldY: number, slack = 0): number {
  const bucket = layout.grid.get(cellKey(Math.floor(worldX / GRID_CELL), Math.floor(worldY / GRID_CELL)));
  if (!bucket) return -1;
  const extra = Math.min(slack, GRID_SLACK);
  let best = -1;
  let bestDistance = Infinity;
  for (const index of bucket) {
    const node = layout.nodes[index];
    const distance = Math.hypot(node.x - worldX, node.y - worldY);
    if (distance <= node.r + extra && distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}
