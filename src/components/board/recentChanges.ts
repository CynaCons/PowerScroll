import { createContext, useContext } from 'react';
import type { CardChange } from '../../board/recent';

/** While the Recent filter is on: each card's latest change, for the line on its face (REQ-BOARD-073). */
export const RecentChangesContext = createContext<Map<string, CardChange> | null>(null);

export function useRecentChange(cardId: string): CardChange | undefined {
  return useContext(RecentChangesContext)?.get(cardId);
}
