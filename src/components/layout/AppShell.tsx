import { useState, useEffect, useCallback } from 'react';
import { NavRail } from './NavRail';
import { TopBar } from './TopBar';
import { InfiniteCanvas } from '../canvas/InfiniteCanvas';
import { HierarchyPanel } from '../sidebar/HierarchyPanel';
import { BottomToolbar } from '../toolbar/BottomToolbar';
import { SearchPanel } from '../search/SearchPanel';
import { useSearchStore } from '../../stores/useSearchStore';
import { SettingsPanel } from '../settings/SettingsPanel';
import { NotebookLibraryPanel } from './NotebookLibraryPanel';
import { ZoomBar } from '../canvas/ZoomBar';
import { BoardView } from '../board/BoardView';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { notebookSettings, resolvePageSettings } from '../../utils/pageSettings';
import { saveNotebook } from '../../utils/saveNotebook';
import './AppShell.css';

export function AppShell() {
  const [isHierarchyOpen, setIsHierarchyOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  // Stable, so the overlay's Escape listener is not re-registered every render.
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);

  // Subscribed to the whole workspace and the active page id, so the canvas
  // repaints both when the notebook default changes and when you move to a page
  // that overrides it.
  const workspace = useWorkspaceStore((s) => s.workspace);
  const activeSectionId = useWorkspaceStore((s) => s.activeSectionId);
  const activePageId = useWorkspaceStore((s) => s.activePageId);
  const updateSettings = useWorkspaceStore((s) => s.updateSettings);
  const updatePageSettings = useWorkspaceStore((s) => s.updatePageSettings);
  const clearPageSettings = useWorkspaceStore((s) => s.clearPageSettings);

  const activePage = workspace.sections
    .find((s) => s.id === activeSectionId)
    ?.pages.find((p) => p.id === activePageId);
  const resolved = resolvePageSettings(activePage, workspace);
  const backgroundMode = resolved.backgroundMode;
  const bgColor = resolved.bgColor;

  // Ctrl+S / Ctrl+F / Ctrl+Shift+F keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S: save (uses FSA when available, download as fallback)
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveNotebook(false);
      }

      // Ctrl+F / Ctrl+Shift+F: search the page / the notebook (REQ-SEARCH-011).
      // Shift makes the browser report "F", so compare the physical key too (REQ-SEARCH-012).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyF' || e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        useSearchStore.getState().openSearch(e.shiftKey ? 'notebook' : 'page');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Escape closes the hierarchy drawer, but only in drawer mode (<=768px) —
  // at desktop widths the panel has never closed on Escape, and
  // useCanvasKeyboard.ts (InfiniteCanvas) already owns Escape there
  // (exit isolation / clear selection). Registered on the CAPTURE phase and
  // paired with stopPropagation so it runs and wins before that bubble-phase
  // listener sees the event, instead of both firing for one keypress.
  useEffect(() => {
    const handleDrawerEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isHierarchyOpen) return;
      if (!window.matchMedia('(max-width: 768px)').matches) return;
      e.stopPropagation();
      setIsHierarchyOpen(false);
    };
    window.addEventListener('keydown', handleDrawerEscape, true);
    return () => window.removeEventListener('keydown', handleDrawerEscape, true);
  }, [isHierarchyOpen]);


  return (
    <div className="app-shell" data-testid="app-shell">
      <NavRail
        onToggleHierarchy={() => setIsHierarchyOpen((prev) => !prev)}
        isHierarchyOpen={isHierarchyOpen}
        onToggleSettings={() => setIsSettingsOpen((prev) => !prev)}
        isSettingsOpen={isSettingsOpen}
        onToggleLibrary={() => setIsLibraryOpen((prev) => !prev)}
        isLibraryOpen={isLibraryOpen}
      />
      <TopBar />
      <div className="canvas-area">
        <HierarchyPanel isOpen={isHierarchyOpen} onClose={() => setIsHierarchyOpen(false)} />
        {isHierarchyOpen && (
          // Drawer-mode-only backdrop (HierarchyPanel.css): display:none
          // above 768px, so it never affects today's desktop layout or
          // hit-testing — only visible/clickable once the panel overlays
          // the canvas instead of sharing width with it.
          <button
            type="button"
            className="hierarchy-panel__backdrop"
            data-testid="hierarchy-backdrop"
            aria-label="Close hierarchy panel"
            onClick={() => setIsHierarchyOpen(false)}
          />
        )}
        <div className="canvas-area__content">
          {activePage?.kind === 'board' ? <BoardView /> : <><InfiniteCanvas backgroundMode={backgroundMode} bgColor={bgColor} />
          <BottomToolbar />
          <ZoomBar /></>}
          <SearchPanel />
        </div>
      </div>
      {isSettingsOpen && (
        <SettingsPanel
          resolved={resolved}
          notebookDefault={notebookSettings(workspace)}
          pageTitle={activePage?.title ?? 'this page'}
          onChange={(updates, scope) =>
            scope === 'page' ? updatePageSettings(updates) : updateSettings(updates)
          }
          onClearPageOverride={() => clearPageSettings()}
          onClose={closeSettings}
        />
      )}
      <NotebookLibraryPanel
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
      />
    </div>
  );
}
