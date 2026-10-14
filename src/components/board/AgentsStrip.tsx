import type { BoardCard } from '../../types/data';
import {
  AGENT_ACTIVE_MS,
  type AgentActorState,
  type ConnectedAgent,
} from '../../stores/useAgentPresenceStore';
import {
  avatarColor,
  avatarInitial,
  colorWithAlpha,
  displayName,
} from './boardUi';

export interface AgentChipModel {
  name: string;
  color: string;
  active: boolean;
  subtitle: string;
}

export function agentChips(
  cards: BoardCard[],
  connected: ConnectedAgent[],
  actors: Record<string, AgentActorState>,
  now: number,
  boardId: string,
  presenceSeen: boolean,
): AgentChipModel[] {
  const names = new Set<string>();
  for (const agent of connected) names.add(agent.label);
  for (const [name, actor] of Object.entries(actors)) {
    if (name === 'you') continue;
    if (actor.boardId === boardId && now - actor.lastActionAt <= 30 * 60_000) {
      names.add(name);
    }
  }
  names.delete('you');

  return [...names].sort().map((name) => {
    const actor = actors[name];
    const color = avatarColor(name);
    const card = actor?.cardId
      ? cards.find((item) => item.id === actor.cardId)
      : undefined;
    const actedRecently = Boolean(
      actor && now - actor.lastActionAt <= AGENT_ACTIVE_MS,
    );
    // Names come from `me` on each call and need not equal the process label,
    // so only an empty agent list counts as everyone having left.
    const disconnected = presenceSeen && connected.length === 0;
    const active = Boolean(actedRecently && card && !disconnected);
    const quietMin = actor
      ? Math.max(0, Math.floor((now - actor.lastActionAt) / 60_000))
      : 0;

    let subtitle = actor?.status ?? 'connected';
    if (active && card) subtitle = `working on #${card.number}`;
    else if (card && quietMin >= 1) subtitle = `on #${card.number} · quiet ${quietMin} min`;
    else if (card) subtitle = `on #${card.number}`;
    else if (actor?.status) subtitle = actor.status;

    return { name, color, active, subtitle };
  });
}

export function AgentsStrip({ chips }: { chips: AgentChipModel[] }) {
  if (chips.length === 0) return null;

  return (
    <div className="board-agents" data-testid="board-agents">
      {chips.map((chip) => (
        <div
          key={chip.name}
          className={`board-agent-chip${chip.active ? ' board-agent-chip--active' : ''}`}
          data-testid={`board-agent-${chip.name}`}
          data-active={chip.active ? 'true' : 'false'}
          style={{
            ['--agent-color' as string]: chip.color,
            ['--agent-glow' as string]: colorWithAlpha(chip.color, 0.22),
          }}
        >
          <span
            className="board-avatar board-avatar--medium"
            style={{ backgroundColor: chip.color }}
          >
            {avatarInitial(chip.name)}
          </span>
          <span className="board-agent-chip__text">
            <strong>{displayName(chip.name)}</strong>
            <span>{chip.subtitle}</span>
          </span>
          <span
            className={`board-agent-dot${chip.active ? ' board-agent-dot--active' : ' board-agent-dot--idle'}`}
          />
        </div>
      ))}
    </div>
  );
}
