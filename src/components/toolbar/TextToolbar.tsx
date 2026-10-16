import { useRef, useState } from 'react';
import { Bold, Italic, Strikethrough, Code, Underline, Heading, List, ListOrdered, ListChecks, Link } from 'lucide-react';
import type { TextOptions } from '../../types/data';
import { useEditorStore, type EditorCommand } from '../../stores/useEditorStore';
import type { FormatKind } from '../../utils/markdownToggle';
import { ColorPopover } from './ColorPopover';
import { SizePopover } from './SizePopover';
import { PopoverPortal } from './PopoverPortal';
import './BottomToolbar.css';
import './Popover.css';

interface TextToolbarProps {
  options: TextOptions;
  onChange: (updates: Partial<TextOptions>) => void;
}

export function TextToolbar({ options, onChange }: TextToolbarProps) {
  const isBold = options.fontStyle.includes('bold');
  const isItalic = options.fontStyle.includes('italic');
  const applyFormat = useEditorStore((s) => s.applyFormat);
  const runCommand = useEditorStore((s) => s.runCommand);
  const inlineDisabled = !applyFormat;
  const [headingsOpen, setHeadingsOpen] = useState(false);
  const headingRef = useRef<HTMLButtonElement>(null);
  const command = (c: EditorCommand) => () => runCommand?.(c);

  // Prevent the click from stealing focus from the active textarea
  // (which would commit the edit and lose the user's selection).
  const preserveFocus = (e: React.MouseEvent) => e.preventDefault();

  const toggleBold = () => {
    // While a text block is being edited, bold only the selected text via inline
    // markdown (**...**) — never the whole block.
    if (applyFormat) {
      applyFormat('bold');
      return;
    }
    // No active edit: toggle the whole selected block's fontStyle (legacy behavior)
    let style = options.fontStyle;
    if (isBold) {
      style = style.replace('bold', '').trim() || 'normal';
    } else {
      style = style === 'normal' ? 'bold' : `bold ${style}`;
    }
    onChange({ fontStyle: style });
  };

  const toggleItalic = () => {
    if (applyFormat) {
      applyFormat('italic');
      return;
    }
    let style = options.fontStyle;
    if (isItalic) {
      style = style.replace('italic', '').trim() || 'normal';
    } else {
      style = style === 'normal' ? 'italic' : `${style} italic`;
    }
    onChange({ fontStyle: style });
  };

  const inlineOnly = (kind: FormatKind) => () => {
    applyFormat?.(kind);
  };

  return (
    <div className="text-toolbar">
      <SizePopover
        value={options.fontSize}
        onChange={(fontSize) => onChange({ fontSize })}
        min={8}
        max={72}
        label="Font Size"
        icon="text"
        unit="px"
      />

      <div className="text-toolbar__divider" />

      <button
        className={`text-toolbar__btn ${isBold ? 'text-toolbar__btn--active' : ''}`}
        onMouseDown={preserveFocus}
        onClick={toggleBold}
        title="Bold (Ctrl+B)"
        data-testid="format-bold"
      >
        <Bold size={16} />
      </button>

      <button
        className={`text-toolbar__btn ${isItalic ? 'text-toolbar__btn--active' : ''}`}
        onMouseDown={preserveFocus}
        onClick={toggleItalic}
        title="Italic (Ctrl+I)"
        data-testid="format-italic"
      >
        <Italic size={16} />
      </button>

      <button
        className="text-toolbar__btn"
        onMouseDown={preserveFocus}
        onClick={inlineOnly('underline')}
        disabled={inlineDisabled}
        title="Underline (Ctrl+U) — only while editing"
        data-testid="format-underline"
      >
        <Underline size={16} />
      </button>

      <button
        className="text-toolbar__btn"
        onMouseDown={preserveFocus}
        onClick={inlineOnly('strike')}
        disabled={inlineDisabled}
        title="Strikethrough (Ctrl+Shift+X) — only while editing"
        data-testid="format-strike"
      >
        <Strikethrough size={16} />
      </button>

      <button
        className="text-toolbar__btn"
        onMouseDown={preserveFocus}
        onClick={inlineOnly('code')}
        disabled={inlineDisabled}
        title="Inline code (Ctrl+E) — only while editing"
        data-testid="format-code"
      >
        <Code size={16} />
      </button>

      <div className="text-toolbar__divider" />

      <div className="popover-anchor">
        <button
          ref={headingRef}
          className="text-toolbar__btn"
          onMouseDown={preserveFocus}
          onClick={() => setHeadingsOpen((o) => !o)}
          disabled={inlineDisabled}
          title="Heading (Ctrl+Shift+1/2/3, Ctrl+Shift+0 for text) — only while editing"
          data-testid="format-heading"
        >
          <Heading size={16} />
        </button>
        <PopoverPortal
          open={headingsOpen && !inlineDisabled}
          anchorRef={headingRef}
          onClose={() => setHeadingsOpen(false)}
          className="toolbar-popover toolbar-popover--headings"
          testId="heading-popover"
        >
          {([1, 2, 3, 0] as const).map((level) => (
            <button
              key={level}
              className="text-toolbar__btn text-toolbar__btn--label"
              onMouseDown={preserveFocus}
              onClick={() => {
                runCommand?.({ heading: level });
                setHeadingsOpen(false);
              }}
              data-testid={`format-heading-${level}`}
              title={level ? `Heading ${level} (Ctrl+Shift+${level})` : 'Normal text (Ctrl+Shift+0)'}
            >
              {level ? `H${level}` : 'Text'}
            </button>
          ))}
        </PopoverPortal>
      </div>

      <button
        className="text-toolbar__btn"
        onMouseDown={preserveFocus}
        onClick={command({ list: 'bullet' })}
        disabled={inlineDisabled}
        title="Bulleted list (Ctrl+Shift+8) — only while editing"
        data-testid="format-list-bullet"
      >
        <List size={16} />
      </button>

      <button
        className="text-toolbar__btn"
        onMouseDown={preserveFocus}
        onClick={command({ list: 'number' })}
        disabled={inlineDisabled}
        title="Numbered list (Ctrl+Shift+7) — only while editing"
        data-testid="format-list-number"
      >
        <ListOrdered size={16} />
      </button>

      <button
        className="text-toolbar__btn"
        onMouseDown={preserveFocus}
        onClick={command({ list: 'task' })}
        disabled={inlineDisabled}
        title="Checklist (Ctrl+Shift+9, Ctrl+Enter to tick) — only while editing"
        data-testid="format-list-task"
      >
        <ListChecks size={16} />
      </button>

      <button
        className="text-toolbar__btn"
        onMouseDown={preserveFocus}
        onClick={command('link')}
        disabled={inlineDisabled}
        title="Link (Ctrl+K) — only while editing"
        data-testid="format-link"
      >
        <Link size={16} />
      </button>

      <div className="text-toolbar__divider" />

      <ColorPopover
        value={options.fill}
        onChange={(fill) => onChange({ fill })}
        label="Text Color"
      />
    </div>
  );
}
