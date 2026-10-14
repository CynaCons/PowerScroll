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
    default:
      return `updated ${cardNumber}`;
  }
}

export function ActivityPanel({ board }: { board: BoardData }) {
  return (
    <aside className="board-activity" aria-label="Activity">
      <header className="board-activity__header">
        <h2>Activity</h2>
      </header>
      {/* Reserved for the live agent strip that follows this repair pass. */}
      <div className="board-activity__agents" aria-label="Agents" />
      <ol className="board-activity__list">
        {board.events
          .slice(-50)
          .reverse()
          .map((event) => (
            <li key={event.seq} className="board-activity__item">
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
