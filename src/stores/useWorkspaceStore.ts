import { create } from 'zustand';
import type {
  WorkspaceData,
  WorkspaceSettings,
  Section,
  Page,
  BoardData,
  CanvasNode,
  ScrollRecord,
} from '../types/data';
import {
  createWorkspace,
  createSection,
  createPage,
  createBoardPage,
  DEFAULT_WORKSPACE_SETTINGS,
} from '../utils/defaults';
import { generateId } from '../utils/ids';
import { compactColumns, contentBelongsToScroll, nextFreeColumn, strokeBelongsToScrollBand } from '../utils/scrolls';

interface WorkspaceState {
  workspace: WorkspaceData;
  activeSectionId: string;
  activePageId: string;
  /**
   * Scroll the outline and canvas focus follow (v0.33+).
   *
   * Runtime-only, like activeSectionId/activePageId — never serialized. Set by
   * an explicit click (sidebar entry or canvas header) rather than inferred
   * from the viewport, so it never changes under the user mid-read. Null means
   * "fall back to the leftmost scroll on the active page".
   */
  activeScrollId: string | null;
  setActiveScroll: (scrollId: string | null) => void;
  /** The active scroll, resolving the null default to the leftmost one. */
  getActiveScroll: () => ScrollRecord | undefined;
  isDirty: boolean;
  /** True while a manual Save / Save As is in flight */
  isSaving: boolean;
  markDirty: () => void;
  markClean: () => void;
  setSaving: (saving: boolean) => void;
  updateWorkspace: (updates: Partial<WorkspaceData>) => void;
  /** Update canvas look settings and mark the notebook dirty */
  /** The notebook-wide default. Does NOT touch pages that carry an override. */
  updateSettings: (updates: Partial<WorkspaceSettings>) => void;
  /** Override the look of one page (the active one unless a target is given). */
  updatePageSettings: (
    updates: Partial<WorkspaceSettings>,
    target?: { sectionId: string; pageId: string },
  ) => void;
  /** Drop a page's override so it follows the notebook default again. */
  clearPageSettings: (target?: { sectionId: string; pageId: string }) => void;

  // Getters
  getActiveSection: () => Section | undefined;
  getActivePage: () => Page | undefined;

  // Section actions
  addSection: (title?: string) => void;
  renameSection: (sectionId: string, title: string) => void;
  deleteSection: (sectionId: string) => void;

  // Page actions
  addPage: (sectionId: string, title?: string) => void;
  addBoardPage: (sectionId: string, title?: string) => void;
  /** Board edits intentionally do not enter the canvas undo history. */
  updateBoard: (pageId: string, fn: (board: BoardData) => BoardData) => void;
  renamePage: (sectionId: string, pageId: string, title: string) => void;
  deletePage: (sectionId: string, pageId: string) => void;

  // Navigation
  setActiveSection: (sectionId: string) => void;
  setActivePage: (sectionId: string, pageId: string) => void;

  // Node/stroke sync: save back to the active page
  savePageNodes: (nodes: CanvasNode[]) => void;
  savePageStrokes: (strokes: import('../types/data').Stroke[]) => void;

  // Scroll (column band) actions — see utils/scrolls.ts for the model
  createScroll: (pageId: string, title: string) => ScrollRecord | null;
  renameScroll: (pageId: string, scrollId: string, title: string) => void;
  /** Removes the record; `withBlocks` also deletes the band's nodes and ink. */
  deleteScroll: (pageId: string, scrollId: string, withBlocks: boolean) => void;
  reorderScroll: (pageId: string, scrollId: string, toIndex: number) => void;
  /** Replace the page's scroll records (fit-to-content / undo restore). */
  replacePageScrolls: (pageId: string, scrolls: ScrollRecord[]) => void;

  // Reorder
  reorderSection: (fromIndex: number, toIndex: number) => void;
  reorderPage: (sectionId: string, fromIndex: number, toIndex: number) => void;
  movePageToSection: (pageId: string, fromSectionId: string, toSectionId: string, toIndex: number) => void;
}

/** Rewrite one page anywhere in the notebook, leaving the rest untouched. */
function mapPage(
  workspace: WorkspaceData,
  pageId: string,
  fn: (page: Page) => Page,
): WorkspaceData {
  return {
    ...workspace,
    sections: workspace.sections.map((s) => ({
      ...s,
      pages: s.pages.map((p) => (p.id === pageId ? fn(p) : p)),
    })),
  };
}

function findPage(workspace: WorkspaceData, pageId: string): Page | undefined {
  for (const section of workspace.sections) {
    const page = section.pages.find((p) => p.id === pageId);
    if (page) return page;
  }
  return undefined;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const initial = { ...createWorkspace(), id: generateId() };
  const firstSection = initial.sections[0];
  const firstPage = firstSection.pages[0];

  return {
    workspace: initial,
    activeSectionId: firstSection.id,
    activePageId: firstPage.id,
    activeScrollId: null,
    isDirty: false,
    isSaving: false,
    markDirty: () => set({ isDirty: true }),
    markClean: () => set({ isDirty: false }),
    setSaving: (saving) => set({ isSaving: saving }),
    updateWorkspace: (updates) =>
      set((state) => ({ workspace: { ...state.workspace, ...updates } })),
    updateSettings: (updates) =>
      set((state) => {
        const prev = state.workspace.settings ?? DEFAULT_WORKSPACE_SETTINGS;
        return {
          isDirty: true,
          workspace: {
            ...state.workspace,
            settings: { ...prev, ...updates },
          },
        };
      }),

    updatePageSettings: (updates, target) =>
      set((state) => {
        const sectionId = target?.sectionId ?? state.activeSectionId;
        const pageId = target?.pageId ?? state.activePageId;
        return {
          isDirty: true,
          workspace: {
            ...state.workspace,
            sections: state.workspace.sections.map((section) =>
              section.id !== sectionId
                ? section
                : {
                    ...section,
                    pages: section.pages.map((page) =>
                      page.id !== pageId
                        ? page
                        : { ...page, settings: { ...(page.settings ?? {}), ...updates } },
                    ),
                  },
            ),
          },
        };
      }),

    clearPageSettings: (target) =>
      set((state) => {
        const sectionId = target?.sectionId ?? state.activeSectionId;
        const pageId = target?.pageId ?? state.activePageId;
        return {
          isDirty: true,
          workspace: {
            ...state.workspace,
            sections: state.workspace.sections.map((section) =>
              section.id !== sectionId
                ? section
                : {
                    ...section,
                    pages: section.pages.map((page) => {
                      if (page.id !== pageId) return page;
                      // Dropped rather than emptied: an absent `settings` is what
                      // every page written before overrides existed looks like,
                      // and keeping one shape means one code path on load.
                      const { settings: _dropped, ...rest } = page;
                      return rest;
                    }),
                  },
            ),
          },
        };
      }),

    setActiveScroll: (scrollId) => set({ activeScrollId: scrollId }),

    getActiveScroll: () => {
      const { activeScrollId } = get();
      const page = get().getActivePage();
      const scrolls = page?.scrolls;
      if (!scrolls || scrolls.length === 0) return undefined;

      // A stale id (page switched, scroll deleted) must not blank the outline —
      // fall back to the leftmost rather than showing nothing.
      const chosen = activeScrollId
        ? scrolls.find((s) => s.id === activeScrollId)
        : undefined;
      return chosen ?? [...scrolls].sort((a, b) => a.column - b.column)[0];
    },

    getActiveSection: () => {
      const { workspace, activeSectionId } = get();
      return workspace.sections.find((s) => s.id === activeSectionId);
    },

    getActivePage: () => {
      const section = get().getActiveSection();
      if (!section) return undefined;
      return section.pages.find((p) => p.id === get().activePageId);
    },

    addSection: (title?: string) => {
      set((state) => {
        const section = createSection(title);
        return {
          isDirty: true,
          workspace: {
            ...state.workspace,
            sections: [...state.workspace.sections, section],
          },
        };
      });
    },

    renameSection: (sectionId, title) => {
      set((state) => ({
        isDirty: true,
        workspace: {
          ...state.workspace,
          sections: state.workspace.sections.map((s) =>
            s.id === sectionId ? { ...s, title } : s,
          ),
        },
      }));
    },

    deleteSection: (sectionId) => {
      set((state) => {
        const remaining = state.workspace.sections.filter(
          (s) => s.id !== sectionId,
        );
        // Guard: always keep at least 1 section
        if (remaining.length === 0) return state;
        return {
          isDirty: true,
          workspace: { ...state.workspace, sections: remaining },
          activeSectionId:
            state.activeSectionId === sectionId
              ? remaining[0].id
              : state.activeSectionId,
          activePageId:
            state.activeSectionId === sectionId
              ? remaining[0].pages[0].id
              : state.activePageId,
        };
      });
    },

    addPage: (sectionId, title?: string) => {
      set((state) => ({
        isDirty: true,
        workspace: {
          ...state.workspace,
          sections: state.workspace.sections.map((s) =>
            s.id === sectionId
              ? { ...s, pages: [...s.pages, createPage(title)] }
              : s,
          ),
        },
      }));
    },

    addBoardPage: (sectionId, title?: string) => {
      set((state) => {
        const page = createBoardPage(title);

        return {
          isDirty: true,
          activeSectionId: sectionId,
          activePageId: page.id,
          workspace: {
            ...state.workspace,
            sections: state.workspace.sections.map((section) =>
              section.id === sectionId
                ? { ...section, pages: [...section.pages, page] }
                : section,
            ),
          },
        };
      });
    },

    updateBoard: (pageId, fn) => {
      set((state) => {
        const page = findPage(state.workspace, pageId);
        if (!page?.board) return state;
        return {
          isDirty: true,
          workspace: mapPage(state.workspace, pageId, (currentPage) => ({
            ...currentPage,
            board: fn(currentPage.board!),
          })),
        };
      });
    },

    renamePage: (sectionId, pageId, title) => {
      set((state) => ({
        isDirty: true,
        workspace: {
          ...state.workspace,
          sections: state.workspace.sections.map((s) =>
            s.id === sectionId
              ? {
                  ...s,
                  pages: s.pages.map((p) =>
                    p.id === pageId ? { ...p, title } : p,
                  ),
                }
              : s,
          ),
        },
      }));
    },

    deletePage: (sectionId, pageId) => {
      set((state) => {
        const section = state.workspace.sections.find(
          (s) => s.id === sectionId,
        );
        if (!section) return state;
        const remaining = section.pages.filter((p) => p.id !== pageId);
        // Guard: always keep at least 1 page per section
        if (remaining.length === 0) return state;
        return {
          isDirty: true,
          workspace: {
            ...state.workspace,
            sections: state.workspace.sections.map((s) =>
              s.id === sectionId ? { ...s, pages: remaining } : s,
            ),
          },
          activePageId:
            state.activePageId === pageId
              ? remaining[0].id
              : state.activePageId,
        };
      });
    },

    setActiveSection: (sectionId) => {
      const section = get().workspace.sections.find(
        (s) => s.id === sectionId,
      );
      if (!section) return;
      set({
        activeSectionId: sectionId,
        activePageId: section.pages[0].id,
        // Scroll ids are page-scoped, so carrying one across a page change
        // would leave the outline pointing at a scroll that is not here.
        activeScrollId: null,
      });
    },

    setActivePage: (sectionId, pageId) => {
      set({
        activeSectionId: sectionId,
        activePageId: pageId,
        activeScrollId: null,
      });
    },

    savePageNodes: (nodes) => {
      set((state) => ({
        isDirty: true,
        workspace: {
          ...state.workspace,
          sections: state.workspace.sections.map((s) =>
            s.id === state.activeSectionId
              ? {
                  ...s,
                  pages: s.pages.map((p) =>
                    p.id === state.activePageId ? { ...p, nodes } : p,
                  ),
                }
              : s,
          ),
        },
      }));
    },

    savePageStrokes: (strokes) => {
      set((state) => ({
        isDirty: true,
        workspace: {
          ...state.workspace,
          sections: state.workspace.sections.map((s) =>
            s.id === state.activeSectionId
              ? {
                  ...s,
                  pages: s.pages.map((p) =>
                    p.id === state.activePageId ? { ...p, strokes } : p,
                  ),
                }
              : s,
          ),
        },
      }));
    },

    createScroll: (pageId, title) => {
      const page = findPage(get().workspace, pageId);
      if (!page) return null;

      const record: ScrollRecord = {
        id: generateId(),
        title,
        column: nextFreeColumn(page.scrolls ?? []),
      };
      set((state) => ({
        isDirty: true,
        workspace: mapPage(state.workspace, pageId, (p) => ({
          ...p,
          scrolls: [...(p.scrolls ?? []), record],
        })),
      }));
      return record;
    },

    renameScroll: (pageId, scrollId, title) => {
      set((state) => ({
        isDirty: true,
        workspace: mapPage(state.workspace, pageId, (p) => ({
          ...p,
          scrolls: (p.scrolls ?? []).map((s) =>
            s.id === scrollId ? { ...s, title } : s,
          ),
        })),
      }));
    },


    deleteScroll: (pageId, scrollId, withBlocks) => {
      set((state) => {
        const page = findPage(state.workspace, pageId);
        const target = page?.scrolls?.find((s) => s.id === scrollId);
        if (!page || !target) return state;

        const remaining = (page.scrolls ?? []).filter((s) => s.id !== scrollId);
        // A page always keeps one scroll — otherwise there is nowhere to append.
        if (remaining.length === 0) return state;

        const scrolls = page.scrolls ?? [];
        // Group-aware: a diagram is owned by the band of its FRAME origin;
        // members and group strokes follow that verdict, not their own x.
        const keptNodes = withBlocks
          ? page.nodes.filter((n) => !contentBelongsToScroll(n, target, scrolls, page.nodes))
          : page.nodes;
        const keptStrokes = withBlocks
          ? (page.strokes ?? []).filter(
              (s) => !strokeBelongsToScrollBand(s, target, scrolls, page.nodes),
            )
          : page.strokes;

        // Close the gap the removed band leaves, moving the surviving blocks
        // AND strokes with their scrolls so membership survives the renumber.
        // compactColumns is group-aware: a straddling diagram travels whole.
        // Sorted first because compactColumns reads array order as the target.
        const compacted = compactColumns(
          [...remaining].sort((a, b) => a.column - b.column),
          keptNodes,
          keptStrokes ?? [],
        );

        return {
          isDirty: true,
          workspace: mapPage(state.workspace, pageId, (p) => ({
            ...p,
            scrolls: compacted.scrolls,
            nodes: compacted.nodes,
            strokes: compacted.strokes,
          })),
        };
      });
    },

    replacePageScrolls: (pageId, scrolls) => {
      set((state) => ({
        isDirty: true,
        workspace: mapPage(state.workspace, pageId, (p) => ({ ...p, scrolls })),
      }));
    },

    reorderScroll: (pageId, scrollId, toIndex) => {
      set((state) => {
        const page = findPage(state.workspace, pageId);
        const scrolls = page?.scrolls;
        if (!page || !scrolls) return state;

        const ordered = [...scrolls].sort((a, b) => a.column - b.column);
        const from = ordered.findIndex((s) => s.id === scrollId);
        if (from < 0) return state;

        const to = Math.max(0, Math.min(toIndex, ordered.length - 1));
        if (to === from) return state;

        const [moved] = ordered.splice(from, 1);
        ordered.splice(to, 0, moved);

        // compactColumns reads each record's CURRENT column (via the
        // group-aware membership test) then renumbers by array order — so
        // the spliced array is the instruction, and members, group strokes
        // and per-scroll width follow the band.
        const compacted = compactColumns(ordered, page.nodes, page.strokes ?? []);

        return {
          isDirty: true,
          workspace: mapPage(state.workspace, pageId, (p) => ({
            ...p,
            scrolls: compacted.scrolls,
            nodes: compacted.nodes,
            strokes: compacted.strokes,
          })),
        };
      });
    },

    reorderSection: (fromIndex, toIndex) => {
      set((state) => {
        const sections = [...state.workspace.sections];
        const [moved] = sections.splice(fromIndex, 1);
        sections.splice(toIndex, 0, moved);
        return { isDirty: true, workspace: { ...state.workspace, sections } };
      });
    },

    reorderPage: (sectionId, fromIndex, toIndex) => {
      set((state) => ({
        isDirty: true,
        workspace: {
          ...state.workspace,
          sections: state.workspace.sections.map((s) => {
            if (s.id !== sectionId) return s;
            const pages = [...s.pages];
            const [moved] = pages.splice(fromIndex, 1);
            pages.splice(toIndex, 0, moved);
            return { ...s, pages };
          }),
        },
      }));
    },

    movePageToSection: (pageId, fromSectionId, toSectionId, toIndex) => {
      set((state) => {
        // Guard: don't leave a section empty. Bail out entirely rather than
        // skipping just the removal — doing the insert anyway would leave the
        // same page id living in two sections.
        const from = state.workspace.sections.find((s) => s.id === fromSectionId);
        if (!from || from.pages.length <= 1) return state;

        let movedPage: Page | undefined;
        const sections = state.workspace.sections.map((s) => {
          if (s.id === fromSectionId) {
            const pages = s.pages.filter((p) => {
              if (p.id === pageId) {
                movedPage = p;
                return false;
              }
              return true;
            });
            return { ...s, pages };
          }
          return s;
        });

        if (!movedPage) return state;
        // Unknown target would drop the page on the floor — it has already been
        // filtered out of its old section by this point.
        if (!sections.some((s) => s.id === toSectionId)) return state;

        const finalSections = sections.map((s) => {
          if (s.id === toSectionId) {
            const pages = [...s.pages];
            pages.splice(toIndex, 0, movedPage!);
            return { ...s, pages };
          }
          return s;
        });

        // savePageNodes writes into activeSectionId → activePageId. If the page
        // being moved is the open one, its section id has to follow it or the
        // next flush silently matches nothing and the canvas content is lost.
        const activeFollows = state.activePageId === pageId;

        return {
          isDirty: true,
          ...(activeFollows ? { activeSectionId: toSectionId } : {}),
          workspace: { ...state.workspace, sections: finalSections },
        };
      });
    },
  };
});
