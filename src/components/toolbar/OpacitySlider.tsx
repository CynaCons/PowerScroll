import { useRef, useState } from 'react';
import { PopoverPortal } from './PopoverPortal';
import './Popover.css';
import './BottomToolbar.css';

interface OpacitySliderProps {
  value: number;
  onChange: (opacity: number) => void;
}

/** Compact 0–100 opacity control shared by shape, image and draw toolbars. */
export function OpacitySlider({ value, onChange }: OpacitySliderProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pct = Math.round(Math.max(0, Math.min(1, value ?? 1)) * 100);

  return (
    <div className="popover-anchor">
      <button
        ref={triggerRef}
        className="toolbar-popover-trigger"
        onClick={() => setOpen((o) => !o)}
        title="Opacity"
        data-testid="opacity-trigger"
      >
        <span className="toolbar-popover-trigger__value">{pct}%</span>
      </button>

      <PopoverPortal
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        className="toolbar-popover toolbar-popover--size"
        testId="opacity-popover"
      >
        <div className="toolbar-popover__title">Opacity</div>
        <div className="size-popover__slider">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={pct}
            onChange={(e) => onChange(Number(e.target.value) / 100)}
            className="size-popover__range"
            data-testid="opacity-slider"
          />
          <span className="size-popover__readout">{pct}%</span>
        </div>
      </PopoverPortal>
    </div>
  );
}
