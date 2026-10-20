import { useLayoutEffect, useRef, useState } from 'react';
import { CheckSquare, GripVertical, Square } from 'lucide-react';
import type { BoardCard, BoardCheckItem, BoardData } from '../../types/data';
import {
  addChecklistItem,
  moveChecklistItem,
  removeChecklistItem,
  renameChecklistItem,
  setChecklistItem,
} from '../../board/boardOps';

const ACTOR = 'you';

/** A thin done/total bar; turns green when every item is ticked. */
export function ChecklistProgress({ items, testId }: { items: BoardCheckItem[]; testId?: string }) {
  if (!items.length) return null;
  const done = items.filter((item) => item.done).length;
  const percent = Math.round((done / items.length) * 100);

  return (
    <span
      className={`board-progress${done === items.length ? ' board-progress--complete' : ''}`}
      role="progressbar"
      aria-label="Checklist progress"
      aria-valuemin={0}
      aria-valuemax={items.length}
      aria-valuenow={done}
      data-testid={testId}
    >
      <span className="board-progress__fill" style={{ width: `${percent}%` }} />
    </span>
  );
}

/** Subtasks shown on the card face. */
export const PREVIEW_LIMIT = 5;

/** Read-only list of the first subtasks on a card face; the card opens on click as before. */
export function ChecklistPreview({ items, testId }: { items: BoardCheckItem[]; testId?: string }) {
  if (!items.length) return null;
  const shown = items.slice(0, PREVIEW_LIMIT);
  const more = items.length - shown.length;

  return (
    <ul className="board-card__subtasks" data-testid={testId}>
      {shown.map((item) => (
        <li key={item.id} className={item.done ? 'board-card__subtask--done' : undefined}>
          {item.done ? <CheckSquare size={12} aria-label="done" /> : <Square size={12} aria-label="open" />}
          <span>{item.text}</span>
        </li>
      ))}
      {more > 0 && <li className="board-card__subtasks-more">+{more} more</li>}
    </ul>
  );
}

interface ChecklistProps {
  card: BoardCard;
  edit: (fn: (board: BoardData) => BoardData) => void;
}

/** Items in display order while one is being dragged to `over`. */
function previewOrder(items: BoardCheckItem[], dragId: string | null, over: number) {
  if (!dragId) return items;
  const dragged = items.find((item) => item.id === dragId);
  if (!dragged) return items;
  const rest = items.filter((item) => item.id !== dragId);
  rest.splice(over, 0, dragged);
  return rest;
}

export function Checklist({ card, edit }: ChecklistProps) {
  const list = useRef<HTMLUListElement>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  // Mirrors `editing` so a blur that follows Enter or Escape does not save twice.
  const editingRef = useRef<{ id: string; text: string } | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const refocus = useRef<{ id: string; part: string } | null>(null);

  const startEditing = (item: BoardCheckItem) => {
    editingRef.current = { id: item.id, text: item.text };
    setEditing(editingRef.current);
  };
  const finishEditing = (save: boolean) => {
    const pending = editingRef.current;
    editingRef.current = null;
    setEditing(null);
    if (!save || !pending) return;
    try {
      edit((board) => renameChecklistItem(board, {
        cardId: card.id,
        itemId: pending.id,
        text: pending.text,
      }, ACTOR, Date.now()));
    } catch {
      // The item or card went away while it was being edited.
    }
  };

  const move = (item: BoardCheckItem, index: number) => {
    edit((board) => moveChecklistItem(board, { cardId: card.id, itemId: item.id, index }, ACTOR, Date.now()));
  };

  // Where a dragged row lands: the number of other rows whose middle is above the pointer.
  const indexAt = (clientY: number, dragId: string) => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('[data-check-item]') ?? [])];
    return rows.filter((row) => {
      if (row.dataset.checkItem === dragId) return false;
      const rect = row.getBoundingClientRect();
      return rect.top + rect.height / 2 < clientY;
    }).length;
  };

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, item: BoardCheckItem) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id: item.id, over: card.checklist.indexOf(item) });
  };
  const dragMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const over = indexAt(event.clientY, drag.id);
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const endDrag = (item: BoardCheckItem) => {
    if (!drag) return;
    const { over } = drag;
    setDrag(null);
    if (over !== card.checklist.indexOf(item)) move(item, over);
  };

  const moveByKey = (event: React.KeyboardEvent<HTMLLIElement>, item: BoardCheckItem) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const step = event.key === 'ArrowUp' ? -1 : 1;
    refocus.current = { id: item.id, part: (event.target as HTMLElement).dataset.checkFocus ?? 'handle' };
    // Read the position from the board itself: a held key can arrive before
    // this component re-renders with the previous move.
    edit((board) => {
      const current = board.cards.find((entry) => entry.id === card.id);
      const from = current?.checklist.findIndex((entry) => entry.id === item.id) ?? -1;
      const to = from + step;
      if (!current || from < 0 || to < 0 || to >= current.checklist.length) return board;
      return moveChecklistItem(board, { cardId: card.id, itemId: item.id, index: to }, ACTOR, Date.now());
    });
  };

  // Reordering can take the focused row out of the DOM and back; put focus back
  // before the next key arrives, so held Alt+Down keeps moving the same item.
  useLayoutEffect(() => {
    const pending = refocus.current;
    if (!pending) return;
    refocus.current = null;
    list.current
      ?.querySelector<HTMLElement>(`[data-check-item="${pending.id}"] [data-check-focus="${pending.part}"]`)
      ?.focus();
  });

  const done = card.checklist.filter((item) => item.done).length;
  const items = previewOrder(card.checklist, drag?.id ?? null, drag?.over ?? 0);

  return (
    <section className="board-overlay__section" data-testid="card-checklist">
      <div className="board-overlay__section-heading">
        <h2>Checklist</h2>
        <span>{done} of {card.checklist.length}</span>
      </div>
      <ChecklistProgress items={card.checklist} testId="card-checklist-progress" />
      <ul className="board-checklist" ref={list}>
        {items.map((item) => (
          <li
            key={item.id}
            data-check-item={item.id}
            className={drag?.id === item.id ? 'board-checklist__row--dragging' : undefined}
            onKeyDown={(event) => moveByKey(event, item)}
          >
            <button
              type="button"
              className="board-checklist__handle"
              aria-label={`Move ${item.text} (Alt+Up / Alt+Down)`}
              title="Drag to reorder (Alt+Up / Alt+Down)"
              data-check-focus="handle"
              onPointerDown={(event) => startDrag(event, item)}
              onPointerMove={dragMove}
              onPointerUp={() => endDrag(item)}
              onPointerCancel={() => setDrag(null)}
            >
              <GripVertical size={14} />
            </button>
            <input
              type="checkbox"
              checked={item.done}
              aria-label={item.text}
              data-check-focus="box"
              onChange={() => edit((board) => setChecklistItem(board, {
                cardId: card.id,
                itemId: item.id,
                done: !item.done,
              }, ACTOR, Date.now()))}
            />
            {editing?.id === item.id ? (
              <input
                className="board-checklist__edit"
                aria-label={`Edit ${item.text}`}
                data-checklist-edit=""
                autoFocus
                value={editing.text}
                onChange={(event) => {
                  editingRef.current = { id: item.id, text: event.target.value };
                  setEditing(editingRef.current);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    finishEditing(true);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    finishEditing(false);
                  }
                }}
                onBlur={() => finishEditing(true)}
              />
            ) : (
              <button
                type="button"
                className={`board-checklist__text${item.done ? ' board-checklist__done' : ''}`}
                title="Click to edit"
                data-check-focus="text"
                onClick={() => startEditing(item)}
              >
                {item.text}
              </button>
            )}
            <button
              type="button"
              className="board-checklist__remove"
              aria-label={`Remove ${item.text}`}
              onClick={() => edit((board) => removeChecklistItem(board, {
                cardId: card.id,
                itemId: item.id,
              }, ACTOR, Date.now()))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <input
        className="board-add-input"
        aria-label="Add checklist item"
        value={draft}
        placeholder="Add item"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !draft.trim()) return;
          edit((board) => addChecklistItem(board, { cardId: card.id, text: draft }, ACTOR, Date.now()));
          setDraft('');
        }}
      />
    </section>
  );
}
