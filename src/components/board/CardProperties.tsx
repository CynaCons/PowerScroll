import { useState } from 'react';
import { Check, ChevronDown, Plus, X } from 'lucide-react';
import type { BoardCard, BoardColumnId, BoardData } from '../../types/data';
import { BOARD_COLUMNS, claimCard, releaseCard, updateCard } from '../../board/boardOps';
import { BoardMenu } from './BoardMenu';
import { avatarColor, avatarInitial, displayName, relativeTime, statusClass } from './boardUi';
import { useLabelColor } from './labelColors';

const ACTOR = 'you';

interface CardPropertiesProps {
  card: BoardCard;
  cards: BoardCard[];
  edit: (fn: (board: BoardData) => BoardData) => void;
  onMove: (to: BoardColumnId) => void;
}

/** The sidebar's Details panel: status, assignee and labels as menus, then dates. */
export function CardProperties({ card, cards, edit, onMove }: CardPropertiesProps) {
  return (
    <section className="board-overlay__section board-properties" data-testid="card-properties">
      <h2>Details</h2>
      <dl className="board-properties__list">
        <div>
          <dt>Status</dt>
          <dd><StatusMenu card={card} onMove={onMove} /></dd>
        </div>
        <div>
          <dt>Assignee</dt>
          <dd><AssigneeMenu card={card} cards={cards} edit={edit} /></dd>
        </div>
        <div>
          <dt>Labels</dt>
          <dd><LabelsField card={card} cards={cards} edit={edit} /></dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd className="board-properties__text">
            {displayName(card.createdBy)}, {relativeTime(card.createdAt)}
          </dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd className="board-properties__text">{relativeTime(card.updatedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}

function StatusMenu({ card, onMove }: Pick<CardPropertiesProps, 'card' | 'onMove'>) {
  const current = BOARD_COLUMNS.find((column) => column.id === card.column);

  return (
    <BoardMenu
      label="Status"
      testId="card-status"
      triggerClassName={`board-property board-status ${statusClass(card.column)}`}
      trigger={(
        <>
          <span className="board-status__dot" />
          <span className="board-property__value">{current?.title}</span>
          <ChevronDown size={14} className="board-property__chevron" />
        </>
      )}
    >
      {(close) => (
        <div role="listbox" aria-label="Status">
          {BOARD_COLUMNS.map((column) => (
            <button
              key={column.id}
              type="button"
              role="option"
              aria-selected={column.id === card.column}
              className={`board-menu__option board-status ${statusClass(column.id)}`}
              onClick={() => {
                close();
                if (column.id !== card.column) onMove(column.id);
              }}
            >
              <span className="board-status__dot" />
              <span className="board-menu__option-text">{column.title}</span>
              {column.id === card.column && <Check size={14} className="board-menu__check" />}
            </button>
          ))}
        </div>
      )}
    </BoardMenu>
  );
}

function knownNames(cards: BoardCard[]): string[] {
  const names = new Set<string>(['you']);
  for (const item of cards) {
    if (item.assignee) names.add(item.assignee);
    if (item.createdBy) names.add(item.createdBy);
  }
  return [...names];
}

function AssigneeMenu({ card, cards, edit }: Omit<CardPropertiesProps, 'onMove'>) {
  const [query, setQuery] = useState('');

  // One choice is one event: a claim for the new name or a release. Typing in
  // the search field writes nothing.
  const assign = (name: string | null) => {
    setQuery('');
    try {
      if (name && name !== card.assignee) {
        edit((board) => claimCard(board, { cardId: card.id }, name, Date.now()));
      } else if (!name && card.assignee) {
        edit((board) => releaseCard(board, { cardId: card.id }, ACTOR, Date.now()));
      }
    } catch {
      // The card was archived meanwhile.
    }
  };

  const needle = query.trim().toLowerCase();
  const names = knownNames(cards).filter(
    (name) => !needle || displayName(name).toLowerCase().includes(needle) || name.toLowerCase().includes(needle),
  );
  const typed = query.trim();
  const exact = names.find(
    (name) => name.toLowerCase() === needle || displayName(name).toLowerCase() === needle,
  );

  return (
    <BoardMenu
      label="Assignee"
      testId="card-assignee"
      triggerClassName="board-property"
      trigger={(
        <>
          <span
            className="board-avatar board-avatar--small"
            style={{ backgroundColor: avatarColor(card.assignee) }}
          >
            {avatarInitial(card.assignee)}
          </span>
          <span className={`board-property__value${card.assignee ? '' : ' board-property__value--empty'}`}>
            {card.assignee ? displayName(card.assignee) : 'Unassigned'}
          </span>
          <ChevronDown size={14} className="board-property__chevron" />
        </>
      )}
    >
      {(close) => (
        <>
          <input
            className="board-menu__search"
            aria-label="Assignee name"
            placeholder="Search or type a name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !typed) return;
              event.preventDefault();
              const name = exact ?? (typed.toLowerCase() === 'you' ? 'you' : typed);
              close();
              assign(name);
            }}
          />
          <div role="listbox" aria-label="Assignee">
            {names.map((name) => (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={name === card.assignee}
                className="board-menu__option"
                onClick={() => {
                  close();
                  assign(name);
                }}
              >
                <span className="board-avatar board-avatar--small" style={{ backgroundColor: avatarColor(name) }}>
                  {avatarInitial(name)}
                </span>
                <span className="board-menu__option-text">{displayName(name)}</span>
                {name === card.assignee && <Check size={14} className="board-menu__check" />}
              </button>
            ))}
            {typed && !exact && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="board-menu__option"
                onClick={() => {
                  close();
                  assign(typed);
                }}
              >
                <Plus size={14} className="board-menu__icon" />
                <span className="board-menu__option-text">Assign to “{typed}”</span>
              </button>
            )}
            {card.assignee && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="board-menu__option board-menu__option--quiet"
                onClick={() => {
                  close();
                  assign(null);
                }}
              >
                <X size={14} className="board-menu__icon" />
                <span className="board-menu__option-text">Unassign</span>
              </button>
            )}
          </div>
        </>
      )}
    </BoardMenu>
  );
}

/** Every label used on the board, most used first. */
export function boardLabels(cards: BoardCard[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of cards) {
    if (item.archivedAt) continue;
    for (const label of item.labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function LabelsField({ card, cards, edit }: Omit<CardPropertiesProps, 'onMove'>) {
  const labelColor = useLabelColor();
  const [query, setQuery] = useState('');
  const setLabels = (labels: string[]) => edit((board) => updateCard(board, {
    cardId: card.id,
    labels,
  }, ACTOR, Date.now()));
  const add = (label: string) => {
    const value = label.trim();
    setQuery('');
    if (!value || card.labels.some((item) => item.toLowerCase() === value.toLowerCase())) return;
    setLabels([...card.labels, value]);
  };

  const needle = query.trim().toLowerCase();
  const others = boardLabels(cards)
    .map((entry) => entry.label)
    .filter((label) => !card.labels.includes(label))
    .filter((label) => !needle || label.toLowerCase().includes(needle));
  const exists = boardLabels(cards).some((entry) => entry.label.toLowerCase() === needle);

  return (
    <div className="board-properties__labels">
      {card.labels.map((label) => (
        <span key={label} className="board-label board-label--removable" style={labelColor(label)}>
          {label}
          <button
            type="button"
            aria-label={`Remove label ${label}`}
            onClick={() => setLabels(card.labels.filter((item) => item !== label))}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <BoardMenu
        label="Add label"
        testId="card-add-label"
        triggerClassName="board-property board-property--add"
        align="end"
        trigger={(
          <>
            <Plus size={13} />
            <span>{card.labels.length ? '' : 'Add'}</span>
          </>
        )}
      >
        {() => (
          <>
            <input
              className="board-menu__search"
              aria-label="Label name"
              placeholder="Find or create a label"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !query.trim()) return;
                event.preventDefault();
                add(others.find((label) => label.toLowerCase() === needle) ?? query);
              }}
            />
            <div role="listbox" aria-label="Labels">
              {others.map((label) => (
                <button
                  key={label}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="board-menu__option"
                  onClick={() => add(label)}
                >
                  <span className="board-label" style={labelColor(label)}>{label}</span>
                </button>
              ))}
              {query.trim() && !exists && (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="board-menu__option"
                  onClick={() => add(query)}
                >
                  <Plus size={14} className="board-menu__icon" />
                  <span className="board-menu__option-text">Create “{query.trim()}”</span>
                </button>
              )}
              {!others.length && !query.trim() && (
                <p className="board-menu__empty">Type a name to create a label.</p>
              )}
            </div>
          </>
        )}
      </BoardMenu>
    </div>
  );
}
