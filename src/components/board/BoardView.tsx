import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { BoardCard, BoardColumnId, BoardData } from '../../types/data';
import {
  BOARD_COLUMNS,
  clearDone,
  createCard,
  liveCards,
  moveCard,
  restoreCard,
  updateCard,
} from '../../board/boardOps';
import { boardLabelColors, displayName, relativeTime } from './boardUi';
import { LabelColorsContext } from './labelColors';
import {
  AGENT_ACTIVE_MS,
  AGENT_TICK_MS,
  useAgentPresenceStore,
} from '../../stores/useAgentPresenceStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { ActivityPanel, readActivityCollapsed, writeActivityCollapsed } from './ActivityPanel';
import { agentChips, AgentsStrip } from './AgentsStrip';
import { BoardColumn, type CardLanding } from './BoardColumn';
import { BoardCardFace } from './BoardCardFace';
import { CardOverlay } from './CardOverlay';
import { boardLabels } from './CardProperties';
import { LabelFilter } from './LabelFilter';
import { QuestionPrompt } from './QuestionPrompt';
import { boardLanes, inLane, relabel } from './lanes';
import './BoardView.css';

const ACTOR = 'you';

interface DragState {
  active: boolean;
  cardId: string;
  startX: number;
  startY: number;
  /** Pointer now, and where on the card it was grabbed, for the floating copy. */
  x: number;
  y: number;
  grabX: number;
  grabY: number;
  width: number;
  height: number;
  /** The lane the card was picked up in (REQ-BOARD-045). */
  lane: string;
}

interface DropState {
  column: BoardColumnId;
  lane: string;
  index: number;
}

interface QuestionDrop {
  cardId: string;
  column: BoardColumnId;
  index: number;
  /** New labels when the card also changed lane. */
  labels?: string[];
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
  const left = useAgentPresenceStore((state) => state.left);
  const now = useAgentPresenceStore((state) => state.now);
  const [needsMe, setNeedsMe] = useState(false);
  // Label filter per board page, for this session only (not saved in the notebook).
  const [labelFilters, setLabelFilters] = useState<Record<string, string[]>>({});
  // Collapsed lanes per board page, for this session only (REQ-BOARD-044).
  const [collapsedLanes, setCollapsedLanes] = useState<Record<string, string[]>>({});
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const [activityCollapsed, setActivityCollapsed] = useState(readActivityCollapsed);
  const [showArchived, setShowArchived] = useState(false);
  const [opened, setOpened] = useState<BoardCard | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const [landing, setLanding] = useState<CardLanding | null>(null);
  const cancelledDrag = useRef(false);
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

    setOpened((previous) => {
      if (!previous) return null;
      const found = board.cards.find((card) => card.id === previous.id);
      if (!found || found.archivedAt) return null;
      return found;
    });
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
      // The highlight shows agents at work; the owner's own edits never light a card.
      if (!card.assignee || card.assignee === 'you') return false;
      const actor = actors[card.assignee];
      if (!actor || actor.cardId !== card.id) return false;
      if (now - actor.lastActionAt > AGENT_ACTIVE_MS) return false;
      if (agentsGone) return false;
      if (left[card.assignee]) return false;
      return true;
    })
    .map((card) => card.id);
  const activeCardIds = new Set(activeIdList);
  const activeKey = activeIdList.slice().sort().join(',');
  const chips = agentChips(
    board?.cards ?? [],
    connected,
    actors,
    now,
    page?.id ?? '',
    presenceSeen,
    left,
  );
  const chipNames = chips.map((chip) => chip.name).join(',');

  useEffect(() => {
    if (spotlight && !(chipNames ? chipNames.split(',') : []).includes(spotlight)) {
      setSpotlight(null);
    }
  }, [spotlight, chipNames]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (opened || questionDrop) return;
      if (drag?.active) {
        // Escape mid-drag puts the card back where it came from.
        cancelledDrag.current = true;
        setLanding({ cardId: drag.cardId, left: drag.x - drag.grabX, top: drag.y - drag.grabY });
        setDrag(null);
        setDrop(null);
        return;
      }
      setSpotlight(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opened, questionDrop, drag]);

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
  const live = liveCards(board.cards);
  const archivedCards = board.cards
    .filter((card) => card.archivedAt)
    .slice()
    .sort((leftCard, rightCard) => (rightCard.archivedAt ?? 0) - (leftCard.archivedAt ?? 0));
  const labels = boardLabels(live);
  const labelFilter = (labelFilters[page.id] ?? []).filter((label) => labels.some((entry) => entry.label === label));
  const setLabelFilter = (selected: string[]) => setLabelFilters((current) => ({ ...current, [page.id]: selected }));
  const visibleCards = live
    .filter((card) => !needsMe || card.column === 'waiting')
    .filter((card) => !labelFilter.length || card.labels.some((label) => labelFilter.includes(label)));
  const filtered = needsMe || labelFilter.length > 0;
  const lanes = boardLanes(live, visibleCards, labelFilter);
  const collapsed = collapsedLanes[page.id] ?? [];
  const toggleLane = (key: string) => setCollapsedLanes((current) => {
    const list = current[page.id] ?? [];
    return { ...current, [page.id]: list.includes(key) ? list.filter((item) => item !== key) : [...list, key] };
  });
  const waitingCount = live.filter((card) => card.column === 'waiting').length;
  const spotlightActive = spotlight && chips.some((chip) => chip.name === spotlight)
    ? spotlight
    : null;

  const draggedCard = drag?.active ? board.cards.find((card) => card.id === drag.cardId) : undefined;

  const archivedBy = (card: BoardCard) => {
    const event = [...board.events]
      .reverse()
      .find((item) => item.type === 'archived' && item.cardId === card.id);
    return event?.actor;
  };

  const updateDrop = (event: React.PointerEvent<HTMLElement>, current: DragState) => {
    const columnElement = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)
      ?.closest<HTMLElement>('[data-board-column]');

    if (!columnElement) return;

    const column = columnElement.dataset.boardColumn as BoardColumnId;
    // Over a lane, that lane; over the column header or its add button, the lane the card came from.
    const laneElements = [...columnElement.querySelectorAll<HTMLElement>('[data-board-lane]')];
    const laneElement = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)
      ?.closest<HTMLElement>('[data-board-lane]')
      ?? laneElements.find((element) => element.dataset.boardLane === current.lane)
      ?? laneElements[laneElements.length - 1];
    if (!laneElement) return;
    const lane = laneElement.dataset.boardLane as string;
    const cardElements = [...laneElement.querySelectorAll<HTMLElement>('[data-board-card]')]
      .filter((element) => element.dataset.boardCard !== current.cardId);
    let index = cardElements.findIndex((element) => {
      const rectangle = element.getBoundingClientRect();
      return event.clientY < rectangle.top + rectangle.height / 2;
    });

    if (index < 0) index = cardElements.length;
    setDrop({ column, lane, index });
  };

  // A drop slot counts only the lane's cards on screen; translate it to a place
  // among all the column's cards so cards hidden by a filter or in other lanes keep their order.
  const fullColumnIndex = (column: BoardColumnId, lane: string, visibleIndex: number, cardId: string) => {
    const all = cardsIn(live, column).filter((card) => card.id !== cardId);
    const shown = cardsIn(visibleCards, column).filter((card) => card.id !== cardId && inLane(card, lane));
    if (shown.length === all.length) return visibleIndex;
    const before = shown[visibleIndex];
    if (before) return all.indexOf(before);
    const last = shown[shown.length - 1];
    return last ? all.indexOf(last) + 1 : all.length;
  };

  const finishDrag = () => {
    if (!drag?.active || !drop) {
      setDrag(null);
      setDrop(null);
      return;
    }

    setLanding({ cardId: drag.cardId, left: drag.x - drag.grabX, top: drag.y - drag.grabY });

    const currentCard = board.cards.find((card) => card.id === drag.cardId);
    const labels = currentCard && drop.lane !== drag.lane
      ? relabel(currentCard.labels, drag.lane, drop.lane)
      : undefined;
    const index = fullColumnIndex(drop.column, drop.lane, drop.index, drag.cardId);

    if (
      currentCard
      && drop.column === 'waiting'
      && currentCard.column !== 'waiting'
      && !currentCard.question
    ) {
      setQuestionDrop({ cardId: currentCard.id, column: drop.column, index, labels });
    } else {
      edit((current) => {
        const moved = moveCard(current, { cardId: drag.cardId, to: drop.column, index }, ACTOR, Date.now());
        return labels ? updateCard(moved, { cardId: drag.cardId, labels }, ACTOR, Date.now()) : moved;
      });
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
    <LabelColorsContext.Provider value={boardLabelColors(board.cards)}>
      <main
        className="board-view"
        data-testid="board-view"
        data-spotlight={spotlightActive ?? undefined}
        onPointerMove={(event) => {
          if ((event.target as HTMLElement).closest('.board-overlay')) return;
          if (!drag) return;

          const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
          const current = drag.active || distance >= 5
            ? { ...drag, active: true, x: event.clientX, y: event.clientY }
            : drag;

          if (!current.active) return;
          setDrag(current);
          updateDrop(event, current);
        }}
        onPointerUpCapture={(event) => {
          if ((event.target as HTMLElement).closest('.board-overlay')) return;
          suppressOpen.current = Boolean(drag?.active) || cancelledDrag.current;
          cancelledDrag.current = false;
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
            <p data-testid="board-card-count">
              Board · {filtered ? `${visibleCards.length} of ${live.length}` : live.length} cards
            </p>
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
            <LabelFilter labels={labels} selected={labelFilter} onChange={setLabelFilter} />
            {archivedCards.length > 0 && (
              <button
                type="button"
                className={showArchived ? 'board-filter board-filter--active' : 'board-filter'}
                data-testid="board-archived-toggle"
                aria-pressed={showArchived}
                onClick={() => setShowArchived((current) => !current)}
              >
                Archived ({archivedCards.length})
              </button>
            )}
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
        <AgentsStrip
          chips={chips}
          spotlight={spotlightActive}
          onToggleSpotlight={(name) => setSpotlight((current) => (current === name ? null : name))}
          onDismiss={(name) => useAgentPresenceStore.getState().leave(name)}
        />
        {showArchived && archivedCards.length > 0 && (
          <div className="board-archived" data-testid="board-archived-list">
            {archivedCards.map((card) => (
              <div key={card.id} className="board-archived__row">
                <span className="board-card__number">#{card.number}</span>
                <strong className="board-archived__title">{card.title}</strong>
                <span className="board-archived__meta">
                  {relativeTime(card.archivedAt ?? 0)}
                  {archivedBy(card) ? ` · ${displayName(archivedBy(card))}` : ''}
                </span>
                <button
                  type="button"
                  className="board-button"
                  data-testid={`board-restore-${card.number}`}
                  onClick={() => edit((current) => restoreCard(current, {
                    cardId: card.id,
                  }, ACTOR, Date.now()))}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          className={`board-view__content${
            activityCollapsed ? ' board-view__content--activity-collapsed' : ''
          }`}
        >
          <div
            className="board-view__columns"
            style={{ gridTemplateRows: `auto repeat(${lanes.length}, auto) 1fr` }}
          >
            {BOARD_COLUMNS.map((column, columnIndex) => {
              const isDropColumn = drop?.column === column.id;

              return (
                <BoardColumn
                  key={column.id}
                  column={column}
                  count={cardsIn(visibleCards, column.id).length}
                  lanes={lanes.map((lane) => ({
                    ...lane,
                    cards: cardsIn(lane.cards, column.id),
                    total: lane.cards.length,
                    collapsed: collapsed.includes(lane.key),
                  }))}
                  showLaneTitles={labels.length > 0}
                  titleColumn={columnIndex === 0}
                  onToggleLane={toggleLane}
                  draggingCardId={drag?.active ? drag.cardId : undefined}
                  dropLane={isDropColumn ? drop.lane : undefined}
                  dropIndex={isDropColumn ? drop.index : undefined}
                  dropHeight={drag?.active ? drag.height : undefined}
                  animate={Boolean(drag?.active || landing)}
                  landing={landing}
                  onLanded={() => setLanding(null)}
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
                  onCardPointerDown={(card, event, lane) => {
                    if ((event.target as HTMLElement).closest('input, button[data-no-drag]')) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    const rect = event.currentTarget.getBoundingClientRect();
                    setDrag({
                      cardId: card.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      x: event.clientX,
                      y: event.clientY,
                      grabX: event.clientX - rect.left,
                      grabY: event.clientY - rect.top,
                      width: rect.width,
                      height: rect.height,
                      active: false,
                      lane,
                    });
                  }}
                  onCardPointerUp={() => undefined}
                  onCardKeyDown={moveWithKeyboard}
                  spotlightName={spotlightActive}
                  onClearDone={column.id === 'done'
                    ? () => edit((current) => clearDone(current, ACTOR, Date.now()))
                    : undefined}
                />
              );
            })}
          </div>
          <ActivityPanel
            board={board}
            collapsed={activityCollapsed}
            onToggle={() => {
              const next = !activityCollapsed;
              setActivityCollapsed(next);
              writeActivityCollapsed(next);
            }}
          />
        </div>
        {drag?.active && draggedCard && (
          <div
            className="board-drag-ghost"
            data-testid="board-drag-ghost"
            style={{ left: drag.x - drag.grabX, top: drag.y - drag.grabY, width: drag.width }}
          >
            <BoardCardFace
              card={draggedCard}
              dragging={false}
              ghost
              onOpen={() => undefined}
              onPointerDown={() => undefined}
              onKeyDown={() => undefined}
            />
          </div>
        )}
        {questionDrop && (
          <QuestionPrompt
            onCancel={() => setQuestionDrop(null)}
            onSubmit={(question) => {
              edit((current) => {
                const moved = moveCard(current, {
                  cardId: questionDrop.cardId,
                  to: questionDrop.column,
                  index: questionDrop.index,
                  question,
                }, ACTOR, Date.now());
                return questionDrop.labels
                  ? updateCard(moved, { cardId: questionDrop.cardId, labels: questionDrop.labels }, ACTOR, Date.now())
                  : moved;
              });
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
    </LabelColorsContext.Provider>
  );
}
