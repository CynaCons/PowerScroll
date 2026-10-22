import { create } from 'zustand';
import type { FormatKind } from '../text/schema';
import type { ActiveFormats, ListKind } from '../text/doc';

export type { FormatKind, ListKind };

/** Everything the toolbar can ask the live text editor to do. */
export type EditorCommand =
  | FormatKind
  | { heading: number }
  | { list: ListKind }
  | 'link';

interface EditorState {
  /** The live editor's root element while a text block is being edited. */
  activeEditor: HTMLElement | null;
  applyFormat: ((kind: FormatKind) => void) | null;
  runCommand: ((command: EditorCommand) => void) | null;
  /** Formats on at the caret or over the whole selection, refreshed on every transaction (REQ-TEXT-051). */
  formats: ActiveFormats | null;
  /** Give the keyboard back to the editor with its selection (after a toolbar popover, REQ-TEXT-072). */
  focusEditor: (() => void) | null;

  registerEditor: (el: HTMLElement, run: (command: EditorCommand) => void, formats: ActiveFormats, focus: () => void) => void;
  setFormats: (el: HTMLElement, formats: ActiveFormats) => void;
  unregisterEditor: (el: HTMLElement) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeEditor: null,
  applyFormat: null,
  runCommand: null,
  formats: null,
  focusEditor: null,

  registerEditor: (el, run, formats, focus) =>
    set({ activeEditor: el, runCommand: run, applyFormat: (kind) => run(kind), formats, focusEditor: focus }),

  setFormats: (el, formats) => {
    if (get().activeEditor === el) set({ formats });
  },

  unregisterEditor: (el) => {
    if (get().activeEditor === el) {
      set({ activeEditor: null, applyFormat: null, runCommand: null, formats: null, focusEditor: null });
    }
  },
}));
