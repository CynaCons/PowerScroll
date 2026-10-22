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

  registerEditor: (el: HTMLElement, run: (command: EditorCommand) => void, formats: ActiveFormats) => void;
  setFormats: (el: HTMLElement, formats: ActiveFormats) => void;
  unregisterEditor: (el: HTMLElement) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeEditor: null,
  applyFormat: null,
  runCommand: null,
  formats: null,

  registerEditor: (el, run, formats) =>
    set({ activeEditor: el, runCommand: run, applyFormat: (kind) => run(kind), formats }),

  setFormats: (el, formats) => {
    if (get().activeEditor === el) set({ formats });
  },

  unregisterEditor: (el) => {
    if (get().activeEditor === el) {
      set({ activeEditor: null, applyFormat: null, runCommand: null, formats: null });
    }
  },
}));
