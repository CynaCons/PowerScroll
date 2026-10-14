import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BoardCard, BoardColumnId } from '../../types/data';
import { BoardCardFace } from './BoardCardFace';

interface BoardColumnProps {
  cards: BoardCard[];
  column: { id: BoardColumnId; title: string };
  draggingCardId?: string;
  dropIndex?: number;
  activeCardIds?: Set<string>;
  fadingCardIds?: Set<string>;
  flashingCardIds?: Set<string>;
  onCreate: (title: string) => void;
  onOpen: (card: BoardCard) => void;
  onCardPointerDown: (card: BoardCard, event: React.PointerEvent<HTMLButtonElement>) => void;
  onCardPointerUp: (card: BoardCard) => void;
  onCardKeyDown: (card: BoardCard, event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export function BoardColumn({
  cards,
  column,
  draggingCardId,
  dropIndex,
  activeCardIds,
  fadingCardIds,
  flashingCardIds,
  onCreate,
  onOpen,
  onCardPointerDown,
  onCardPointerUp,
  onCardKeyDown,
}: BoardColumnProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);

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
      className="board-column"
      data-testid={`board-column-${column.id}`}
      data-board-column={column.id}
    >
      <header className="board-column__header">
        <span className={`board-column__dot board-column__dot--${column.id}`} />
        <h2>{column.title}</h2>
        <span className="board-column__count">{cards.length}</span>
      </header>
      <div className="board-column__cards">
        {cards.map((card, index) => (
          <div key={card.id}>
            {dropIndex === index && <div className="board-placeholder" />}
            <BoardCardFace
              card={card}
              dragging={draggingCardId === card.id}
              active={activeCardIds?.has(card.id)}
              fading={fadingCardIds?.has(card.id)}
              flashing={flashingCardIds?.has(card.id)}
              onOpen={() => {
                onCardPointerUp(card);
                onOpen(card);
              }}
              onPointerDown={(event) => onCardPointerDown(card, event)}
              onKeyDown={(event) => onCardKeyDown(card, event)}
            />
          </div>
        ))}
        {dropIndex === cards.length && <div className="board-placeholder" />}
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
