import type { BoardColumnId, BoardEvent } from '../../types/data';

export const AVATAR_PALETTE = [
  '#2563eb',
  '#0f766e',
  '#7c3aed',
  '#c2410c',
  '#0e7490',
  '#a21caf',
  '#4d7c0f',
];

export function displayName(name?: string): string {
  return name === 'you' ? 'You' : name ?? 'Unassigned';
}

export function avatarColor(name?: string): string {
  if (!name) return '#C3CBC9';
  if (name === 'you') return '#14181A';

  const hash = Array.from(name).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );

  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function avatarInitial(name?: string): string {
  return name ? displayName(name).slice(0, 1).toUpperCase() : '·';
}

export function relativeTime(at: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000));

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  return `${Math.floor(hours / 24)} d ago`;
}

export function statusClass(column: BoardColumnId): string {
  return `board-status--${column}`;
}

export function colorWithAlpha(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return `rgba(20, 24, 26, ${alpha})`;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * Keeps only the last of each run of adjacent 'updated' events by the same actor
 * on the same card. Boards edited before v0.86.1 logged one per keystroke.
 */
export function collapseEditRuns(events: BoardEvent[]): BoardEvent[] {
  return events.filter((event, index) => {
    const next = events[index + 1];
    return !(
      next
      && event.type === 'updated'
      && next.type === 'updated'
      && next.actor === event.actor
      && next.cardId === event.cardId
    );
  });
}

/** True when the system asks for less motion; board animations are skipped then. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** Soft label colours: a tint and a readable ink. Orange stays reserved for faults. */
const LABEL_PALETTE: ReadonlyArray<{ background: string; color: string }> = [
  { background: '#DBEAFE', color: '#1E40AF' },
  { background: '#CCFBF1', color: '#115E59' },
  { background: '#EDE9FE', color: '#5B21B6' },
  { background: '#DCFCE7', color: '#166534' },
  { background: '#FCE7F3', color: '#9D174D' },
  { background: '#ECFCCB', color: '#3F6212' },
  { background: '#FEF9C3', color: '#854D0E' },
  { background: '#E2E8F0', color: '#334155' },
];

function hashLabel(label: string): number {
  let hash = 2166136261;
  for (const character of label.trim().toLowerCase()) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

export type LabelColor = { background: string; color: string };

/**
 * Colours for every label on a board. Labels take colours in the order they
 * were first used: each gets its name's colour unless an earlier label already
 * has it, then the next free one, so up to eight labels on a board all differ
 * and a label keeps its colour as later ones come and go.
 */
export function boardLabelColors(cards: ReadonlyArray<{ labels: string[]; createdAt: number }>): Map<string, LabelColor> {
  const colors = new Map<string, LabelColor>();
  const taken = new Set<number>();
  const ordered = [...cards].sort((left, right) => left.createdAt - right.createdAt);
  for (const card of ordered) {
    for (const label of card.labels) {
      const key = label.trim().toLowerCase();
      if (colors.has(key)) continue;
      let slot = hashLabel(label) % LABEL_PALETTE.length;
      if (taken.size < LABEL_PALETTE.length) {
        while (taken.has(slot)) slot = (slot + 1) % LABEL_PALETTE.length;
      }
      taken.add(slot);
      colors.set(key, LABEL_PALETTE[slot]);
    }
  }
  return colors;
}

/** A label's colour from the board's map, or its name's colour outside a board. */
export function labelColor(label: string, colors?: Map<string, LabelColor>): LabelColor {
  return colors?.get(label.trim().toLowerCase()) ?? LABEL_PALETTE[hashLabel(label) % LABEL_PALETTE.length];
}
