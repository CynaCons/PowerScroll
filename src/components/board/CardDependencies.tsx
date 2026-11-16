import { useState } from 'react';
import { Lock, X } from 'lucide-react';
import type { BoardCard, BoardData } from '../../types/data';
import {
  blockersOf,
  dependenciesOf,
  dependencyProblem,
  dependentsOf,
  liveCards,
  moveCard,
  setDependencies,
} from '../../board/boardOps';
import { displayName } from './boardUi';

const ACTOR = 'you';
const MAX_OPTIONS = 8;

interface CardDependenciesProps {
  card: BoardCard;
  board: BoardData;
  edit: (fn: (board: BoardData) => BoardData) => void;
  onOpenCard?: (cardId: string) => void;
}

/** Short column names: the side panel is narrow. */
const SHORT_TITLES: Record<string, string> = { todo: 'To do', doing: 'In progress', waiting: 'Waiting', done: 'Done' };

function columnTitle(card: BoardCard): string {
  return SHORT_TITLES[card.column] ?? card.column;
}

/** Cards that match what was typed: a number ("43" or "#43") or part of a title. */
function matches(card: BoardCard, query: string): boolean {
  const needle = query.trim().toLowerCase().replace(/^#/, '');
  if (!needle) return false;
  return String(card.number) === needle || card.title.toLowerCase().includes(needle);
}

/** Details section: what the card waits on, what waits on it, and how to add or break a link (REQ-BOARD-063). */
export function CardDependencies({ card, board, edit, onOpenCard }: CardDependenciesProps) {
  const [query, setQuery] = useState('');
  const waitsOn = dependenciesOf(board, card);
  const blockers = blockersOf(board, card);
  const dependents = dependentsOf(board, card);
  const linked = new Set(waitsOn.map((item) => item.id));
  const options = liveCards(board.cards)
    .filter((item) => item.id !== card.id && !linked.has(item.id) && matches(item, query))
    .slice(0, MAX_OPTIONS)
    .map((item) => ({ item, problem: dependencyProblem(board, card.id, item.id) }));

  const change = (args: { add?: string[]; remove?: string[] }) => {
    try {
      edit((current) => setDependencies(current, { cardId: card.id, ...args }, ACTOR, Date.now()));
    } catch {
      // A loop or a card removed meanwhile: the list shows the real state.
    }
  };
  const add = (id: string) => {
    setQuery('');
    change({ add: [id] });
  };
  const startAnyway = () => {
    try {
      edit((current) => moveCard(current, {
        cardId: card.id,
        to: 'doing',
        index: card.order,
        force: true,
      }, ACTOR, Date.now()));
    } catch {
      // Archived meanwhile.
    }
  };

  const row = (item: BoardCard, onRemove?: () => void) => (
    <li key={item.id} className="board-deps__row" data-testid={`card-dep-${item.number}`}>
      <button
        type="button"
        className="board-deps__open"
        disabled={!onOpenCard}
        onClick={() => onOpenCard?.(item.id)}
      >
        <span className="board-card__number">#{item.number}</span>
        <span className="board-deps__title" title={item.title}>{item.title}</span>
        <span className="board-deps__meta">
          {columnTitle(item)}{item.assignee ? ` · ${displayName(item.assignee)}` : ''}
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          className="board-deps__remove"
          aria-label={`Stop waiting on #${item.number}`}
          onClick={onRemove}
        >
          <X size={13} />
        </button>
      )}
    </li>
  );

  return (
    <section className="board-overlay__section board-deps" data-testid="card-dependencies">
      <h2>Waits on</h2>
      {blockers.length > 0 && card.column !== 'done' && (
        <div className="board-deps__blocked" data-testid="card-dep-blocked">
          <span className="board-deps__blocked-text">
            <Lock size={13} />
            {`Can’t start yet: waits on ${blockers.map((item) => `#${item.number}`).join(', ')}`}
          </span>
          {card.column !== 'doing' && (
            <button type="button" className="board-button" data-testid="card-dep-start" onClick={startAnyway}>
              Start anyway
            </button>
          )}
        </div>
      )}
      {waitsOn.length > 0 && (
        <ul className="board-deps__list" data-testid="card-dep-list">
          {waitsOn.map((item) => row(item, () => change({ remove: [item.id] })))}
        </ul>
      )}
      <input
        className="board-deps__input"
        aria-label="Add a card to wait on"
        data-testid="card-dep-input"
        placeholder="Add a card by number or title"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const first = options.find((option) => !option.problem);
          if (first) add(first.item.id);
        }}
      />
      {options.length > 0 && (
        <ul className="board-deps__options" role="listbox" aria-label="Cards to wait on">
          {options.map(({ item, problem }) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                aria-disabled={Boolean(problem)}
                disabled={Boolean(problem)}
                title={problem ?? undefined}
                className={`board-deps__option${problem ? ' board-deps__option--blocked' : ''}`}
                data-testid={`card-dep-option-${item.number}`}
                onClick={() => add(item.id)}
              >
                <span className="board-card__number">#{item.number}</span>
                <span className="board-deps__title" title={item.title}>{item.title}</span>
                {problem && <span className="board-deps__reason">{problem}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {dependents.length > 0 && (
        <>
          <h2 className="board-deps__subhead">Waiting on this card</h2>
          <ul className="board-deps__list" data-testid="card-dep-dependents">
            {dependents.map((item) => row(item))}
          </ul>
        </>
      )}
    </section>
  );
}
