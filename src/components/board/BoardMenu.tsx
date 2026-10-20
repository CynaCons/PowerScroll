import { useEffect, useRef, useState, type ReactNode } from 'react';

interface BoardMenuProps {
  /** Accessible name of the trigger, e.g. "Status". */
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  testId?: string;
  align?: 'start' | 'end';
  /** Popover content; call `close` after a choice that should dismiss the menu. */
  children: (close: () => void) => ReactNode;
}

const FOCUSABLE = 'input, [role="option"]';

/**
 * A trigger button with a small anchored popover, used for card properties and
 * the board's label filter. Arrow keys move between the options, Escape and a
 * click outside close it, and focus returns to the trigger.
 */
export function BoardMenu({
  label,
  trigger,
  triggerClassName = '',
  testId,
  align = 'start',
  children,
}: BoardMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const first = popover.current?.querySelector<HTMLElement>('input')
      ?? popover.current?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?? popover.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);

  const navigate = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...(popover.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown'
      ? items[(at + 1) % items.length]
      : items[(at - 1 + items.length) % items.length];
    next.focus();
  };

  return (
    <div className="board-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className={`board-menu__trigger ${triggerClassName}`.trim()}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen((current) => !current)}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={popover}
          className={`board-menu__popover board-menu__popover--${align}`}
          data-board-menu=""
          onKeyDown={navigate}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
