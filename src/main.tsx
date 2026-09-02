import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { getEmbeddedData, startAutoSave, extractDataFromHtml, clearLegacyAutoSave } from './utils/serialization';
import { useWorkspaceStore } from './stores/useWorkspaceStore';
import { useCanvasStore } from './stores/useCanvasStore';
import { useDrawStore } from './stores/useDrawStore';
import { useHistoryStore } from './stores/useHistoryStore';
import { migrateWorkspace } from './utils/migrations';
import { checkForUpdate } from './utils/updateChecker';
import { isFSASupported, readFromHandle } from './utils/fileSystemAccess';
import { getCurrentHandle, clearCurrentHandle } from './utils/fileHandleStore';
import { useFileBindingStore } from './stores/useFileBindingStore';
import { APP_VERSION } from './version';
import type { WorkspaceData } from './types/data';

function hydrateStores(data: WorkspaceData, refreshBinding = true) {
  useWorkspaceStore.setState({
    workspace: data,
    activeSectionId: data.sections[0]?.id,
    activePageId: data.sections[0]?.pages[0]?.id,
    isDirty: false,
  });
  const firstPage = data.sections[0]?.pages[0];
  useCanvasStore.getState().loadPageNodes(firstPage?.nodes ?? []);
  useDrawStore.getState().loadPageStrokes(firstPage?.strokes ?? []);
  if (refreshBinding) {
    void useFileBindingStore.getState().refresh();
  }
}

// One-shot migration: older builds stashed a full workspace snapshot under
// `powernote-autosave`. That path is gone — the FSA handle + notebook
// library cover persistence now. Clear any legacy value so upgraded
// installs don't hold stale state.
clearLegacyAutoSave();

// Hydrate priority:
//   1. Embedded data (standalone HTML)
//   2. FSA current file handle (if permission already granted)
//   3. Fresh workspace (defaults)
const embeddedData = getEmbeddedData();
if (embeddedData) {
  const migrated = migrateWorkspace(embeddedData);
  if (window.location.protocol === 'file:') {
    // Local file:// open: this HTML document IS the notebook. Drop any
    // persisted FSA handle BEFORE resolving the path indicator so a stale
    // name (e.g. from a previous Save As) cannot win — and so Save/autosave
    // cannot overwrite that other file.
    hydrateStores(migrated, false);
    void (async () => {
      await clearCurrentHandle();
      useFileBindingStore.getState().setFromFileUrl();
    })();
  } else {
    hydrateStores(migrated);
  }
} else if (isFSASupported()) {
  // Async: try to restore from FSA handle if permission is already granted.
  // If NOT granted, we don't prompt (that requires user gesture) — the
  // user can re-open via the Open button which prompts properly.
  (async () => {
    try {
      const handle = await getCurrentHandle();
      if (!handle) return;
      const perm = await (handle as any).queryPermission?.({ mode: 'read' });
      if (perm !== 'granted') return; // silent skip — user will reopen manually
      const text = await readFromHandle(handle);
      if (!text) return;
      const data = extractDataFromHtml(text);
      if (data) {
        hydrateStores(migrateWorkspace(data));
        console.log('[PowerScroll] Restored last file via FSA handle');
      }
    } catch (err) {
      console.warn('[PowerScroll] FSA restore failed, handle may be stale:', err);
      await clearCurrentHandle();
    }
  })();
}

// Check for updates (non-blocking, silent on failure)
checkForUpdate(APP_VERSION).then((result) => {
  console.log('[PowerScroll] Update check result:', result);
  if (result?.available && result.latestVersion) {
    (window as any).__POWERNOTE_UPDATE__ = result;
    console.log(`[PowerScroll] Update available: v${result.latestVersion}`);
  }
}).catch((err) => {
  console.error('[PowerScroll] Update check error:', err);
});

// Start auto-save (debounced 1.5s after last edit, max-wait 5s while dirty).
// Driven by workspace-store subscription: canvas/draw mutations flip
// isDirty on the workspace store, which is the only signal we listen to.
startAutoSave(
  () => {
    const ws = useWorkspaceStore.getState();
    ws.savePageNodes(useCanvasStore.getState().nodes);
    ws.savePageStrokes(useDrawStore.getState().strokes);
    return useWorkspaceStore.getState().workspace;
  },
  () => useWorkspaceStore.getState().isDirty,
  (onChange) => useWorkspaceStore.subscribe(onChange),
);

// Expose stores for E2E testing (dev) and re-export (production standalone)
Promise.all([
  import('./stores/useToolStore'),
  import('./stores/useFileBindingStore'),
  import('./stores/useGroupStore'),
  import('./utils/groupOps'),
  import('./utils/scrollOps'),
  import('./utils/imageEmbed'),
]).then(([{ useToolStore }, { useFileBindingStore }, { useGroupStore }, groupOps, scrollOps, imageEmbed]) => {
  (window as any).__POWERNOTE_STORES__ = {
    workspace: useWorkspaceStore,
    canvas: useCanvasStore,
    tool: useToolStore,
    draw: useDrawStore,
    history: useHistoryStore,
    fileBinding: useFileBindingStore,
    group: useGroupStore,
  };
  (window as any).__POWERNOTE_GROUP_OPS__ = groupOps;
  (window as any).__POWERNOTE_SCROLL_OPS__ = scrollOps;
  (window as any).__POWERNOTE_UTILS__ = {
    embedImage: imageEmbed.embedImage,
    imageNodeFromEmbed: imageEmbed.imageNodeFromEmbed,
    embedImageFromUrl: imageEmbed.embedImageFromUrl,
  };
});

// Agent bridge — dials out to the local MCP server, but only if the user has
// turned it on for this machine. Off by default so a standalone notebook
// opened elsewhere never tries to connect.
Promise.all([
  import('./bridge/client'),
  import('./bridge/commands'),
  import('./stores/useBridgeStore'),
]).then(async ([{ initBridge, handleServerFrame }, { runBridgeCommand }, { useBridgeStore }]) => {
  // Wait for fonts before the bridge accepts anything. Block layout is computed
  // from a real offscreen measurement, so a font that lands later changes text
  // metrics after blocks have already been positioned — TextNode then corrects
  // the heights but nothing re-positions, leaving blocks overlapping.
  try {
    await document.fonts?.ready;
  } catch {
    // ignored — font loading is best-effort, layout falls back to current metrics
  }
  initBridge();
  // Exposed so E2E tests can exercise bridge commands and server frames
  // without standing up a real WebSocket server.
  (window as any).__POWERNOTE_BRIDGE__ = {
    runBridgeCommand,
    handleServerFrame,
    store: useBridgeStore,
  };
});

createRoot(document.getElementById('root')!).render(<App />);
