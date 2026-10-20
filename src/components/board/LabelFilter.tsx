import { Check, ChevronDown, Tag, X } from 'lucide-react';
import { BoardMenu } from './BoardMenu';
import { useLabelColor } from './labelColors';

interface LabelFilterProps {
  labels: Array<{ label: string; count: number }>;
  selected: string[];
  onChange: (selected: string[]) => void;
}

const SHOWN = 2;

/** Board header control: pick one or more labels; the board shows cards with any of them. */
export function LabelFilter({ labels, selected, onChange }: LabelFilterProps) {
  const labelColor = useLabelColor();
  if (!labels.length && !selected.length) return null;
  const toggle = (label: string) => onChange(
    selected.includes(label) ? selected.filter((item) => item !== label) : [...selected, label],
  );

  return (
    <div className="board-label-filter">
      <BoardMenu
        label="Filter by label"
        testId="board-label-filter"
        align="end"
        triggerClassName={`board-filter${selected.length ? ' board-filter--active' : ''}`}
        trigger={selected.length ? (
          <>
            <Tag size={14} className="board-label-filter__icon" />
            {selected.slice(0, SHOWN).map((label) => (
              <span key={label} className="board-label" style={labelColor(label)}>{label}</span>
            ))}
            {selected.length > SHOWN && <span className="board-label-filter__more">+{selected.length - SHOWN}</span>}
            <ChevronDown size={14} className="board-property__chevron" />
          </>
        ) : (
          <>
            <Tag size={14} className="board-label-filter__icon" />
            Labels
            <ChevronDown size={14} className="board-property__chevron" />
          </>
        )}
      >
        {() => (
          <div role="listbox" aria-label="Labels" aria-multiselectable="true">
            {labels.map(({ label, count }) => (
              <button
                key={label}
                type="button"
                role="option"
                aria-selected={selected.includes(label)}
                className="board-menu__option"
                onClick={() => toggle(label)}
              >
                <span className="board-label-filter__box">
                  {selected.includes(label) && <Check size={12} />}
                </span>
                <span className="board-menu__option-text">
                  <span className="board-label" style={labelColor(label)}>{label}</span>
                </span>
                <span className="board-label-filter__count">{count}</span>
              </button>
            ))}
            {selected.length > 0 && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="board-menu__option board-menu__option--quiet"
                onClick={() => onChange([])}
              >
                <X size={14} className="board-menu__icon" />
                <span className="board-menu__option-text">Clear filter</span>
              </button>
            )}
          </div>
        )}
      </BoardMenu>
      {selected.length > 0 && (
        <button
          type="button"
          className="board-label-filter__clear"
          aria-label="Clear label filter"
          data-testid="board-label-filter-clear"
          onClick={() => onChange([])}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
