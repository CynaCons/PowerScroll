import { create } from 'zustand';

export const AGENT_ACTIVE_MS = 60_000;
export const AGENT_RECENT_MS = 30 * 60_000;
export const AGENT_TICK_MS = 5_000;

export interface ConnectedAgent {
  label: string;
  role: string;
  connectedAt: number;
}

export interface AgentActorState {
  lastActionAt: number;
  cardId?: string;
  boardId?: string;
  status?: string;
}

interface AgentPresenceState {
  connected: ConnectedAgent[];
  /** True once the bridge hub has sent at least one agent list. */
  presenceSeen: boolean;
  actors: Record<string, AgentActorState>;
  /** Clock used by the live board. Overridable from tests via `setNow`. */
  now: number;
  clockOverride: number | null;
  setConnected: (agents: ConnectedAgent[]) => void;
  recordAction: (
    actor: string,
    info?: { cardId?: string; boardId?: string; status?: string },
  ) => void;
  setNow: (ms: number) => void;
  clearNow: () => void;
  tick: () => void;
}

function wallClock(): number {
  return Date.now();
}

export const useAgentPresenceStore = create<AgentPresenceState>((set, get) => ({
  connected: [],
  presenceSeen: false,
  actors: {},
  now: wallClock(),
  clockOverride: null,

  setConnected: (agents) =>
    set({
      presenceSeen: true,
      connected: agents
        .filter((agent) => typeof agent?.label === 'string' && agent.label.length > 0)
        .map((agent) => ({
          label: agent.label,
          role: typeof agent.role === 'string' ? agent.role : 'agent',
          connectedAt: typeof agent.connectedAt === 'number' ? agent.connectedAt : wallClock(),
        })),
    }),

  recordAction: (actor, info = {}) => {
    if (!actor) return;
    const at = get().clockOverride ?? wallClock();
    set((state) => {
      const previous = state.actors[actor] ?? { lastActionAt: at };
      return {
        now: at,
        actors: {
          ...state.actors,
          [actor]: {
            lastActionAt: at,
            cardId: info.cardId !== undefined ? info.cardId : previous.cardId,
            boardId: info.boardId !== undefined ? info.boardId : previous.boardId,
            status: info.status !== undefined ? info.status : previous.status,
          },
        },
      };
    });
  },

  setNow: (ms) => set({ clockOverride: ms, now: ms }),
  clearNow: () => set({ clockOverride: null, now: wallClock() }),
  tick: () => {
    const { clockOverride } = get();
    set({ now: clockOverride ?? wallClock() });
  },
}));

if (typeof window !== 'undefined') {
  (window as unknown as { __POWERNOTE_AGENT_PRESENCE__: typeof useAgentPresenceStore })
    .__POWERNOTE_AGENT_PRESENCE__ = useAgentPresenceStore;
}
