import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { BoardCard, BoardColumnId, BoardData } from '../../types/data';
import {
  addNote,
  archiveCard,
  moveCard,
  updateCard,
  BOARD_COLUMNS,
} from '../../board/boardOps';
import { markdownToHtml } from '../../utils/renderMarkdown';
import { CardProperties } from './CardProperties';
import { Checklist } from './Checklist';
import { avatarColor, avatarInitial, collapseEditRuns, displayName, relativeTime } from './boardUi';

const ACTOR = 'you';

/** Typed text waits here until the card closes; null means the field is untouched. */
interface Drafts {
  title: string | null;
  description: string | null;
}

const NO_DRAFTS: Drafts = { title: null, description: null };

interface CardOverlayProps {
  card: BoardCard;
  cards: BoardCard[];
  events: BoardData['events'];
  edit: (fn: (board: BoardData) => BoardData) => void;
  onClose: () => void;
}

function EventHistory({ card, events }: Pick<CardOverlayProps, 'card' | 'events'>) {
  const history = collapseEditRuns(events.filter((event) => event.cardId === card.id)).reverse();

  return (
    <ol className="board-history">
      {history.map((event) => (
        <li key={event.seq}>
          <strong>{displayName(event.actor)}</strong>
          <span>
            {event.type === 'moved'
              ? ` moved to ${BOARD_COLUMNS.find((column) => column.id === event.to)?.title}`
              : ` ${event.type}`}
          </span>
          <time>{relativeTime(event.at)}</time>
        </li>
      ))}
    </ol>
  );
}

export function CardOverlay({ card, cards, events, edit, onClose }: CardOverlayProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement);
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const [note, setNote] = useState('');
  const [question, setQuestion] = useState(card.question ?? '');
  const [askingQuestion, setAskingQuestion] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>(NO_DRAFTS);
  const draftsRef = useRef<Drafts>(NO_DRAFTS);
  const setDraft = (field: keyof Drafts, value: string) => {
    draftsRef.current = { ...draftsRef.current, [field]: value };
    setDrafts(draftsRef.current);
  };

  useEffect(() => {
    dialog.current?.focus();
    const previousFocus = restoreFocus.current;

    return () => previousFocus?.focus();
  }, []);

  // Saves typed text in one go: one 'updated' entry for title and description.
  // Never one entry per keystroke. Status, assignee and labels are menu choices
  // and save at once (CardProperties).
  const saveDrafts = () => {
    const pending = draftsRef.current;
    draftsRef.current = NO_DRAFTS;
    const title = pending.title?.trim() ? pending.title : null;
    const changes = {
      ...(title !== null && title !== card.title ? { title } : {}),
      ...(pending.description !== null && pending.description !== card.description
        ? { description: pending.description }
        : {}),
    };
    try {
      if (Object.keys(changes).length) {
        edit((board) => updateCard(board, { cardId: card.id, ...changes }, ACTOR, Date.now()));
      }
    } catch {
      // The card was archived or deleted meanwhile: nothing left to save to.
    }
  };
  const saveDraftsRef = useRef(saveDrafts);
  saveDraftsRef.current = saveDrafts;

  // Every way out (X, Escape, backdrop, switching page) unmounts the overlay.
  useEffect(() => {
    const saveBeforeLeaving = () => {
      if (document.visibilityState === 'hidden') saveDraftsRef.current();
    };
    document.addEventListener('visibilitychange', saveBeforeLeaving);
    return () => {
      document.removeEventListener('visibilitychange', saveBeforeLeaving);
      saveDraftsRef.current();
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Escape in a checklist item being edited, or in an open menu, closes that, not the card.
      if ((event.target as HTMLElement | null)?.closest?.('[data-checklist-edit], [data-board-menu]')) return;
      event.stopPropagation();
      onClose();
    };

    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [onClose]);

  const move = (to: BoardColumnId) => {
    if (to === 'waiting' && card.column !== 'waiting' && !question.trim()) {
      setAskingQuestion(true);
      return;
    }

    edit((board) => moveCard(board, {
      cardId: card.id,
      to,
      index: card.order,
      question,
    }, ACTOR, Date.now()));
    setAskingQuestion(false);
  };

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;

    const focusable = [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)',
      ) ?? []),
    ];

    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };


  const reply = (moveAfterReply = false) => {
    if (!note.trim()) return;

    edit((board) => {
      const withNote = addNote(board, { cardId: card.id, text: note }, ACTOR, Date.now());

      return moveAfterReply
        ? moveCard(withNote, { cardId: card.id, to: 'doing', index: card.order }, ACTOR, Date.now())
        : withNote;
    });
    setNote('');
  };

  return (
    <div
      className="board-overlay"
      data-testid="board-card-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="board-overlay__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Card ${card.number}`}
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <header className="board-overlay__header">
          <div className="board-overlay__heading">
            <div className="board-overlay__eyebrow">
              <span className="board-card__number">#{card.number}</span>
              {card.column === 'waiting' && <span className="board-card__needs">Needs you</span>}
            </div>
            <input
              className="board-overlay__title"
              aria-label="Card title"
              value={drafts.title ?? card.title}
              onChange={(event) => setDraft('title', event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          </div>
          <div className="board-overlay__header-actions">
            <button
              type="button"
              className="board-button"
              data-testid="card-archive"
              onClick={() => {
                saveDrafts();
                edit((board) => archiveCard(board, { cardId: card.id }, ACTOR, Date.now()));
                onClose();
              }}
            >
              Archive
            </button>
            <button type="button" className="board-overlay__close" aria-label="Close card" onClick={onClose}>
              <X size={19} />
            </button>
          </div>
        </header>
        <div className="board-overlay__body">
          <main className="board-overlay__main">
            {askingQuestion && (
              <div className="board-overlay__question">
                <label>
                  What feedback is needed?
                  <input autoFocus value={question} onChange={(event) => setQuestion(event.target.value)} />
                </label>
                <button type="button" className="board-button" onClick={() => setAskingQuestion(false)}>
                  Cancel
                </button>
                <button type="button" className="board-button board-button--primary" onClick={() => move('waiting')}>
                  Move
                </button>
              </div>
            )}
            <section className="board-overlay__section">
              <h2>Description</h2>
              {descriptionEditing ? (
                <textarea
                  autoFocus
                  aria-label="Description"
                  value={drafts.description ?? card.description}
                  onChange={(event) => setDraft('description', event.target.value)}
                  onBlur={() => setDescriptionEditing(false)}
                />
              ) : (
                <button
                  type="button"
                  className="board-description powernote-markdown"
                  onClick={() => setDescriptionEditing(true)}
                  dangerouslySetInnerHTML={{
                    __html: markdownToHtml(
                      (drafts.description ?? card.description) || 'Click to add a description',
                    ),
                  }}
                />
              )}
            </section>
            <Checklist card={card} edit={edit} />
            <section className="board-overlay__section">
              <h2>Notes</h2>
              <div className="board-notes">
                {card.notes.map((item) => (
                  <article key={item.id}>
                    <span
                      className="board-avatar board-avatar--note"
                      style={{ backgroundColor: avatarColor(item.author) }}
                    >
                      {avatarInitial(item.author)}
                    </span>
                    <div className="board-note__bubble">
                      <p><strong>{displayName(item.author)}</strong> · {relativeTime(item.at)}</p>
                      <div>{item.text}</div>
                    </div>
                  </article>
                ))}
              </div>
              <textarea
                className="board-reply"
                aria-label="Reply"
                value={note}
                placeholder="Write a reply"
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="board-reply__actions">
                <button
                  type="button"
                  className="board-button"
                  disabled={!note.trim()}
                  onClick={() => reply()}
                >
                  Reply
                </button>
                {card.column === 'waiting' && (
                  <button
                    type="button"
                    className="board-button board-button--primary"
                    disabled={!note.trim()}
                    onClick={() => reply(true)}
                  >
                    Reply and move to In progress
                  </button>
                )}
              </div>
              {card.assignee && (
                <p className="board-overlay__hint">
                  {displayName(card.assignee)} sees replies on its next check.
                </p>
              )}
            </section>
          </main>
          <aside className="board-overlay__sidebar">
            <CardProperties card={card} cards={cards} edit={edit} onMove={move} />
            <section className="board-overlay__section">
              <h2>History</h2>
              <EventHistory card={card} events={events} />
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
