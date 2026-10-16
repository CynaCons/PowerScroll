import { create } from 'zustand';
import type { FormatKind } from '../utils/markdownToggle';
import type { ListKind } from '../utils/markdownCommands';

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

  registerEditor: (el: HTMLElement, run: (command: EditorCommand) => void) => void;
  unregisterEditor: (el: HTMLElement) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeEditor: null,
  applyFormat: null,
  runCommand: null,

  registerEditor: (el, run) =>
    set({ activeEditor: el, runCommand: run, applyFormat: (kind) => run(kind) }),

  unregisterEditor: (el) => {
    if (get().activeEditor === el) {
      set({ activeEditor: null, applyFormat: null, runCommand: null });
    }
  },
}));
