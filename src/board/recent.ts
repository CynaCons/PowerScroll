import type { BoardCard, BoardData, BoardEvent } from '../types/data';
import { BOARD_COLUMNS } from './boardOps';

/** How far back the board's Recent filter looks (REQ-BOARD-073). */
export type RecentWindow = 'hour' | 'day' | 'week' | 'visit';

export const RECENT_DEFAULT: RecentWindow = 'day';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export const RECENT_WINDOWS: ReadonlyArray<{ id: RecentWindow; label: string; short: string; ms: number }> = [
  { id: 'hour', label: 'Last hour', short: '1 h', ms: HOUR },
  { id: 'day', label: 'Last 24 hours', short: '24 h', ms: DAY },
  { id: 'week', label: 'Last 7 days', short: '7 days', ms: 7 * DAY },
  // Since my last visit: the start comes from the stored visit; 24 hours when there is none.
  { id: 'visit', label: 'Since my last visit', short: 'since last visit', ms: DAY },
];

export function recentWindow(id: RecentWindow) {
  return RECENT_WINDOWS.find((item) => item.id === id) ?? RECENT_WINDOWS[1];
}

/** The start of the window: changes at or after it count as recent. */
export function recentSince(id: RecentWindow, now: number, lastVisit: number | null): number {
  if (id === 'visit' && lastVisit !== null) return lastVisit;
  return now - recentWindow(id).ms;
}

/** The latest change to a card: when, who, and in a few words what. */
export interface CardChange {
  at: number;
  /** Empty when the change predates the event log and only the timestamp is known. */
  actor: string;
  what: string;
}

const columnTitle = (id: string | undefined) => BOARD_COLUMNS.find((column) => column.id === id)?.title ?? id ?? '';

function describe(event: BoardEvent): string {
  switch (event.type) {
    case 'created': return 'created';
    case 'moved': return `moved to ${columnTitle(event.to)}`;
    case 'claimed': return 'claimed';
    case 'released': return 'released';
    case 'noted': return 'added a note';
    case 'checked': return 'ticked a task';
    case 'restored': return 'restored';
    case 'archived': return 'archived';
    default: return 'edited';
  }
}

/** A pure reorder (a move within the same column) changes nothing anyone needs to read about. */
function counts(event: BoardEvent): boolean {
  if (!event.cardId) return false;
  if (event.type === 'deleted' || event.type === 'left') return false;
  if (event.type === 'moved' && event.from === event.to) return false;
  return true;
}

/**
 * The latest counted change per card. The log keeps the last 500 events, so a card with no
 * counted event in it falls back to its own updatedAt (with no actor).
 */
export function lastChanges(board: BoardData): Map<string, CardChange> {
  const changes = new Map<string, CardChange>();
  for (const event of board.events) {
    if (!counts(event)) continue;
    const seen = changes.get(event.cardId!);
    if (seen && seen.at > event.at) continue;
    changes.set(event.cardId!, { at: event.at, actor: event.actor, what: describe(event) });
  }
  for (const card of board.cards) {
    if (!changes.has(card.id)) changes.set(card.id, { at: card.updatedAt, actor: '', what: 'changed' });
  }
  return changes;
}

export function isRecent(card: BoardCard, changes: Map<string, CardChange>, since: number): boolean {
  const change = changes.get(card.id);
  return (change?.at ?? card.updatedAt) >= since;
}
