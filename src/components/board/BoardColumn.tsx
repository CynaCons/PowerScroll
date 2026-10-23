import { Plus } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BoardCard, BoardColumnId } from '../../types/data';
import { BoardCardFace } from './BoardCardFace';
import { avatarColor, prefersReducedMotion } from './boardUi';
import type { Lane } from './lanes';

/** Where the dragged copy was when it was let go, so the card can glide from there. */
export interface CardLanding {
  cardId: string;
  left: number;
  top: number;
}

const SLIDE_MS = 160;
const LAND_MS = 200;

/** A lane as one column shows it: the lane's cards in this column. */
export interface ColumnLane extends Lane {
  collapsed: boolean;
  /** The lane's cards across all columns, for its title. */
  total: number;
}

interface BoardColumnProps {
  lanes: ColumnLane[];
  /** Cards in this column, each once, for the header count. */
  count: number;
  column: { id: BoardColumnId; title: string };
  /** Lanes have header bars when the board has labels; each column keeps the row under them (REQ-BOARD-043). */
  showLaneTitles?: boolean;
  draggingCardId?: string;
  dropLane?: string;
  dropIndex?: number;
  /** Height of the card being dragged, so the landing slot matches it. */
  dropHeight?: number;
  /** Slide cards to their new places instead of jumping (during and right after a drag). */
  animate?: boolean;
  landing?: CardLanding | null;
  onLanded?: () => void;
  activeCardIds?: Set<string>;
  fadingCardIds?: Set<string>;
  flashingCardIds?: Set<string>;
  onCreate: (title: string) => void;
  onOpen: (card: BoardCard) => void;
  onCardPointerDown: (card: BoardCard, event: React.PointerEvent<HTMLButtonElement>, lane: string) => void;
  onCardPointerUp: (card: BoardCard) => void;
  onCardKeyDown: (card: BoardCard, event: React.KeyboardEvent<HTMLButtonElement>) => void;
  spotlightName?: string | null;
  onClearDone?: () => void;
}

export function BoardColumn({
  lanes,
  count,
  column,
  showLaneTitles = false,
  draggingCardId,
  dropLane,
  dropIndex,
  dropHeight,
  animate = false,
  landing = null,
  onLanded,
  activeCardIds,
  fadingCardIds,
  flashingCardIds,
  onCreate,
  onOpen,
  onCardPointerDown,
  onCardPointerUp,
  onCardKeyDown,
  spotlightName = null,
  onClearDone,
}: BoardColumnProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);

  // FLIP: remember where each card sat; when a drag shifts them, start each one
  // at its old place and let it slide to the new one.
  const list = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('[data-flip]') ?? [])];
    const next = new Map<string, number>();
    const reduce = prefersReducedMotion();
    for (const row of rows) {
      const id = row.dataset.flip as string;
      next.set(id, row.offsetTop);
      const before = positions.current.get(id);
      if (animate && !reduce && before !== undefined && before !== row.offsetTop) {
        row.animate(
          [{ transform: `translateY(${before - row.offsetTop}px)` }, { transform: 'none' }],
          { duration: SLIDE_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        );
      }
    }
    positions.current = next;

    if (!landing) return;
    const landed = list.current?.querySelector<HTMLElement>(`[data-board-card="${landing.cardId}"]`);
    if (!landed) return;
    const rect = landed.getBoundingClientRect();
    if (!reduce) {
      landed.animate(
        [
          {
            transform: `translate(${landing.left - rect.left}px, ${landing.top - rect.top}px) rotate(2.5deg) scale(1.02)`,
            boxShadow: '0 14px 28px rgba(20, 24, 26, 0.22)',
          },
          { transform: 'none', boxShadow: '0 1px 1px rgba(20, 24, 26, 0.04)' },
        ],
        { duration: LAND_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    }
    onLanded?.();
  });

  useEffect(() => {
    if (count === 0) setConfirmingClear(false);
  }, [count]);

  const close = () => {
    setDraft('');
    setAdding(false);
  };

  const submit = () => {
    if (draft.trim()) onCreate(draft.trim());
    close();
  };

  return (
    <section
      className={`board-column${showLaneTitles ? ' board-column--lanes' : ''}`}
      data-testid={`board-column-${column.id}`}
      data-board-column={column.id}
    >
      <header className="board-column__header">
        <span className={`board-column__dot board-column__dot--${column.id}`} />
        <h2>{column.title}</h2>
        <span className="board-column__count">{count}</span>
        {column.id === 'done' && count > 0 && onClearDone && !confirmingClear && (
          <button
            type="button"
            className="board-column__clear"
            data-testid="board-clear-done"
            onClick={() => setConfirmingClear(true)}
          >
            Clear
          </button>
        )}
        {confirmingClear && (
          <div className="board-column__confirm" data-testid="board-clear-done-confirm">
            <span>
              Archive {count} done card{count === 1 ? '' : 's'}?
            </span>
            <button
              type="button"
              className="board-button board-button--primary"
              onClick={() => {
                onClearDone?.();
                setConfirmingClear(false);
              }}
            >
              Archive
            </button>
            <button
              type="button"
              className="board-button"
              onClick={() => setConfirmingClear(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </header>
      <div className="board-column__cards" ref={list}>
        {lanes.map((lane) => {
          // Drop indexes count the cards that stay put, not the one being dragged.
          const slotIndex = new Map(
            lane.cards.filter((card) => card.id !== draggingCardId).map((card, index) => [card.id, index]),
          );
          const laneDrop = dropLane === lane.key ? dropIndex : undefined;
          return (
            <Fragment key={lane.key}>
              {showLaneTitles && <div className="board-lane__gap" aria-hidden="true" />}
              <div className={`board-lane${lane.collapsed ? ' board-lane--collapsed' : ''}`} data-board-lane={lane.key}>
              {!lane.collapsed && lane.cards.flatMap((card) => [
                ...(card.id !== draggingCardId && laneDrop === slotIndex.get(card.id)
                  ? [<Placeholder key="drop-slot" height={dropHeight} />]
                  : []),
                <div key={card.id} data-flip={`${lane.key}:${card.id}`}>
                  <BoardCardFace
                    card={card}
                    dragging={draggingCardId === card.id}
                    active={activeCardIds?.has(card.id)}
                    fading={fadingCardIds?.has(card.id)}
                    flashing={flashingCardIds?.has(card.id)}
                    spotlight={Boolean(
                      spotlightName
                      && (card.assignee === spotlightName || card.createdBy === spotlightName),
                    )}
                    dimmed={Boolean(
                      spotlightName
                      && card.assignee !== spotlightName
                      && card.createdBy !== spotlightName,
                    )}
                    spotlightColor={spotlightName ? avatarColor(spotlightName) : undefined}
                    onOpen={() => {
                      onCardPointerUp(card);
                      onOpen(card);
                    }}
                    onPointerDown={(event) => onCardPointerDown(card, event, lane.key)}
                    onKeyDown={(event) => onCardKeyDown(card, event)}
                  />
                </div>,
              ])}
              {(lane.collapsed ? laneDrop !== undefined : laneDrop === slotIndex.size)
                && <Placeholder key="drop-slot" height={dropHeight} />}
              </div>
            </Fragment>
          );
        })}
      </div>
      {adding ? (
        <input
          ref={input}
          className="board-add-input"
          value={draft}
          placeholder="Card title"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={submit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
            if (event.key === 'Escape') close();
          }}
        />
      ) : (
        <button
          type="button"
          className="board-add"
          data-testid={`board-add-card-${column.id}`}
          onClick={() => setAdding(true)}
        >
          <Plus size={15} />
          Add a card
        </button>
      )}
    </section>
  );
}

function Placeholder({ height }: { height?: number }) {
  return (
    <div
      className="board-placeholder"
      data-testid="board-drop-slot"
      style={height ? { height } : undefined}
    />
  );
}
