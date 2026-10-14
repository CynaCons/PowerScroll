import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { BoardCard, BoardColumnId, BoardData } from '../../types/data';
import { BOARD_COLUMNS, createCard, moveCard } from '../../board/boardOps';
import {
  AGENT_ACTIVE_MS,
  AGENT_TICK_MS,
  useAgentPresenceStore,
} from '../../stores/useAgentPresenceStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { ActivityPanel } from './ActivityPanel';
import { agentChips, AgentsStrip } from './AgentsStrip';
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
  const connected = useAgentPresenceStore((state) => state.connected);
  const presenceSeen = useAgentPresenceStore((state) => state.presenceSeen);
  const actors = useAgentPresenceStore((state) => state.actors);
  const now = useAgentPresenceStore((state) => state.now);
  const [needsMe, setNeedsMe] = useState(false);
  const [opened, setOpened] = useState<BoardCard | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const [questionDrop, setQuestionDrop] = useState<QuestionDrop | null>(null);
  const [flashing, setFlashing] = useState<Set<string>>(() => new Set());
  const [fading, setFading] = useState<Set<string>>(() => new Set());
  const suppressOpen = useRef(false);
  const seenSeq = useRef<number | null>(null);
  const wasActive = useRef<Set<string>>(new Set());
  const board = page?.board;

  useEffect(() => {
    const id = window.setInterval(() => useAgentPresenceStore.getState().tick(), AGENT_TICK_MS);
    useAgentPresenceStore.getState().tick();
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!board) return;

    setOpened((previous) => previous
      ? board.cards.find((card) => card.id === previous.id) ?? null
      : null);
  }, [board]);

  useEffect(() => {
    if (!board) return;
    const latest = board.events[board.events.length - 1]?.seq ?? 0;
    if (seenSeq.current === null) {
      seenSeq.current = latest;
      return;
    }
    const fresh = board.events.filter((event) => event.seq > (seenSeq.current ?? 0));
    seenSeq.current = latest;
    const ids = fresh
      .filter((event) => event.actor !== 'you' && event.cardId)
      .map((event) => event.cardId as string);
    if (!ids.length) return;
    setFlashing((current) => new Set([...current, ...ids]));
    const timer = window.setTimeout(() => {
      setFlashing((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [board]);

  // Agents act under the `me` name they pass on each call, which need not match
  // their MCP process label, so presence cannot be matched per name. Activity
  // in the last minute is what lights a card; only an empty agent list (every
  // agent gone) puts the lights out early.
  const agentsGone = presenceSeen && connected.length === 0;
  const activeIdList = (board?.cards ?? [])
    .filter((card) => {
      if (!card.assignee) return false;
      const actor = actors[card.assignee];
      if (!actor || actor.cardId !== card.id) return false;
      if (now - actor.lastActionAt > AGENT_ACTIVE_MS) return false;
      if (agentsGone) return false;
      return true;
    })
    .map((card) => card.id);
  const activeCardIds = new Set(activeIdList);
  const activeKey = activeIdList.slice().sort().join(',');

  useEffect(() => {
    const nextActive = new Set(activeKey ? activeKey.split(',') : []);
    const lost = [...wasActive.current].filter((id) => !nextActive.has(id));
    wasActive.current = nextActive;
    if (!lost.length) return;
    setFading((current) => new Set([...current, ...lost]));
    const timer = window.setTimeout(() => {
      setFading((current) => {
        const next = new Set(current);
        for (const id of lost) next.delete(id);
        return next;
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeKey]);

  if (!page || !board) return null;

  const edit = (fn: (current: BoardData) => BoardData) => updateBoard(page.id, fn);
  const visibleCards = needsMe
    ? board.cards.filter((card) => card.column === 'waiting')
    : board.cards;
  const waitingCount = board.cards.filter((card) => card.column === 'waiting').length;
  const chips = agentChips(board.cards, connected, actors, now, page.id, presenceSeen);

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
            {waitingCount > 0 && (
              <span className="board-filter__badge" data-testid="board-needs-me-count">
                {waitingCount}
              </span>
            )}
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
      <AgentsStrip chips={chips} />
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
                activeCardIds={activeCardIds}
                fadingCardIds={fading}
                flashingCardIds={flashing}
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
