import { ChevronRight, Download, FolderOpen, Maximize, ChevronDown, RotateCcw, Loader2, Undo2 } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useDrawStore } from '../../stores/useDrawStore';
import { useHistoryStore } from '../../stores/useHistoryStore';
import { extractDataFromHtml } from '../../utils/serialization';
import { migrateWorkspace } from '../../utils/migrations';
import { workspaceToMarkdown } from '../../utils/exportMarkdown';
import {
  isFSASupported,
  openWithPicker,
} from '../../utils/fileSystemAccess';
import { setCurrentHandle, addRecentHandle, clearCurrentHandle } from '../../utils/fileHandleStore';
import { useFileBindingStore } from '../../stores/useFileBindingStore';
import { saveNotebook } from '../../utils/saveNotebook';
import { canRevert, revertNotebook } from '../../utils/revertNotebook';
import { scrollOf } from '../../utils/scrolls';
import { useRef, useState, useEffect } from 'react';
import { showToast } from './Toast';
import './TopBar.css';

export function TopBar() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const activeSectionId = useWorkspaceStore((s) => s.activeSectionId);
  const activePageId = useWorkspaceStore((s) => s.activePageId);
  const isDirty = useWorkspaceStore((s) => s.isDirty);
  const isSaving = useWorkspaceStore((s) => s.isSaving);
  const filePathLabel = useFileBindingStore((s) => s.label);
  const refreshFileBinding = useFileBindingStore((s) => s.refresh);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingFilename, setEditingFilename] = useState(false);
  const [filenameValue, setFilenameValue] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [revertEnabled, setRevertEnabled] = useState(false);

  const activeSection = workspace.sections.find((s) => s.id === activeSectionId);
  const activePage = activeSection?.pages.find((p) => p.id === activePageId);

  // There is no "current scroll" — a scroll is a place, not a mode. The nearest
  // honest answer is the scroll the selection is standing in, so the crumb
  // appears only while exactly one block is selected, and only if it is named.
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
  const canvasNodes = useCanvasStore((s) => s.nodes);

  const undoEnabled = useHistoryStore((s) => s.canUndo);
  const undo = useHistoryStore((s) => s.undo);

  const selectedScrollTitle =
    selectedNodeIds.length === 1
      ? (() => {
          const node = canvasNodes.find((n) => n.id === selectedNodeIds[0]);
          if (!node) return undefined;
          return scrollOf(node, activePage?.scrolls)?.title || undefined;
        })()
      : undefined;

  // beforeunload warning for unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useWorkspaceStore.getState().isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Resolve FSA handle name or file:// path on mount / after hydration
  useEffect(() => {
    void refreshFileBinding();
  }, [refreshFileBinding]);

  // Revert gating: re-check whenever dirty flag flips. canRevert() also
  // does an async FSA permission check, so we pair it with the isDirty
  // effect dependency to refresh the enabled/disabled state on every
  // dirty transition.
  useEffect(() => {
    let cancelled = false;
    canRevert().then((v) => {
      if (!cancelled) setRevertEnabled(v);
    });
    return () => {
      cancelled = true;
    };
  }, [isDirty]);

  const handleRevert = async () => {
    await revertNotebook();
    setRevertEnabled(await canRevert());
  };

  const handleSave = async (forceSaveAs: boolean = false) => {
    if (useWorkspaceStore.getState().isSaving) return;
    await saveNotebook(forceSaveAs);
  };

  const handleOpen = async () => {
    // Try FSA open picker first
    if (isFSASupported()) {
      const result = await openWithPicker();
      if (result) {
        const data = extractDataFromHtml(result.text);
        if (data) {
          const migrated = migrateWorkspace(data);
          useWorkspaceStore.setState({
            workspace: migrated,
            activeSectionId: migrated.sections[0]?.id ?? '',
            activePageId: migrated.sections[0]?.pages[0]?.id ?? '',
            isDirty: false,
          });
          const firstPage = migrated.sections[0]?.pages[0];
          useCanvasStore.getState().loadPageNodes(firstPage?.nodes ?? []);
          useDrawStore.getState().loadPageStrokes(firstPage?.strokes ?? []);
          await setCurrentHandle(result.handle);
          await addRecentHandle(migrated.filename, result.handle);
          showToast(`Opened ${result.handle.name}`, 'info');
          return;
        }
        showToast('Not a valid PowerScroll notebook', 'error');
        return;
      }
      // User cancelled — do nothing
      return;
    }

    // Fallback: legacy file input
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const htmlContent = reader.result as string;
      const data = extractDataFromHtml(htmlContent);
      if (data) {
        const migrated = migrateWorkspace(data);
        useWorkspaceStore.setState({
          workspace: migrated,
          activeSectionId: migrated.sections[0]?.id,
          activePageId: migrated.sections[0]?.pages[0]?.id,
          isDirty: false,
        });
        const firstPage = migrated.sections[0]?.pages[0];
        useCanvasStore.getState().loadPageNodes(firstPage?.nodes ?? []);
        useDrawStore.getState().loadPageStrokes(firstPage?.strokes ?? []);
        // <input type="file"> does not yield an FSA handle — clear any prior binding
        // and show the picked file name as the best available identity.
        await clearCurrentHandle();
        useFileBindingStore.getState().setFromHandle({ name: file.name });
        showToast('Notebook opened', 'info');
      } else {
        showToast('Not a valid PowerScroll notebook', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleFilenameClick = () => {
    setFilenameValue(workspace.filename);
    setEditingFilename(true);
  };

  const commitFilename = () => {
    const name = filenameValue.trim();
    if (name && name !== workspace.filename) {
      useWorkspaceStore.setState((state) => ({
        isDirty: true,
        workspace: { ...state.workspace, filename: name },
      }));
    }
    setEditingFilename(false);
  };

  const handleZoomToFit = () => {
    useCanvasStore.getState().zoomToFit();
  };

  const handleExportMarkdown = () => {
    // Flush active page content
    const canvasNodes = useCanvasStore.getState().nodes;
    useWorkspaceStore.getState().savePageNodes(canvasNodes);
    useWorkspaceStore.getState().savePageStrokes(useDrawStore.getState().strokes);

    const ws = useWorkspaceStore.getState().workspace;
    const md = workspaceToMarkdown(ws);
    const filename = ws.filename.replace(/[^a-zA-Z0-9_\- ]/g, '_') + '.md';
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${filename}`, 'success');
    setShowExportMenu(false);
  };

  const pathDisplay = filePathLabel ?? 'Not linked to a file';
  const pathTitle = filePathLabel
    ? filePathLabel.includes('\\') || filePathLabel.includes('/')
      ? pathDisplay
      : `${pathDisplay} — full folder path is only available when this tab is opened as a local file (file://). Open/Save As can only expose the file name.`
    : 'No disk file linked. Open a notebook or save with Save As to link one.';

  return (
    <header className="top-bar" data-testid="topbar">
      <div className="top-bar__identity">
        <div className="top-bar__breadcrumb">
          {editingFilename ? (
            <input
              className="top-bar__filename-input"
              data-testid="topbar-filename-input"
              value={filenameValue}
              onChange={(e) => setFilenameValue(e.target.value)}
              onBlur={commitFilename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitFilename();
                if (e.key === 'Escape') setEditingFilename(false);
              }}
              autoFocus
            />
          ) : (
            <span
              className="top-bar__filename"
              data-testid="topbar-filename"
              onClick={handleFilenameClick}
              title="Click to rename notebook"
            >
              {workspace.filename}
              {isDirty && <span className="top-bar__dirty" data-testid="dirty-indicator"> *</span>}
            </span>
          )}
          {activeSection && (
            <>
              <ChevronRight size={14} className="top-bar__separator" />
              <span className="top-bar__crumb" data-testid="topbar-section">{activeSection.title}</span>
            </>
          )}
          {activePage && (
            <>
              <ChevronRight size={14} className="top-bar__separator" />
              <span className="top-bar__crumb top-bar__crumb--active" data-testid="topbar-page">
                {activePage.title}
              </span>
            </>
          )}
          {selectedScrollTitle && (
            <>
              <ChevronRight size={14} className="top-bar__separator" />
              <span className="top-bar__crumb top-bar__crumb--active" data-testid="topbar-scroll">
                {selectedScrollTitle}
              </span>
            </>
          )}
        </div>
        <div
          className={`top-bar__file-path${filePathLabel ? '' : ' top-bar__file-path--unlinked'}`}
          data-testid="topbar-file-path"
          title={pathTitle}
        >
          {pathDisplay}
        </div>
      </div>

      <div className="top-bar__actions">
        <button
          className="top-bar__action-btn"
          onClick={undo}
          disabled={!undoEnabled}
          title={undoEnabled ? 'Undo (Ctrl+Z)' : 'Nothing to undo'}
          data-testid="undo-btn"
        >
          <Undo2 size={16} />
        </button>
        <button
          className="top-bar__action-btn"
          onClick={handleZoomToFit}
          title="Zoom to fit content"
          data-testid="zoom-fit-btn"
        >
          <Maximize size={16} />
        </button>
        <button
          className="top-bar__action-btn"
          onClick={handleOpen}
          title="Open notebook"
          data-testid="open-btn"
        >
          <FolderOpen size={16} />
        </button>
        <button
          className="top-bar__action-btn"
          onClick={handleRevert}
          disabled={!revertEnabled}
          title={
            revertEnabled
              ? 'Revert to last saved version on disk'
              : 'Nothing to revert — workspace is unchanged or no saved file'
          }
          data-testid="revert-btn"
        >
          <RotateCcw size={16} />
        </button>
        <div className="top-bar__save-group">
          <button
            className={`top-bar__action-btn top-bar__action-btn--primary${isSaving ? ' top-bar__action-btn--saving' : ''}`}
            onClick={() => handleSave(false)}
            disabled={isSaving}
            title={isSaving ? 'Saving…' : 'Save (Ctrl+S)'}
            aria-busy={isSaving}
            data-testid="save-btn"
          >
            {isSaving ? (
              <Loader2 size={16} className="top-bar__save-spinner" data-testid="save-spinner" />
            ) : (
              <Download size={16} />
            )}
          </button>
          <button
            className="top-bar__action-btn top-bar__action-btn--primary top-bar__save-chevron"
            onClick={() => setShowExportMenu((v) => !v)}
            disabled={isSaving}
            title="Export options"
            data-testid="save-dropdown-btn"
          >
            <ChevronDown size={12} />
          </button>
          {showExportMenu && (
            <div className="top-bar__export-menu" data-testid="export-menu">
              <button
                className="top-bar__export-item"
                onClick={() => { handleSave(false); setShowExportMenu(false); }}
              >
                Save
              </button>
              {isFSASupported() && (
                <button
                  className="top-bar__export-item"
                  onClick={() => { handleSave(true); setShowExportMenu(false); }}
                  data-testid="save-as-btn"
                >
                  Save As...
                </button>
              )}
              <button
                className="top-bar__export-item"
                onClick={handleExportMarkdown}
                data-testid="export-markdown-btn"
              >
                Export as Markdown
              </button>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".html"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
          data-testid="file-input"
        />
      </div>
    </header>
  );
}
