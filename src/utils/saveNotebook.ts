import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useCanvasStore } from '../stores/useCanvasStore';
import { useDrawStore } from '../stores/useDrawStore';
import { buildExportHtml, downloadFile } from './serialization';
import {
  isFSASupported,
  saveAsWithPicker,
  writeToHandle,
} from './fileSystemAccess';
import { getCurrentHandle, setCurrentHandle, addRecentHandle, setHandleForNotebook } from './fileHandleStore';
import { APP_VERSION } from '../version';
import { showToast } from '../components/layout/Toast';
import { useSaveStatusStore } from '../stores/useSaveStatusStore';

export type SaveOutcome =
  | { ok: true; savedTo: string; revision: number }
  | { ok: false; reason: 'busy' | 'no-bound-file' | 'cancelled' | 'failed' };

export interface SaveNotebookOptions {
  /**
   * Only overwrite an already-bound file; never fall back to the Save As
   * picker or a download. The agent bridge needs this: the picker requires a
   * user gesture it cannot produce, so without the guard an agent-triggered
   * save would silently do nothing.
   */
  existingFileOnly?: boolean;
}

/**
 * Unified save flow. Tries File System Access API first (fast path:
 * overwrite existing handle, or Save As picker for new file), falls back
 * to legacy download for browsers without FSA support.
 *
 * @param forceSaveAs If true, always show the Save As picker (ignores current handle).
 */
export async function saveNotebook(
  forceSaveAs: boolean = false,
  options: SaveNotebookOptions = {},
): Promise<SaveOutcome> {
  const wsStore = useWorkspaceStore.getState();
  // Guard against double-trigger while a save is already running
  if (wsStore.isSaving) return { ok: false, reason: 'busy' };

  wsStore.setSaving(true);
  try {
    // Test hook: artificial delay so E2E can observe the saving indicator
    const delayMs = (window as unknown as { __POWERNOTE_SAVE_DELAY__?: number })
      .__POWERNOTE_SAVE_DELAY__;
    if (typeof delayMs === 'number' && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    // Flush in-memory state to workspace
    const canvasNodes = useCanvasStore.getState().nodes;
    const store = useWorkspaceStore.getState();
    store.savePageNodes(canvasNodes);
    store.savePageStrokes(useDrawStore.getState().strokes);

    // Increment save revision and stamp editor version
    const revision = (store.workspace.saveRevision || 0) + 1;
    store.updateWorkspace({ editorVersion: APP_VERSION, saveRevision: revision });

    const ws = useWorkspaceStore.getState().workspace;
    const safeName = ws.filename.replace(/[^a-zA-Z0-9_\- ]/g, '_');

    const html = await buildExportHtml(ws);

    // ── Fast path: overwrite existing file via FSA ──────────
    if (!forceSaveAs && isFSASupported()) {
      const handle = await getCurrentHandle();
      if (handle) {
        const ok = await writeToHandle(handle, html);
        if (ok) {
          useWorkspaceStore.getState().markClean();
          if (ws.id) await setHandleForNotebook(ws.id, handle);
          useSaveStatusStore.getState().setStatus('saved-file', undefined, handle.name);
          showToast(`Saved to ${handle.name}`, 'success');
          return { ok: true, savedTo: handle.name, revision };
        }
        // Fall through to Save As if permission denied or write failed
      }
    }

    // No bound file (or the write failed) and the caller cannot show a picker.
    if (options.existingFileOnly) {
      return { ok: false, reason: 'no-bound-file' };
    }

    // ── Save As: show picker for new location ───────────────
    if (isFSASupported()) {
      const suggestedName = `${safeName}.html`;
      const newHandle = await saveAsWithPicker(html, suggestedName);
      if (newHandle) {
        await setCurrentHandle(newHandle);
        await addRecentHandle(ws.filename, newHandle);
        if (ws.id) await setHandleForNotebook(ws.id, newHandle);
        useWorkspaceStore.getState().markClean();
        useSaveStatusStore.getState().setStatus('saved-file', undefined, newHandle.name);
        showToast(`Saved to ${newHandle.name}`, 'success');
        return { ok: true, savedTo: newHandle.name, revision };
      }
      // User cancelled the picker — do nothing (workspace stays dirty)
      return { ok: false, reason: 'cancelled' };
    }

    // ── Fallback: legacy versioned download ─────────────────
    const versionedFilename = `${safeName} (v${APP_VERSION}-r${revision}).html`;
    downloadFile(html, versionedFilename);
    useWorkspaceStore.getState().markClean();
    showToast(`Downloaded ${versionedFilename}`, 'success');
    return { ok: true, savedTo: versionedFilename, revision };
  } catch (err) {
    console.error('[saveNotebook] Failed:', err);
    showToast('Failed to save notebook', 'error');
    return { ok: false, reason: 'failed' };
  } finally {
    useWorkspaceStore.getState().setSaving(false);
  }
}
