import type { BoardCard, BoardEvent } from '../types/data';
import { sameLabel } from '../components/board/lanes';

/** Geometry ported from the approved prototype: topics ring the hub, cards pack outward ring by ring. */
export const R_LABEL = 98;
export const R_TOPIC = 218;
export const R_CARD = 262;
export const DR = 38;
export const SP = 27;
export const DONE_SHOWN = 6;
export const QUEUED_SHOWN = 8;
export const GRID_CELL = 48;
/** Hit-test slack the grid is built for, in world units. */
const GRID_SLACK = 8;

export const NO_LABEL_TOPIC = 'No label';
const NO_LABEL_KEY = 't:__none__';

export type TreeKind = 'hub' | 'topic' | 'fold' | 'more' | 'card';
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
  count?: number;
  checkTotal: number;
  checkDone: number;
  initials?: string;
  /** The connected agent holding this card. */
  agent?: TreeNodeAgent;
  title?: string;
  number?: number;
}

export interface TreeLayout {
  nodes: TreeNode[];
  radius: number;
  signature: string;
  grid: Map<number, number[]>;
}

type Item =
  | { kind: 'fold' | 'more'; count: number }
  | { kind: 'card'; card: BoardCard; fault: boolean; agent?: TreeNodeAgent };

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
    // A card an agent holds is never folded away: it takes one of the shown slots.
    const shown = (pool: BoardCard[], limit: number, newest: boolean) => {
      const keep = pool.filter((card) => holder(card));
      const free = Math.max(0, limit - keep.length);
      const rest = pool.filter((card) => !holder(card));
      const chosen = new Set([...keep, ...(newest ? rest.slice(rest.length - free) : rest.slice(0, free))]);
      return pool.filter((card) => chosen.has(card));
    };
    const doneShown = shown(done, DONE_SHOWN, true);
    const todoShown = shown(todo, QUEUED_SHOWN, false);
    const items: Item[] = [];
    if (done.length > doneShown.length) items.push({ kind: 'fold', count: done.length - doneShown.length });
    for (const card of [...doneShown, ...waiting, ...doing, ...todoShown]) {
      items.push({ kind: 'card', card, fault: isFault(card), agent: holder(card) });
    }
    if (todo.length > todoShown.length) items.push({ kind: 'more', count: todo.length - todoShown.length });
    return { key, name, items, fault: list.some(isFault) };
  };

  const topics = order.map((label, index) => build(`t:${label.trim().toLowerCase()}`, label, groups[index]));
  if (loose.length) topics.push(build(NO_LABEL_KEY, NO_LABEL_TOPIC, loose));
  return topics.filter((topic) => topic.items.length > 0);
}

function signatureOf(topics: Topic[]): string {
  return topics
    .map((topic) => {
      const parts = topic.items.map((item) => {
        if (item.kind !== 'card') return `${item.kind}${item.count}`;
        const { card } = item;
        const [done, total] = checkCounts(card);
        const agent = item.agent ? `${item.agent.name}:${item.agent.color}:${item.agent.live ? 1 : 0}` : '';
        return `${card.id}|${card.column}|${done}/${total}|${card.assignee ?? ''}|${item.fault ? 1 : 0}|${agent}|${card.title}`;
      });
      return `${topic.name}${topic.fault ? '!' : ''}\u0001${parts.join('\u0002')}`;
    })
    .join('\u0003');
}

function place(topics: Topic[], signature: string): TreeLayout {
  const nodes: TreeNode[] = [{
    key: 'hub', kind: 'hub', x: 0, y: 0, r: 22, angle: 0, parent: -1, topic: null,
    fault: false, checkTotal: 0, checkDone: 0,
  }];
  const total = topics.reduce((sum, topic) => sum + 4 + topic.items.length, 0);
  let start = -Math.PI / 2;

  for (const topic of topics) {
    const width = (2 * Math.PI * (4 + topic.items.length)) / total;
    const mid = start + width / 2;
    start += width;
    const topicIndex = nodes.length;
    nodes.push({
      key: topic.key, kind: 'topic', x: R_TOPIC * Math.cos(mid), y: R_TOPIC * Math.sin(mid), r: 8,
      angle: mid, parent: 0, topic: topic.name, fault: topic.fault, checkTotal: 0, checkDone: 0,
    });

    let previous = [{ index: topicIndex, a: mid }];
    let cursor = 0;
    for (let ring = 0; cursor < topic.items.length; ring++) {
      const radius = R_CARD + ring * DR;
      const capacity = Math.max(1, Math.min(Math.floor((radius * width * 0.88) / SP), ring + 1));
      const row: Array<{ item: Item; slots: number; big: boolean }> = [];
      let used = 0;
      while (cursor < topic.items.length) {
        const item = topic.items[cursor];
        const big = item.kind === 'card' && (item.card.column === 'doing' || item.card.column === 'waiting');
        const slots = big ? 1.7 : 1;
        if (row.length && used + slots > capacity) break;
        row.push({ item, slots, big });
        used += slots;
        cursor++;
      }
      const step = SP / radius;
      let consumed = 0;
      const first = mid - (used * step) / 2;
      const current: Array<{ index: number; a: number }> = [];
      for (const { item, slots, big } of row) {
        const a = first + (consumed + slots / 2) * step;
        consumed += slots;
        let parent = previous[0];
        for (const candidate of previous) {
          if (Math.abs(candidate.a - a) < Math.abs(parent.a - a)) parent = candidate;
        }
        const base = {
          x: radius * Math.cos(a), y: radius * Math.sin(a), angle: a, parent: parent.index,
          topic: topic.name, checkTotal: 0, checkDone: 0,
        };
        if (item.kind === 'card') {
          const { card } = item;
          const [done, count] = checkCounts(card);
          nodes.push({
            ...base, key: card.id, kind: 'card', r: big ? 12 : 6, cardId: card.id, state: card.column,
            fault: item.fault, checkDone: done, checkTotal: count, number: card.number, title: card.title,
            initials: card.column === 'doing' || card.column === 'waiting' ? initialsOf(card.assignee) : undefined,
            agent: item.agent,
          });
        } else {
          nodes.push({
            ...base, key: `${item.kind === 'fold' ? 'f' : 'm'}:${topic.key}`, kind: item.kind, r: 9,
            fault: false, count: item.count,
          });
        }
        current.push({ index: nodes.length - 1, a });
      }
      previous = current;
    }
  }

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
  return { nodes, radius, signature, grid };
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
    const signature = signatureOf(topics);
    if (last && last.signature === signature) return last;
    last = place(topics, signature);
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
