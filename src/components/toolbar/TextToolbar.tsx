import { useMemo, useRef, useState } from 'react';
import { Bold, Italic, Strikethrough, Code, Underline, Heading, List, ListOrdered, ListChecks, Link } from 'lucide-react';
import type { CanvasNode, TextNodeData, TextOptions } from '../../types/data';
import { useEditorStore, type EditorCommand, type FormatKind } from '../../stores/useEditorStore';
import { blockFormats } from '../../text/blockFormat';
import { formatSelectedTextBlocks } from '../../text/canvasFormat';
import { NO_FORMATS } from '../../text/doc';
import { ColorPopover } from './ColorPopover';
import { SizePopover } from './SizePopover';
import { PopoverPortal } from './PopoverPortal';
import './BottomToolbar.css';
import './Popover.css';

interface TextToolbarProps {
  options: TextOptions;
  onChange: (updates: Partial<TextOptions>) => void;
  /** The selected text blocks while no editor is open (REQ-TEXT-050). */
  selectedTextNodes?: CanvasNode[];
}

/**
 * Formatting lives on the text (docs/DESIGN_TEXT.md): while editing, the
 * buttons act on the selection and show its state; with blocks selected they
 * act on all of their text; with nothing to format they are off and never
 * touch the defaults of later blocks (REQ-TEXT-052).
 */
export function TextToolbar({ options, onChange, selectedTextNodes = [] }: TextToolbarProps) {
  const runCommand = useEditorStore((s) => s.runCommand);
  const liveFormats = useEditorStore((s) => s.formats);
  const editing = !!runCommand;
  const [headingsOpen, setHeadingsOpen] = useState(false);
  const headingRef = useRef<HTMLButtonElement>(null);

  const blockKey = selectedTextNodes.map((n) => `${n.id}\u0000${(n.data as TextNodeData).text}\u0000${(n.data as TextNodeData).fontStyle}`).join('\u0001');
  const selectedFormats = useMemo(
    () => (selectedTextNodes.length ? blockFormats(selectedTextNodes.map((n) => n.data as TextNodeData)) : null),
    // The key captures every field the formats depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blockKey],
  );

  const formats = editing ? liveFormats ?? NO_FORMATS : { ...NO_FORMATS, ...(selectedFormats ?? {}) };
  const inlineEnabled = editing || selectedTextNodes.length > 0;
  const editorOnly = !editing;

  // Prevent the click from stealing focus from the active editor
  // (which would commit the edit and lose the user's selection).
  const preserveFocus = (e: React.MouseEvent) => e.preventDefault();

  const inline = (kind: FormatKind) => () => {
    if (runCommand) runCommand(kind);
    else formatSelectedTextBlocks(kind);
  };
  const command = (c: EditorCommand) => () => runCommand?.(c);

  const button = (
    testId: string,
    title: string,
    pressed: boolean,
    disabled: boolean,
    onClick: () => void,
    icon: React.ReactNode,
  ) => (
    <button
      className={`text-toolbar__btn ${pressed ? 'text-toolbar__btn--active' : ''}`}
      onMouseDown={preserveFocus}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={title}
      data-testid={testId}
    >
      {icon}
    </button>
  );

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

      {button('format-bold', 'Bold (Ctrl+B)', formats.bold, !inlineEnabled, inline('bold'), <Bold size={16} />)}
      {button('format-italic', 'Italic (Ctrl+I)', formats.italic, !inlineEnabled, inline('italic'), <Italic size={16} />)}
      {button('format-underline', 'Underline (Ctrl+U)', formats.underline, !inlineEnabled, inline('underline'), <Underline size={16} />)}
      {button('format-strike', 'Strikethrough (Ctrl+Shift+X)', formats.strike, !inlineEnabled, inline('strike'), <Strikethrough size={16} />)}
      {button('format-code', 'Inline code (Ctrl+E) — while editing', formats.code, editorOnly, inline('code'), <Code size={16} />)}

      <div className="text-toolbar__divider" />

      <div className="popover-anchor">
        <button
          ref={headingRef}
          className={`text-toolbar__btn ${formats.heading > 0 ? 'text-toolbar__btn--active' : ''}`}
          onMouseDown={preserveFocus}
          onClick={() => setHeadingsOpen((o) => !o)}
          disabled={editorOnly}
          aria-pressed={formats.heading > 0}
          title="Heading (Ctrl+Shift+1/2/3, Ctrl+Shift+0 for text) — while editing"
          data-testid="format-heading"
        >
          <Heading size={16} />
        </button>
        <PopoverPortal
          open={headingsOpen && editing}
          anchorRef={headingRef}
          onClose={() => setHeadingsOpen(false)}
          className="toolbar-popover toolbar-popover--headings"
          testId="heading-popover"
        >
          {([1, 2, 3, 0] as const).map((level) => (
            <button
              key={level}
              className={`text-toolbar__btn text-toolbar__btn--label ${formats.heading === level ? 'text-toolbar__btn--active' : ''}`}
              onMouseDown={preserveFocus}
              onClick={() => {
                runCommand?.({ heading: level });
                setHeadingsOpen(false);
              }}
              aria-pressed={formats.heading === level}
              data-testid={`format-heading-${level}`}
              title={level ? `Heading ${level} (Ctrl+Shift+${level})` : 'Normal text (Ctrl+Shift+0)'}
            >
              {level ? `H${level}` : 'Text'}
            </button>
          ))}
        </PopoverPortal>
      </div>

      {button('format-list-bullet', 'Bulleted list (Ctrl+Shift+8) — while editing', formats.list === 'bullet', editorOnly, command({ list: 'bullet' }), <List size={16} />)}
      {button('format-list-number', 'Numbered list (Ctrl+Shift+7) — while editing', formats.list === 'number', editorOnly, command({ list: 'number' }), <ListOrdered size={16} />)}
      {button('format-list-task', 'Checklist (Ctrl+Shift+9, Ctrl+Enter to tick) — while editing', formats.list === 'task', editorOnly, command({ list: 'task' }), <ListChecks size={16} />)}
      {button('format-link', 'Link (Ctrl+K) — while editing', formats.link, editorOnly, command('link'), <Link size={16} />)}

      <div className="text-toolbar__divider" />

      <ColorPopover
        value={options.fill}
        onChange={(fill) => onChange({ fill })}
        label="Text Color"
      />
    </div>
  );
}
