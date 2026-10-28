import { create } from 'zustand';
import type { SearchScope } from '../search/searchIndex';

/**
 * Where a chosen result should land once its page is showing. The canvas
 * (a block) and the board (a card) each pick up their own kind, because the
 * view that can do it may only mount after the page switch.
 */
export interface SearchReveal {
  kind: 'node' | 'card';
  pageId: string;
  id: string;
}

interface SearchState {
  open: boolean;
  scope: SearchScope;
  /** Bumped on every open so a repeated Ctrl+F refocuses the field. */
  focusTick: number;
  reveal: SearchReveal | null;
  openSearch: (scope: SearchScope) => void;
  setScope: (scope: SearchScope) => void;
  close: () => void;
  setReveal: (reveal: SearchReveal | null) => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  open: false,
  scope: 'notebook',
  focusTick: 0,
  reveal: null,
  openSearch: (scope) => set((s) => ({ open: true, scope, focusTick: s.focusTick + 1 })),
  setScope: (scope) => set({ scope }),
  close: () => set({ open: false }),
  setReveal: (reveal) => set({ reveal }),
}));
