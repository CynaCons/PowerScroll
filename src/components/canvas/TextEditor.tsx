import { useEffect, useRef } from 'react';
import { Html } from 'react-konva-utils';
import type { CanvasNode, TextNodeData } from '../../types/data';
import { useEditorStore } from '../../stores/useEditorStore';
import { FORMAT_MARKERS, toggleFormat, type FormatKind } from '../../utils/markdownToggle';
import { applyListIndent } from '../../utils/listIndent';
import { MIN_TEXT_WIDTH, MAX_TEXT_WIDTH } from '../../utils/pageLayout';

/**
 * Replace the textarea's selected range with new text using a native-compatible
 * approach that integrates with the browser's undo stack.
 *
 * Falls back to direct value assignment if execCommand is not supported.
 */
function replaceSelection(
  ta: HTMLTextAreaElement,
  selStart: number,
  selEnd: number,
  newText: string,
): void {
  ta.focus();
  ta.setSelectionRange(selStart, selEnd);
  try {
    const ok = document.execCommand('insertText', false, newText);
    if (ok) return;
  } catch {
    // Ignore — fall through to fallback
  }
  // Fallback: direct mutation (no undo history)
  const before = ta.value.substring(0, selStart);
  const after = ta.value.substring(selEnd);
  ta.value = before + newText + after;
}

/**
 * Toggle an inline format (bold, italic, ...) on the textarea's selection.
 *
 * Formatting is markdown in the text itself (`**word**`) and touches only the
 * selection, line by line inside each line's list/heading/quote prefix, so a
 * whole list row selected gives '- **row**' and the list survives
 * (toggleFormat). With no selection, an empty marker pair is inserted and the
 * caret parked between them so the user can type formatted text directly.
 */
function applyFormatKind(ta: HTMLTextAreaElement, kind: FormatKind): void {
  const value = ta.value;
  const next = toggleFormat(value, ta.selectionStart, ta.selectionEnd, kind);
  if (next.value !== value) {
    // Replace only the changed middle so the browser undo step stays small.
    let head = 0;
    while (head < value.length && head < next.value.length && value[head] === next.value[head]) head++;
    let tail = 0;
    while (
      tail < value.length - head &&
      tail < next.value.length - head &&
      value[value.length - 1 - tail] === next.value[next.value.length - 1 - tail]
    ) tail++;
    replaceSelection(ta, head, value.length - tail, next.value.slice(head, next.value.length - tail));
  }
  ta.selectionStart = next.selStart;
  ta.selectionEnd = next.selEnd;
}

// ── Active editor registry ────────────────────────────────────────────────
// Lets external UI (the bottom toolbar) apply inline formatting to the text
// block currently being edited, targeting only the live textarea selection.
export interface ActiveTextEditor {
  applyFormat: (markerOrKind: string | FormatKind) => void;
  hasSelection: () => boolean;
}
let activeTextEditor: ActiveTextEditor | null = null;
export function getActiveTextEditor(): ActiveTextEditor | null {
  return activeTextEditor;
}

interface TextEditorProps {
  node: CanvasNode;
  stageScale: number;
  onFinish: (newText: string) => void;
  onCancel: () => void;
}

export function TextEditor({ node, stageScale: _stageScale, onFinish, onCancel }: TextEditorProps) {
  const data = node.data as TextNodeData;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoHeight = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  };

  // Focus the textarea reliably — the Html portal renders async,
  // so we retry until it's in the DOM and focusable
  useEffect(() => {
    const focusTextarea = () => {
      const textarea = textareaRef.current;
      if (!textarea) return false;
      textarea.focus();
      textarea.select();
      autoHeight(textarea);
      return document.activeElement === textarea;
    };

    if (focusTextarea()) return;

    // Retry with increasing delays for async portal rendering
    const t1 = setTimeout(focusTextarea, 10);
    const t2 = setTimeout(focusTextarea, 50);
    const t3 = setTimeout(focusTextarea, 150);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // Register this editor so the bottom toolbar can format the live selection
  useEffect(() => {
    const apply = (markerOrKind: string | FormatKind) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const kind: FormatKind | undefined =
        markerOrKind === '**' ? 'bold'
        : markerOrKind === '*' ? 'italic'
        : Object.prototype.hasOwnProperty.call(FORMAT_MARKERS, markerOrKind) ? (markerOrKind as FormatKind)
        : undefined;
      if (kind) applyFormatKind(ta, kind);
      autoHeight(ta);
    };

    const editor: ActiveTextEditor = {
      applyFormat: apply,
      hasSelection: () => {
        const ta = textareaRef.current;
        return !!ta && ta.selectionStart !== ta.selectionEnd;
      },
    };
    activeTextEditor = editor;

    let registeredEl: HTMLTextAreaElement | null = null;
    const tryRegister = () => {
      const ta = textareaRef.current;
      if (!ta || registeredEl === ta) return !!ta;
      useEditorStore.getState().registerEditor(ta, (kind) => apply(kind));
      registeredEl = ta;
      return true;
    };

    let timers: ReturnType<typeof setTimeout>[] = [];
    if (!tryRegister()) {
      timers = [
        setTimeout(tryRegister, 10),
        setTimeout(tryRegister, 50),
        setTimeout(tryRegister, 150),
      ];
    }

    return () => {
      timers.forEach(clearTimeout);
      if (activeTextEditor === editor) activeTextEditor = null;
      if (registeredEl) useEditorStore.getState().unregisterEditor(registeredEl);
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Inline formatting shortcuts (must come before the generic stopPropagation)
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      let kind: FormatKind | null = null;
      if (k === 'b' && !e.shiftKey) kind = 'bold';
      else if (k === 'i' && !e.shiftKey) kind = 'italic';
      else if (k === 'u' && !e.shiftKey) kind = 'underline';
      else if (k === 'e' && !e.shiftKey) kind = 'code';
      else if (k === 'x' && e.shiftKey) kind = 'strike';
      if (kind) {
        e.preventDefault();
        e.stopPropagation();
        applyFormatKind(textarea, kind);
        autoHeight(textarea);
        return;
      }
    }

    // Tab / Shift+Tab: indent / unindent (list-aware; numbered items nest)
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const next = applyListIndent(textarea.value, start, end, e.shiftKey ? 'out' : 'in');
      if (next.text !== textarea.value) {
        replaceSelection(textarea, 0, textarea.value.length, next.text);
        textarea.selectionStart = next.selStart;
        textarea.selectionEnd = next.selEnd;
      }
      autoHeight(textarea);
      return;
    }

    // Enter: auto-continue bullet/numbered lists
    if (e.key === 'Enter' && !e.shiftKey) {
      const start = textarea.selectionStart;
      const value = textarea.value;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const currentLine = value.substring(lineStart, start);

      // Check for checkbox pattern: "- [ ] text" or "- [x] text"
      const checkboxMatch = currentLine.match(/^(\s*)- \[[ x]\]\s/);
      if (checkboxMatch) {
        e.preventDefault();
        const indent = checkboxMatch[0].length > 6 ? checkboxMatch[1] : '';
        const contentAfter = currentLine.substring(checkboxMatch[0].length).trim();
        if (contentAfter === '') {
          textarea.value = value.substring(0, lineStart) + value.substring(start);
          textarea.selectionStart = lineStart;
          textarea.selectionEnd = lineStart;
        } else {
          const insert = `\n${indent}- [ ] `;
          textarea.value = value.substring(0, start) + insert + value.substring(start);
          textarea.selectionStart = start + insert.length;
          textarea.selectionEnd = start + insert.length;
        }
        autoHeight(textarea);
        return;
      }

      // Check for bullet point pattern: "  • text" or "  - text" or "  * text"
      const bulletMatch = currentLine.match(/^(\s*)([-*•])\s/);
      if (bulletMatch) {
        e.preventDefault();
        const indent = bulletMatch[1];
        const bullet = bulletMatch[2];
        // If the line is just the bullet with no content, remove it (end the list)
        const contentAfterBullet = currentLine.substring(bulletMatch[0].length).trim();
        if (contentAfterBullet === '') {
          // Remove the empty bullet line
          textarea.value = value.substring(0, lineStart) + value.substring(start);
          textarea.selectionStart = lineStart;
          textarea.selectionEnd = lineStart;
        } else {
          const insert = `\n${indent}${bullet} `;
          textarea.value = value.substring(0, start) + insert + value.substring(start);
          textarea.selectionStart = start + insert.length;
          textarea.selectionEnd = start + insert.length;
        }
        autoHeight(textarea);
        return;
      }

      // Check for numbered list pattern: "  1. text"
      const numberMatch = currentLine.match(/^(\s*)(\d+)\.\s/);
      if (numberMatch) {
        e.preventDefault();
        const indent = numberMatch[1];
        const num = parseInt(numberMatch[2], 10);
        const contentAfterNumber = currentLine.substring(numberMatch[0].length).trim();
        if (contentAfterNumber === '') {
          textarea.value = value.substring(0, lineStart) + value.substring(start);
          textarea.selectionStart = lineStart;
          textarea.selectionEnd = lineStart;
        } else {
          const insert = `\n${indent}${num + 1}. `;
          textarea.value = value.substring(0, start) + insert + value.substring(start);
          textarea.selectionStart = start + insert.length;
          textarea.selectionEnd = start + insert.length;
        }
        autoHeight(textarea);
        return;
      }

      // Default: Shift+Enter behavior (new line) since we use Enter for plain text too
      // Actually for a text editor, Enter should just create a new line
      // Let it pass through naturally
    }

    // Escape: cancel
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }

    e.stopPropagation();
  };

  const handleBlur = () => {
    onFinish(textareaRef.current?.value ?? '');
  };

  const handleInput = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    autoHeight(textarea);
  };

  // Mirror TextNode's rendered div exactly so the editing experience
  // visually matches the committed text. <Html> handles the stage-scale
  // transform automatically — do NOT manually multiply by stageScale.
  // Offset by -2 to compensate for the 2px border so the text baseline
  // lines up pixel-perfect with where the rendered div showed it.
  return (
    <Html
      groupProps={{
        x: node.x - 2,
        y: node.y - 2,
      }}
      divProps={{
        style: {},
      }}
    >
      <textarea
        ref={textareaRef}
        defaultValue={data.text}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onInput={handleInput}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          minWidth: MIN_TEXT_WIDTH,
          maxWidth: MAX_TEXT_WIDTH,
          width: Math.max(node.width, MIN_TEXT_WIDTH),
          minHeight: 24,
          fontSize: data.fontSize,
          fontFamily: data.fontFamily,
          fontStyle: data.fontStyle.includes('italic') ? 'italic' : 'normal',
          fontWeight: data.fontStyle.includes('bold') ? 'bold' : 'normal',
          color: data.fill,
          border: '2px solid #2563eb',
          borderRadius: 3,
          padding: 4,
          margin: 0,
          outline: 'none',
          resize: 'none',
          overflow: 'hidden',
          background: '#ffffff',
          lineHeight: '1.4',
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
          tabSize: 2,
          boxSizing: 'content-box',
        }}
      />
    </Html>
  );
}
