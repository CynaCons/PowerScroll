import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useDrawStore } from '../../stores/useDrawStore';
import { SectionItem } from './SectionItem';
import { OutlineTab } from './OutlineTab';
import { focusScrollStart } from '../../utils/viewportFocus';
import './HierarchyPanel.css';

type SidebarTab = 'notes' | 'outline';

/** Panel width bounds. Session-only — deliberately not persisted anywhere. */
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 180;
const MAX_WIDTH = 560;
/** Arrow-key resize step. */
const KEY_STEP = 16;

const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));

/** Drawer mode breakpoint — matches ZoomBar.css's narrow-viewport query. */
const DRAWER_QUERY = '(max-width: 768px)';

interface HierarchyPanelProps {
  isOpen: boolean;
  /** Called after a page navigation, but only while the panel is rendered as
   * an overlay drawer (<=768px) — on a full-width desktop panel, picking a
   * page has never closed it, and existing hierarchy specs rely on that. */
  onClose?: () => void;
}

export function HierarchyPanel({ isOpen, onClose }: HierarchyPanelProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const activePageId = useWorkspaceStore((s) => s.activePageId);
  const setActivePage = useWorkspaceStore((s) => s.setActivePage);
  const savePageNodes = useWorkspaceStore((s) => s.savePageNodes);
  const addSection = useWorkspaceStore((s) => s.addSection);
  const addPage = useWorkspaceStore((s) => s.addPage);
  const addBoardPage = useWorkspaceStore((s) => s.addBoardPage);
  const renameSection = useWorkspaceStore((s) => s.renameSection);
  const deleteSection = useWorkspaceStore((s) => s.deleteSection);
  const renamePage = useWorkspaceStore((s) => s.renamePage);
  const deletePage = useWorkspaceStore((s) => s.deletePage);
  const reorderSection = useWorkspaceStore((s) => s.reorderSection);
  const reorderPage = useWorkspaceStore((s) => s.reorderPage);
  const setActiveScroll = useWorkspaceStore((s) => s.setActiveScroll);

  const canvasNodes = useCanvasStore((s) => s.nodes);
  const loadPageNodes = useCanvasStore((s) => s.loadPageNodes);
  const savePageStrokes = useWorkspaceStore((s) => s.savePageStrokes);

  const [tab, setTab] = useState<SidebarTab>('notes');

  // ── Resize ────────────────────────────────────────────────
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };
    // Capture so the drag keeps tracking once the cursor leaves the 5px strip —
    // without it, moving faster than the repaint drops the gesture.
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setWidth(clampWidth(drag.startWidth + (e.clientX - drag.startX)));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setWidth((w) => clampWidth(w - KEY_STEP));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setWidth((w) => clampWidth(w + KEY_STEP));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setWidth(DEFAULT_WIDTH);
    }
  };

  const handleNavigate = (sectionId: string, pageId: string) => {
    if (pageId === activePageId) return;

    // Save current page's nodes + strokes
    savePageNodes(canvasNodes);
    savePageStrokes(useDrawStore.getState().strokes);

    // Switch to new page
    setActivePage(sectionId, pageId);

    // Load new page's nodes + strokes
    const section = workspace.sections.find((s) => s.id === sectionId);
    const page = section?.pages.find((p) => p.id === pageId);
    loadPageNodes(page?.nodes ?? []);
    useDrawStore.getState().loadPageStrokes(page?.strokes ?? []);

    // Drawer mode only: a full desktop panel stays open after navigating.
    if (window.matchMedia(DRAWER_QUERY).matches) {
      onClose?.();
    }
  };

  const handleDeleteSection = (sectionId: string) => {
    savePageNodes(canvasNodes);
    savePageStrokes(useDrawStore.getState().strokes);
    deleteSection(sectionId);
    const state = useWorkspaceStore.getState();
    const newSection = state.workspace.sections.find((s) => s.id === state.activeSectionId);
    const newPage = newSection?.pages.find((p) => p.id === state.activePageId);
    loadPageNodes(newPage?.nodes ?? []);
    useDrawStore.getState().loadPageStrokes(newPage?.strokes ?? []);
  };

  const handleDeletePage = (sectionId: string, pageId: string) => {
    if (pageId === activePageId) {
      savePageNodes(canvasNodes);
      savePageStrokes(useDrawStore.getState().strokes);
    }
    deletePage(sectionId, pageId);
    if (pageId === activePageId) {
      const state = useWorkspaceStore.getState();
      const section = state.workspace.sections.find((s) => s.id === sectionId);
      const newPage = section?.pages.find((p) => p.id === state.activePageId);
      loadPageNodes(newPage?.nodes ?? []);
      useDrawStore.getState().loadPageStrokes(newPage?.strokes ?? []);
    }
  };

  /**
   * Open a scroll from the sidebar: switch page if needed, mark it active, and
   * move the viewport to its top.
   *
   * The focus runs after navigation because handleNavigate swaps the canvas
   * contents — focusing first would scroll the page being left behind.
   */
  const handleOpenScroll = (
    targetSectionId: string,
    pageId: string,
    scrollId: string,
    column: number,
  ) => {
    if (pageId !== activePageId) handleNavigate(targetSectionId, pageId);
    setActiveScroll(scrollId);
    focusScrollStart(column);
  };

  if (!isOpen) return null;

  return (
    <div
      className="hierarchy-panel"
      data-testid="hierarchy-panel"
      // minWidth tracks width so the panel can go below the CSS default.
      style={{ width, minWidth: width }}
    >
      <div className="hierarchy-panel__header">
        <div className="hierarchy-panel__tabs" role="tablist">
          <button
            className={`hierarchy-panel__tab${tab === 'notes' ? ' hierarchy-panel__tab--active' : ''}`}
            role="tab"
            aria-selected={tab === 'notes'}
            onClick={() => setTab('notes')}
            data-testid="sidebar-tab-notes"
          >
            Notes
          </button>
          <button
            className={`hierarchy-panel__tab${tab === 'outline' ? ' hierarchy-panel__tab--active' : ''}`}
            role="tab"
            aria-selected={tab === 'outline'}
            onClick={() => setTab('outline')}
            data-testid="sidebar-tab-outline"
          >
            Outline
          </button>
        </div>
        {/* Add-section belongs to the tree, not to the outline. */}
        {tab === 'notes' && (
          <button
            className="hierarchy-panel__add-section"
            onClick={() => addSection()}
            title="Add section"
            data-testid="add-section-btn"
          >
            <Plus size={16} />
          </button>
        )}
      </div>
      {tab === 'outline' && (
        <div className="hierarchy-panel__content">
          <OutlineTab />
        </div>
      )}
      <div
        className="hierarchy-panel__content"
        // Kept mounted while the Outline tab is showing: unmounting would drop
        // every expanded-section and rename-in-progress state in the tree.
        style={tab === 'notes' ? undefined : { display: 'none' }}
      >
        {workspace.sections.map((section, sectionIndex) => (
          <SectionItem
            key={section.id}
            section={section}
            sectionIndex={sectionIndex}
            activePageId={activePageId}
            onNavigate={handleNavigate}
            onAddPage={(sid) => addPage(sid)}
            onAddBoard={(sid) => addBoardPage(sid)}
            onRenameSection={renameSection}
            onDeleteSection={handleDeleteSection}
            onRenamePage={renamePage}
            onDeletePage={handleDeletePage}
            onReorderSection={reorderSection}
            onReorderPage={reorderPage}
            onOpenScroll={handleOpenScroll}
          />
        ))}
      </div>
      <div
        className="hierarchy-panel__resize"
        data-testid="hierarchy-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
