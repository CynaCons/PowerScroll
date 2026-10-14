import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { BoardCard, BoardColumnId, BoardData } from '../../types/data';
import { BOARD_COLUMNS, createCard, moveCard } from '../../board/boardOps';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { ActivityPanel } from './ActivityPanel';
import { BoardColumn } from './BoardColumn';
import { CardOverlay } from './CardOverlay';
import { QuestionPrompt } from './QuestionPrompt';
import './BoardView.css';

const ACTOR = 'you';

interface DragState {
  active: boolean;
  cardId: string;
  startX: number;
  startY: number;
}

interface DropState {
  column: BoardColumnId;
  index: number;
}

interface QuestionDrop extends DropState {
  cardId: string;
}

function cardsIn(cards: BoardCard[], column: BoardColumnId): BoardCard[] {
  return cards
    .filter((card) => card.column === column)
    .sort((left, right) => left.order - right.order);
}

export function BoardView() {
  const page = useWorkspaceStore((state) => state.getActivePage());
  const updateBoard = useWorkspaceStore((state) => state.updateBoard);
  const [needsMe, setNeedsMe] = useState(false);
  const [opened, setOpened] = useState<BoardCard | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const [questionDrop, setQuestionDrop] = useState<QuestionDrop | null>(null);
  const suppressOpen = useRef(false);
  const board = page?.board;

  useEffect(() => {
    if (!board) return;

    setOpened((previous) => previous
      ? board.cards.find((card) => card.id === previous.id) ?? null
      : null);
  }, [board]);

  if (!page || !board) return null;

  const edit = (fn: (current: BoardData) => BoardData) => updateBoard(page.id, fn);
  const visibleCards = needsMe
    ? board.cards.filter((card) => card.column === 'waiting')
    : board.cards;

  const updateDrop = (event: React.PointerEvent<HTMLElement>, current: DragState) => {
    const columnElement = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)
      ?.closest<HTMLElement>('[data-board-column]');

    if (!columnElement) return;

    const column = columnElement.dataset.boardColumn as BoardColumnId;
    const cardElements = [...columnElement.querySelectorAll<HTMLElement>('[data-board-card]')]
      .filter((element) => element.dataset.boardCard !== current.cardId);
    let index = cardElements.findIndex((element) => {
      const rectangle = element.getBoundingClientRect();
      return event.clientY < rectangle.top + rectangle.height / 2;
    });

    if (index < 0) index = cardElements.length;
    setDrop({ column, index });
  };

  const finishDrag = () => {
    if (!drag?.active || !drop) {
      setDrag(null);
      setDrop(null);
      return;
    }

    const currentCard = board.cards.find((card) => card.id === drag.cardId);

    if (
      currentCard
      && drop.column === 'waiting'
      && currentCard.column !== 'waiting'
      && !currentCard.question
    ) {
      setQuestionDrop({ cardId: currentCard.id, ...drop });
    } else {
      edit((current) => moveCard(current, {
        cardId: drag.cardId,
        to: drop.column,
        index: drop.index,
      }, ACTOR, Date.now()));
    }

    setDrag(null);
    setDrop(null);
  };

  const moveWithKeyboard = (
    card: BoardCard,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (!event.altKey) return;

    const columnIndex = BOARD_COLUMNS.findIndex((column) => column.id === card.column);
    let target: BoardColumnId | undefined;
    let index = card.order;

    if (event.key === 'ArrowLeft') target = BOARD_COLUMNS[columnIndex - 1]?.id;
    if (event.key === 'ArrowRight') target = BOARD_COLUMNS[columnIndex + 1]?.id;
    if (event.key === 'ArrowUp') {
      target = card.column;
      index = card.order - 1;
    }
    if (event.key === 'ArrowDown') {
      target = card.column;
      index = card.order + 1;
    }
    if (!target) return;

    event.preventDefault();

    if (target === 'waiting' && card.column !== 'waiting' && !card.question) {
      setQuestionDrop({ cardId: card.id, column: target, index });
      return;
    }

    edit((current) => moveCard(current, {
      cardId: card.id,
      to: target,
      index,
    }, ACTOR, Date.now()));
  };

  return (
    <main
      className="board-view"
      data-testid="board-view"
      onPointerMove={(event) => {
        if ((event.target as HTMLElement).closest('.board-overlay')) return;
        if (!drag) return;

        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        const current = drag.active || distance >= 5 ? { ...drag, active: true } : drag;

        if (!current.active) return;
        setDrag(current);
        updateDrop(event, current);
      }}
      onPointerUpCapture={(event) => {
        if ((event.target as HTMLElement).closest('.board-overlay')) return;
        suppressOpen.current = Boolean(drag?.active);
        finishDrag();
      }}
      onPointerCancel={(event) => {
        if ((event.target as HTMLElement).closest('.board-overlay')) return;
        finishDrag();
      }}
    >
      <header className="board-view__header">
        <div>
          <h1>{page.title}</h1>
          <p>Board · {board.cards.length} cards</p>
        </div>
        <div className="board-view__controls">
          <button
            type="button"
            className={!needsMe ? 'board-filter board-filter--active' : 'board-filter'}
            onClick={() => setNeedsMe(false)}
          >
            All
          </button>
          <button
            type="button"
            className={needsMe ? 'board-filter board-filter--active' : 'board-filter'}
            data-testid="board-filter-needs-me"
            onClick={() => setNeedsMe(true)}
          >
            Needs me
          </button>
          <button
            type="button"
            className="board-button board-button--primary"
            data-testid="board-new-card"
            onClick={() => {
              setNeedsMe(false);
              document.querySelector<HTMLButtonElement>('[data-testid="board-add-card-todo"]')?.click();
            }}
          >
            <Plus size={16} />
            Card
          </button>
        </div>
      </header>
      <div className="board-view__content">
        <div className="board-view__columns">
          {BOARD_COLUMNS.map((column) => {
            const cards = cardsIn(visibleCards, column.id);
            const isDropColumn = drop?.column === column.id;

            return (
              <BoardColumn
                key={column.id}
                column={column}
                cards={cards}
                draggingCardId={drag?.active ? drag.cardId : undefined}
                dropIndex={isDropColumn ? drop.index : undefined}
                onCreate={(title) => edit((current) => createCard(current, {
                  title,
                  column: column.id,
                }, ACTOR, Date.now()))}
                onOpen={(card) => {
                  if (!suppressOpen.current) setOpened(card);
                  suppressOpen.current = false;
                }}
                onCardPointerDown={(card, event) => {
                  if ((event.target as HTMLElement).closest('input, button[data-no-drag]')) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDrag({
                    cardId: card.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    active: false,
                  });
                }}
                onCardPointerUp={() => undefined}
                onCardKeyDown={moveWithKeyboard}
              />
            );
          })}
        </div>
        <ActivityPanel board={board} />
      </div>
      {questionDrop && (
        <QuestionPrompt
          onCancel={() => setQuestionDrop(null)}
          onSubmit={(question) => {
            edit((current) => moveCard(current, {
              cardId: questionDrop.cardId,
              to: questionDrop.column,
              index: questionDrop.index,
              question,
            }, ACTOR, Date.now()));
            setQuestionDrop(null);
          }}
        />
      )}
      {opened && (
        <CardOverlay
          card={opened}
          cards={board.cards}
          events={board.events}
          edit={edit}
          onClose={() => setOpened(null)}
        />
      )}
    </main>
  );
}
