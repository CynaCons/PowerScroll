import { useEffect, useRef, useState } from 'react';
import { Html } from 'react-konva-utils';
import { EditorState, NodeSelection, Plugin, TextSelection, type Command } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { tableEditing } from 'prosemirror-tables';
import { EDIT_MATH_EVENT, MathView } from '../../text/mathView';
import { looksLikeMarkdown } from '../../text/paste';
import { keymap } from 'prosemirror-keymap';
import { history, redo, undo } from 'prosemirror-history';
import { baseKeymap, chainCommands, toggleMark } from 'prosemirror-commands';
import { undoInputRule } from 'prosemirror-inputrules';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import type { CanvasNode, TextNodeData } from '../../types/data';
import { useEditorStore, type EditorCommand } from '../../stores/useEditorStore';
import { schema, FORMAT_MARK } from '../../text/schema';
import { parseMarkdown } from '../../text/parse';
import { serializeMarkdown } from '../../text/serialize';
import { activeFormats, offsetFromPos, posFromOffset } from '../../text/doc';
import { docWithLegacyStyle } from '../../text/blockFormat';
import { textInputRules } from '../../text/inputRules';
import {
  applyLink, backspaceAfterList, backspaceMarker, enterKey, isUrl, linkRangeAt, moveRow, normalizeHref, setHeading, setTaskChecked, shiftTabKey,
  tabKey, toggleList, toggleTaskChecked,
} from '../../text/commands';
import { htmlToMarkdown } from '../../utils/htmlToMarkdown';
import { MIN_TEXT_WIDTH } from '../../utils/pageLayout';
import { MARKDOWN_CLASS, MARKDOWN_LINE_HEIGHT, MARKDOWN_PADDING } from '../../utils/renderMarkdown';

/**
 * The text-block editor: ProseMirror over the block's document (docs/DESIGN_TEXT.md).
 *
 * The block's markdown is parsed into the same document the finished block
 * is drawn from, and edited as structure: formats are marks, lists are
 * lists, so every command switches cleanly on and off and the editor shows
 * exactly what the block will show (REQ-TEXT-054). On leaving, the document
 * is serialized back to markdown; an unchanged document keeps the original
 * string byte for byte (REQ-TEXT-064).
 */

/** The test and capture hook: read and drive the live editor. */
export interface TextEditorHandle {
  /** The editor's markdown (the original string while nothing changed). */
  getValue: () => string;
  /** Replace the whole text with markdown, caret at the end. */
  setValue: (text: string) => void;
  /**
   * Selection as offsets into the document's plain text: textblocks joined
   * by one "\n", a hard break is "\n", any other inline leaf is one
   * character; markers and structure take no characters (see text/doc.ts).
   */
  getSelection: () => [number, number];
  setSelection: (from: number, to?: number) => void;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * Read the DOM selection into the editor state now. Chrome delivers
 * `selectionchange` after the next key event, so a command right after a
 * double-click would otherwise act on the selection before it.
 */
function syncSelection(view: EditorView) {
  (view as unknown as { domObserver: { flush(): void } }).domObserver.flush();
}

/** The word around `pos` in its textblock, or null when `pos` is not on a word. */
function wordRangeAt(doc: PMNode, pos: number): { from: number; to: number } | null {
  const $pos = doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, '\n', '\uFFFC');
  const off = $pos.parentOffset;
  if (!WORD_CHAR.test(text[off] ?? '') && !WORD_CHAR.test(text[off - 1] ?? '')) return null;
  let a = off;
  while (a > 0 && WORD_CHAR.test(text[a - 1])) a--;
  let b = off;
  while (b < text.length && WORD_CHAR.test(text[b])) b++;
  return { from: $pos.start() + a, to: $pos.start() + b };
}

/** Set by Ctrl+Shift+V: the next paste (within this time) goes in as typed. */
let plainPasteUntil = 0;

/** Where focus may go without ending the edit: the editor itself and the bottom toolbar. */
const KEEPS_EDITING = '.bottom-toolbar, [data-testid="bottom-toolbar"], .toolbar-popover';

const placeholderPlugin = new Plugin({
  props: {
    decorations(state) {
      const first = state.doc.firstChild;
      if (state.doc.childCount === 1 && first && first.isTextblock && first.content.size === 0) {
        return DecorationSet.create(state.doc, [
          Decoration.node(0, first.nodeSize, { class: 'powernote-placeholder', 'data-placeholder': 'Type here' }),
        ]);
      }
      return null;
    },
  },
});

const mark = (kind: keyof typeof FORMAT_MARK): Command =>
  toggleMark(schema.marks[FORMAT_MARK[kind]], null, { removeWhenPresent: false });

/** Plain text pasted stays as typed: lines are line breaks, blank lines paragraphs (REQ-TEXT-065). */
function plainTextSlice(text: string, inCode: boolean): Slice {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (inCode) return new Slice(Fragment.from(schema.text(normalized)), 0, 0);
  const paragraphs = normalized.split(/\n{2,}/).map((para) => {
    const inline: PMNode[] = [];
    para.split('\n').forEach((line, i) => {
      if (i > 0) inline.push(schema.nodes.hard_break.create());
      if (line) inline.push(schema.text(line));
    });
    return schema.nodes.paragraph.create(null, inline);
  });
  return new Slice(Fragment.from(paragraphs), 1, 1);
}

/** Inline styles that make the live editor the same box as the finished block. */
function boxCss(data: TextNodeData, width: number): string {
  return [
    `min-width:${MIN_TEXT_WIDTH}px`,
    `width:${width}px`,
    'box-sizing:border-box',
    `font-size:${data.fontSize}px`,
    `font-family:${data.fontFamily}`,
    // Whole-block bold/italic of old files is shown as marks while editing (REQ-TEXT-052).
    'font-weight:normal',
    'font-style:normal',
    `color:${data.fill}`,
    `padding:${MARKDOWN_PADDING}px`,
    `line-height:${MARKDOWN_LINE_HEIGHT}`,
    'white-space:pre-wrap',
    'word-wrap:break-word',
    'overflow-wrap:break-word',
    'outline:none',
    'cursor:text',
    'user-select:text',
    '-webkit-user-select:text',
    'pointer-events:auto',
  ].join(';');
}

interface TextEditorProps {
  node: CanvasNode;
  stageScale: number;
  /** Where the user double-clicked (client px), to put the caret there. */
  caretAt?: { x: number; y: number } | null;
  /** `escape` is true when the user left with Escape; `changed` when the text differs. */
  onFinish: (newText: string, escape?: boolean, changed?: boolean) => void;
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

interface LinkBox { from: number; to: number; href: string }

function MarkdownEditor({ node, caretAt, onFinish }: Omit<TextEditorProps, 'stageScale'>) {
  const data = node.data as TextNodeData;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const done = useRef(false);
  const callbacks = useRef({ onFinish });
  callbacks.current = { onFinish };
  const [linkBox, setLinkBox] = useState<LinkBox | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const width = Math.max(node.width, MIN_TEXT_WIDTH);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const originalText = data.text ?? '';
    const initialDoc = docWithLegacyStyle(data);

    const serialized = (doc: PMNode) => (doc.eq(initialDoc) ? originalText : serializeMarkdown(doc));

    const finish = (escape = false) => {
      if (done.current) return;
      done.current = true;
      document.removeEventListener('pointerdown', pointerFallback, true);
      const doc = view.state.doc;
      callbacks.current.onFinish(serialized(doc), escape, !doc.eq(initialDoc));
    };

    /** Focus went to the toolbar (size, colour): the next press anywhere else ends the edit. */
    const pointerFallback = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (host.contains(target) || target.closest(KEEPS_EDITING))) return;
      finish();
    };

    const openLinkBox = () => {
      syncSelection(view);
      const { from, to, empty } = view.state.selection;
      if (empty) {
        const at = linkRangeAt(view.state.doc, from);
        setLinkBox(at ? { from: at.from, to: at.to, href: at.href } : { from, to, href: '' });
        return;
      }
      let href = '';
      view.state.doc.nodesBetween(from, to, (n) => {
        if (href) return false;
        const m = schema.marks.link.isInSet(n.marks);
        if (m) href = m.attrs.href;
        return true;
      });
      setLinkBox({ from, to, href });
    };

    const shortcuts = keymap({
      'Mod-b': mark('bold'),
      'Mod-i': mark('italic'),
      'Mod-u': mark('underline'),
      'Mod-e': mark('code'),
      'Mod-Shift-x': mark('strike'),
      'Mod-k': () => (openLinkBox(), true),
      // Headings: Ctrl+Shift+digit works on every layout (like the list keys below);
      // Ctrl+Alt+digit is the Google Docs habit, but on AZERTY/QWERTZ it is AltGr and types characters.
      ...Object.fromEntries([0, 1, 2, 3].flatMap((level) => [
        [`Mod-Shift-${level}`, setHeading(level)],
        [`Mod-Alt-${level}`, setHeading(level)],
      ])),
      'Mod-Shift-8': toggleList('bullet'),
      'Mod-Shift-7': toggleList('number'),
      'Mod-Shift-9': toggleList('task'),
      'Mod-Enter': toggleTaskChecked,
      'Alt-ArrowUp': moveRow(-1),
      'Alt-ArrowDown': moveRow(1),
      Enter: enterKey,
      'Shift-Enter': (state, dispatch) => {
        dispatch?.(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
        return true;
      },
      Backspace: chainCommands(undoInputRule, backspaceMarker, backspaceAfterList, baseKeymap.Backspace),
      Tab: tabKey,
      'Shift-Tab': shiftTabKey,
      'Mod-z': chainCommands(undoInputRule, undo),
      'Mod-y': redo,
      'Mod-Shift-z': redo,
      // Escape leaves editing, keeps the text and lets go of the block (REQ-TEXT-048).
      Escape: () => (finish(true), true),
    });

    const view: EditorView = new EditorView(host, {
      state: EditorState.create({
        doc: initialDoc,
        selection: TextSelection.atEnd(initialDoc),
        plugins: [textInputRules(), shortcuts, keymap(baseKeymap), history(), placeholderPlugin, tableEditing()],
      }),
      nodeViews: { math: (node, v, getPos) => new MathView(node, v, getPos) },
      attributes: {
        class: MARKDOWN_CLASS,
        'data-testid': 'text-editor',
        'aria-label': 'Text block',
        spellcheck: 'true',
        style: boxCss(data, width),
      },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        useEditorStore.getState().setFormats(view.dom, activeFormats(next));
      },
      clipboardTextParser: (text, $context) => plainTextSlice(text, !!$context.parent.type.spec.code),
      // A double-click selects the word, without the trailing space the browser
      // adds. The browser's own word selection is suppressed here, and the word
      // is selected on the dblclick event, after the click's own selection
      // changes have settled (a click inside a selection collapses it on mouseup).
      handleDoubleClick(v, pos) {
        return wordRangeAt(v.state.doc, pos) !== null;
      },
      handleKeyDown(v, event) {
        syncSelection(v);
        // Ctrl+Shift+V: the paste that follows goes in as typed (REQ-TEXT-070).
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
          plainPasteUntil = Date.now() + 2000;
          return false;
        }
        // A key typed on a selected formula opens its source instead of replacing it (REQ-TEXT-067).
        const sel = v.state.selection;
        if (sel instanceof NodeSelection && sel.node.type === schema.nodes.math
          && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          v.nodeDOM(sel.from)?.dispatchEvent(new Event(EDIT_MATH_EVENT));
          return true;
        }
        return false;
      },
      handlePaste(v, event) {
        const clip = event.clipboardData;
        if (!clip) return false;
        syncSelection(v);
        const plain = clip.getData('text/plain') ?? '';
        const html = clip.getData('text/html') ?? '';
        // Ctrl+Shift+V itself raises a paste with nothing in it: keep the flag for the real one.
        if (!plain && !html) return false;
        const { from, to, empty, $from, $to } = v.state.selection;
        const inCode = !!$from.parent.type.spec.code;
        // A URL over selected words links them (REQ-TEXT-065).
        if (!empty && $from.sameParent($to) && isUrl(plain) && !inCode) {
          v.dispatch(v.state.tr.addMark(from, to, schema.marks.link.create({ href: normalizeHref(plain) })));
          return true;
        }
        const asTyped = Date.now() < plainPasteUntil;
        plainPasteUntil = 0;
        // The editor's own copies carry their structure; let ProseMirror read them.
        if (html.includes('data-pm-slice')) return false;
        let slice: Slice | null = null;
        if (html && !asTyped) {
          const md = htmlToMarkdown(html);
          if (md !== null && md !== plain.trim()) slice = new Slice(parseMarkdown(md).content, 1, 1);
        }
        // Plain text that is markdown (a chat or agent answer) pastes formatted (REQ-TEXT-070).
        if (!slice && !asTyped && !inCode && looksLikeMarkdown(plain)) slice = new Slice(parseMarkdown(plain).content, 1, 1);
        if (!slice) {
          if (!html) return false; // ProseMirror pastes the text as typed (clipboardTextParser).
          slice = plainTextSlice(plain, inCode);
        }
        v.dispatch(v.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
      handleDOMEvents: {
        blur: () => {
          // Defer a tick: a toolbar click refocuses the editor right away.
          setTimeout(() => {
            if (done.current || view.hasFocus()) return;
            const active = document.activeElement as HTMLElement | null;
            if (active && active !== document.body && (host.contains(active) || active.closest(KEEPS_EDITING))) {
              document.addEventListener('pointerdown', pointerFallback, true);
              return;
            }
            finish();
          }, 0);
          return false;
        },
        focus: () => {
          document.removeEventListener('pointerdown', pointerFallback, true);
          return false;
        },
        dblclick: (v, event) => {
          const hit = v.posAtCoords({ left: event.clientX, top: event.clientY });
          const word = hit ? wordRangeAt(v.state.doc, hit.pos) : null;
          if (!word) return false;
          if (!v.hasFocus()) v.focus();
          const select = () => {
            v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, word.from, word.to)));
            // The state may already hold this word (it was selected on opening), in
            // which case nothing re-syncs the DOM selection the click collapsed; focus() does.
            v.focus();
          };
          select();
          // Chrome collapses the selection once more after the event, when the
          // first click landed inside the previous selection: select again then.
          setTimeout(() => {
            if (done.current || v.isDestroyed) return;
            const { from, to } = v.state.selection;
            if (from !== word.from || to !== word.to) select();
          }, 0);
          return true;
        },
        mousedown: (v, event) => {
          // A task box ticks in place (REQ-TEXT-063); the editor keeps focus.
          const target = event.target as HTMLElement;
          if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return false;
          const li = target.closest('li');
          if (!li) return false;
          const $pos = v.state.doc.resolve(v.posAtDOM(li, 0));
          const itemPos = $pos.before($pos.depth);
          setTaskChecked(itemPos, !target.checked)(v.state, v.dispatch);
          event.preventDefault();
          return true;
        },
      },
    });
    viewRef.current = view;

    // Caret where the user double-clicked; on a word, that word (REQ-TEXT-059).
    let placed = false;
    const placeCaret = () => {
      if (!caretAt || placed) return;
      placed = true;
      requestAnimationFrame(() => {
        if (done.current) return;
        const hit = view.posAtCoords({ left: caretAt.x, top: caretAt.y });
        if (!hit) return;
        const doc = view.state.doc;
        const $pos = doc.resolve(hit.pos);
        let selection = TextSelection.create(doc, hit.pos);
        if ($pos.parent.isTextblock) {
          const caret = view.coordsAtPos(hit.pos);
          const onText = Math.abs(caretAt.x - caret.left) <= 12;
          const word = onText ? wordRangeAt(doc, hit.pos) : null;
          if (word) selection = TextSelection.create(doc, word.from, word.to);
        }
        view.dispatch(view.state.tr.setSelection(selection));
      });
    };
    const focus = () => {
      view.focus();
      if (view.hasFocus()) placeCaret();
      return view.hasFocus();
    };
    const timers = focus() ? [] : [10, 50, 150].map((ms) => setTimeout(focus, ms));

    const runCommand = (command: EditorCommand) => {
      if (command === 'link') {
        openLinkBox();
        return;
      }
      if (!view.hasFocus()) view.focus();
      syncSelection(view);
      const cmd: Command = typeof command === 'string'
        ? mark(command)
        : 'heading' in command ? setHeading(command.heading) : toggleList(command.list);
      cmd(view.state, view.dispatch, view);
    };
    useEditorStore.getState().registerEditor(view.dom, runCommand, activeFormats(view.state), () => view.focus());

    const handle: TextEditorHandle = {
      getValue: () => serialized(view.state.doc),
      setValue: (value) => {
        const doc = parseMarkdown(value);
        const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
        tr.setSelection(TextSelection.atEnd(tr.doc));
        view.dispatch(tr);
      },
      getSelection: () => [offsetFromPos(view.state.doc, view.state.selection.from), offsetFromPos(view.state.doc, view.state.selection.to)],
      setSelection: (from, to = from) => {
        view.focus();
        const doc = view.state.doc;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, posFromOffset(doc, from), posFromOffset(doc, to))));
      },
    };
    const win = window as unknown as { __POWERNOTE_TEXT_EDITOR__?: TextEditorHandle };
    win.__POWERNOTE_TEXT_EDITOR__ = handle;

    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener('pointerdown', pointerFallback, true);
      useEditorStore.getState().unregisterEditor(view.dom);
      if (win.__POWERNOTE_TEXT_EDITOR__ === handle) delete win.__POWERNOTE_TEXT_EDITOR__;
      viewRef.current = null;
      view.destroy();
    };
    // The editor is created once per edit session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Size, font and colour changes from the toolbar apply live (REQ-TEXT-060).
  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dom.setAttribute('style', boxCss(data, width));
  }, [data.fontSize, data.fontFamily, data.fill, width, data]);

  useEffect(() => {
    if (linkBox) linkInputRef.current?.focus();
  }, [linkBox]);

  const closeLinkBox = () => {
    setLinkBox(null);
    viewRef.current?.focus();
  };
  const submitLink = (href: string) => {
    const view = viewRef.current;
    if (view && linkBox) applyLink(linkBox.from, linkBox.to, href)(view.state, view.dispatch);
    closeLinkBox();
  };

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
        border: '2px solid #2563eb',
        borderRadius: 3,
        background: '#ffffff',
        width,
        boxSizing: 'content-box',
      }}
    >
      {linkBox && (
        <div className="powernote-link-box" data-testid="link-box" onMouseDown={(e) => e.stopPropagation()}>
          <input
            ref={linkInputRef}
            data-testid="link-box-url"
            type="url"
            placeholder="https://"
            defaultValue={linkBox.href}
            aria-label="Link address"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitLink((e.target as HTMLInputElement).value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeLinkBox();
              }
            }}
          />
          <button type="button" data-testid="link-box-apply" onClick={() => submitLink(linkInputRef.current?.value ?? '')}>
            Apply
          </button>
          {linkBox.href && (
            <button type="button" data-testid="link-box-remove" onClick={() => submitLink('')}>
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
