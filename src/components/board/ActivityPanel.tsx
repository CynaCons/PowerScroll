import { useEffect, useRef, useState } from 'react';
import type { BoardData, BoardEvent } from '../../types/data';
import { BOARD_COLUMNS } from '../../board/boardOps';
import { avatarColor, avatarInitial, displayName, relativeTime } from './boardUi';

function eventText(event: BoardEvent, board: BoardData): string {
  const card = board.cards.find((item) => item.id === event.cardId);
  const cardNumber = card ? `#${card.number}` : 'a card';
  const destination = BOARD_COLUMNS.find((column) => column.id === event.to)?.title;

  switch (event.type) {
    case 'created':
      return `created ${cardNumber}`;
    case 'moved':
      return `moved ${cardNumber} to ${destination}`;
    case 'noted':
      return `noted on ${cardNumber}`;
    case 'checked':
      return `ticked ${event.text ?? 'a checklist item'} on ${cardNumber}`;
    case 'claimed':
      return `claimed ${cardNumber}`;
    case 'released':
      return `released ${cardNumber}`;
    case 'deleted':
      return `deleted ${cardNumber}`;
    case 'archived':
      return `archived ${cardNumber}`;
    case 'restored':
      return `restored ${cardNumber}`;
    case 'left':
      return event.text ? `left — ${event.text}` : 'left';
    default:
      return `updated ${cardNumber}`;
  }
}

export function ActivityPanel({ board }: { board: BoardData }) {
  const baseline = useRef<number | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    const latest = board.events[board.events.length - 1]?.seq ?? 0;
    if (baseline.current === null) {
      baseline.current = latest;
      return;
    }
    const arrived = board.events
      .filter((event) => event.seq > (baseline.current ?? 0))
      .map((event) => event.seq);
    baseline.current = latest;
    if (!arrived.length) return;
    setFresh((current) => new Set([...current, ...arrived]));
  }, [board.events]);

  return (
    <aside className="board-activity" aria-label="Activity">
      <header className="board-activity__header">
        <h2>Activity</h2>
        <span className="board-live-dot" data-testid="board-activity-live" title="Live" />
      </header>
      <ol className="board-activity__list">
        {board.events
          .slice(-50)
          .reverse()
          .map((event) => (
            <li
              key={event.seq}
              className={`board-activity__item${fresh.has(event.seq) ? ' board-activity__item--new' : ''}`}
            >
              <span
                className="board-avatar board-avatar--small"
                style={{ backgroundColor: avatarColor(event.actor) }}
              >
                {avatarInitial(event.actor)}
              </span>
              <p>
                <strong>{displayName(event.actor)}</strong> {eventText(event, board)}
                <time>{relativeTime(event.at)}</time>
              </p>
            </li>
          ))}
      </ol>
    </aside>
  );
}
