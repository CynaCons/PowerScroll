import { useEffect, useRef } from 'react';
import { Html } from 'react-konva-utils';
import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, insertNewline, moveLineDown, moveLineUp } from '@codemirror/commands';
import { HighlightStyle, Language, defineLanguageFacet, syntaxHighlighting } from '@codemirror/language';
import { parser as markdownParser, GFM } from '@lezer/markdown';
import { tags } from '@lezer/highlight';
import type { CanvasNode, TextNodeData } from '../../types/data';
import { useEditorStore, type EditorCommand } from '../../stores/useEditorStore';
import { toggleFormat, type FormatKind, type ToggleResult } from '../../utils/markdownToggle';
import {
  backspaceMarker,
  continueListOnEnter,
  insertLink,
  pasteUrlOverSelection,
  setHeading,
  toggleList,
  toggleTaskChecked,
} from '../../utils/markdownCommands';
import { applyListIndent } from '../../utils/listIndent';
import { htmlToMarkdown } from '../../utils/htmlToMarkdown';
import { MIN_TEXT_WIDTH } from '../../utils/pageLayout';

/**
 * The text-block editor: CodeMirror over the block's markdown.
 *
 * The text stays markdown (what is saved, rendered and read by agents), but it
 * is drawn styled while you type: bold is bold, headings are large, code is
 * monospace, and the markers themselves are dimmed. CodeMirror brings a real
 * undo history, IME and mobile input; the markdown commands (formatting,
 * headings, lists, links, list continuation) are the shared pure functions in
 * utils/, applied as minimal edits so each is one undo step.
 */

const markdownLanguage = new Language(
  defineLanguageFacet({ commentTokens: { block: { open: '<!--', close: '-->' } } }),
  markdownParser.configure([GFM]),
  [],
  'markdown',
);

const MARK = 'rgba(100, 116, 139, 0.75)';

/** Sizes match the rendered view (REQ-TEXT-030) so a heading does not jump on commit. */
const markdownStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.6em', fontWeight: '700' },
  { tag: tags.heading2, fontSize: '1.3em', fontWeight: '600' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontSize: '1.1em', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace', fontSize: '0.92em' },
  { tag: tags.link, color: '#2563eb' },
  { tag: tags.url, color: MARK },
  { tag: tags.quote, color: '#475569', fontStyle: 'italic' },
  { tag: [tags.processingInstruction, tags.contentSeparator], color: MARK },
  { tag: tags.angleBracket, color: MARK },
  // Task boxes ([ ] / [x]).
  { tag: tags.atom, color: MARK },
]);

/** Box and type that mirror the rendered block, so text stays put when editing starts. */
const editorTheme = EditorView.theme({
  '&': {
    border: '2px solid #2563eb',
    borderRadius: '3px',
    background: '#ffffff',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.4', overflow: 'visible' },
  '.cm-content': { padding: '4px', caretColor: '#14181A', minHeight: '1.4em' },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: '#94a3b8' },
});

/** The test and capture hook: read and drive the live editor without a textarea. */
export interface TextEditorHandle {
  getValue: () => string;
  setValue: (text: string) => void;
  getSelection: () => [number, number];
  setSelection: (from: number, to?: number) => void;
}

function apply(view: EditorView, next: ToggleResult | null): boolean {
  if (!next) return false;
  const value = view.state.doc.toString();
  let head = 0;
  while (head < value.length && head < next.value.length && value[head] === next.value[head]) head++;
  let tail = 0;
  while (
    tail < value.length - head &&
    tail < next.value.length - head &&
    value[value.length - 1 - tail] === next.value[next.value.length - 1 - tail]
  ) tail++;
  view.dispatch({
    changes: next.value === value ? [] : { from: head, to: value.length - tail, insert: next.value.slice(head, next.value.length - tail) },
    selection: EditorSelection.single(next.selStart, next.selEnd),
    scrollIntoView: true,
    userEvent: 'input.format',
  });
  return true;
}

type Command = (value: string, from: number, to: number) => ToggleResult | null;

function run(view: EditorView, command: Command): boolean {
  const { from, to } = view.state.selection.main;
  return apply(view, command(view.state.doc.toString(), from, to));
}

function commandFor(command: EditorCommand): Command {
  if (command === 'link') return insertLink;
  if (typeof command === 'string') return (v, s, e) => toggleFormat(v, s, e, command as FormatKind);
  if ('heading' in command) return (v, s, e) => setHeading(v, s, e, command.heading);
  return (v, s, e) => toggleList(v, s, e, command.list);
}

interface TextEditorProps {
  node: CanvasNode;
  stageScale: number;
  /** Where the user double-clicked (client px), to put the caret there. */
  caretAt?: { x: number; y: number } | null;
  /** `escape` is true when the user left with Escape rather than by clicking away. */
  onFinish: (newText: string, escape?: boolean) => void;
  onCancel: () => void;
}

export function TextEditor({ node, caretAt, onFinish, onCancel }: TextEditorProps) {
  // Offset by -2 so the 2px border keeps the text where the rendered block shows it.
  return (
    <Html groupProps={{ x: node.x - 2, y: node.y - 2 }} divProps={{ style: {} }}>
      <MarkdownEditor node={node} caretAt={caretAt} onFinish={onFinish} onCancel={onCancel} />
    </Html>
  );
}

function MarkdownEditor({ node, caretAt, onFinish, onCancel }: Omit<TextEditorProps, 'stageScale'>) {
  const data = node.data as TextNodeData;
  const hostRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const callbacks = useRef({ onFinish, onCancel });
  callbacks.current = { onFinish, onCancel };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const finish = (view: EditorView, escape = false) => {
      if (done.current) return;
      done.current = true;
      callbacks.current.onFinish(view.state.doc.toString(), escape);
    };

    const shortcuts = keymap.of([
      { key: 'Mod-b', run: (v) => run(v, commandFor('bold')) },
      { key: 'Mod-i', run: (v) => run(v, commandFor('italic')) },
      { key: 'Mod-u', run: (v) => run(v, commandFor('underline')) },
      { key: 'Mod-e', run: (v) => run(v, commandFor('code')) },
      { key: 'Mod-Shift-x', run: (v) => run(v, commandFor('strike')) },
      { key: 'Mod-k', run: (v) => run(v, insertLink) },
      // Headings: Ctrl+Shift+digit works on every layout (like the list keys below);
      // Ctrl+Alt+digit is the Google Docs habit, but on AZERTY/QWERTZ it is AltGr and types characters.
      ...[0, 1, 2, 3].flatMap((level) => [
        { key: `Mod-Shift-${level}`, run: (v: EditorView) => run(v, commandFor({ heading: level })) },
        { key: `Mod-Alt-${level}`, run: (v: EditorView) => run(v, commandFor({ heading: level })) },
      ]),
      { key: 'Mod-Shift-8', run: (v) => run(v, commandFor({ list: 'bullet' })) },
      { key: 'Mod-Shift-7', run: (v) => run(v, commandFor({ list: 'number' })) },
      { key: 'Mod-Shift-9', run: (v) => run(v, commandFor({ list: 'task' })) },
      { key: 'Mod-Enter', run: (v) => run(v, toggleTaskChecked) },
      { key: 'Alt-ArrowUp', run: moveLineUp },
      { key: 'Alt-ArrowDown', run: moveLineDown },
      // Outside a list, Enter is a plain line break (no auto-indent).
      { key: 'Enter', run: (v) => run(v, continueListOnEnter) || insertNewline(v) },
      { key: 'Backspace', run: (v) => run(v, backspaceMarker) },
      {
        key: 'Tab',
        run: (v) => run(v, (value, s, e) => {
          const next = applyListIndent(value, s, e, 'in');
          return { value: next.text, selStart: next.selStart, selEnd: next.selEnd };
        }),
        shift: (v) => run(v, (value, s, e) => {
          const next = applyListIndent(value, s, e, 'out');
          return { value: next.text, selStart: next.selStart, selEnd: next.selEnd };
        }),
      },
      // Escape leaves editing, keeps the text and lets go of the block; Ctrl+Z reverts.
      { key: 'Escape', run: (v) => (finish(v, true), true) },
    ]);

    const extensions: Extension[] = [
      history(),
      shortcuts,
      keymap.of([...historyKeymap, ...defaultKeymap]),
      markdownLanguage,
      syntaxHighlighting(markdownStyle),
      editorTheme,
      EditorView.lineWrapping,
      placeholder('Type here: # heading, - list, **bold**'),
      EditorView.contentAttributes.of({ spellcheck: 'true', 'aria-label': 'Text block', 'data-testid': 'text-editor' }),
      EditorView.domEventHandlers({
        paste: (event, view) => {
          const { from, to } = view.state.selection.main;
          const value = view.state.doc.toString();
          const plain = event.clipboardData?.getData('text/plain') ?? '';
          const linked = pasteUrlOverSelection(value, from, to, plain);
          if (linked) {
            event.preventDefault();
            return apply(view, linked);
          }
          const md = htmlToMarkdown(event.clipboardData?.getData('text/html') ?? '');
          if (md === null || md === plain.trim()) return false;
          event.preventDefault();
          view.dispatch(view.state.replaceSelection(md), { userEvent: 'input.paste', scrollIntoView: true });
          return true;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.focusChanged && !update.view.hasFocus) {
          // Defer a tick: a toolbar click refocuses the editor right away.
          setTimeout(() => {
            if (!update.view.hasFocus && document.activeElement !== update.view.contentDOM) finish(update.view);
          }, 0);
        }
      }),
    ];

    const text = data.text ?? '';
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: text, selection: EditorSelection.cursor(text.length), extensions }),
    });

    // Put the caret where the user double-clicked; a fresh block starts empty.
    let placed = false;
    const placeCaret = () => {
      if (!caretAt || placed) return;
      placed = true;
      requestAnimationFrame(() => {
        const pos = view.posAtCoords(caretAt, false);
        view.dispatch({ selection: EditorSelection.cursor(pos) });
      });
    };
    const focus = () => {
      view.focus();
      if (view.hasFocus) placeCaret();
      return view.hasFocus;
    };
    const timers = focus() ? [] : [10, 50, 150].map((ms) => setTimeout(focus, ms));

    const runCommand = (command: EditorCommand) => {
      if (!view.hasFocus) view.focus();
      run(view, commandFor(command));
    };
    useEditorStore.getState().registerEditor(view.dom, runCommand);
    const handle: TextEditorHandle = {
      getValue: () => view.state.doc.toString(),
      setValue: (value) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, selection: EditorSelection.cursor(value.length) }),
      getSelection: () => [view.state.selection.main.from, view.state.selection.main.to],
      setSelection: (from, to = from) => {
        view.focus();
        view.dispatch({ selection: EditorSelection.single(from, to) });
      },
    };
    const win = window as unknown as { __POWERNOTE_TEXT_EDITOR__?: TextEditorHandle };
    win.__POWERNOTE_TEXT_EDITOR__ = handle;

    return () => {
      timers.forEach(clearTimeout);
      useEditorStore.getState().unregisterEditor(view.dom);
      if (win.__POWERNOTE_TEXT_EDITOR__ === handle) delete win.__POWERNOTE_TEXT_EDITOR__;
      view.destroy();
    };
    // The editor is created once per edit session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      className="powernote-text-editor"
      // Keys stay in the editor: canvas shortcuts (Delete, arrows, tools) must not fire.
      onKeyDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        // Border (2) + padding (4) each side: the text wraps at the rendered block's width.
        width: Math.max(node.width, MIN_TEXT_WIDTH) + 4,
        fontSize: data.fontSize,
        fontFamily: data.fontFamily,
        fontStyle: data.fontStyle.includes('italic') ? 'italic' : 'normal',
        fontWeight: data.fontStyle.includes('bold') ? 'bold' : 'normal',
        color: data.fill,
        boxSizing: 'content-box',
      }}
    />
  );
}
