import type { WorkspaceData } from '../types/data';
import { injectExtensionBlocks } from '../extensions/embed';
import { collectEmbeddedExtensions, harvestEmbeddedExtensions } from '../extensions/drawioViewer';
import { generateId } from './ids';

const DATA_SCRIPT_ID = 'powernote-data';
const LEGACY_AUTOSAVE_KEY = 'powernote-autosave';
const AUTOSAVE_DEBOUNCE_MS = 1_500;
const AUTOSAVE_MAX_WAIT_MS = 5_000;

/**
 * Serialize workspace data to a JSON string
 */
export function serializeWorkspace(workspace: WorkspaceData): string {
  return JSON.stringify(workspace, null, 2);
}

/**
 * Deserialize workspace data from a JSON string
 */
export function deserializeWorkspace(json: string): WorkspaceData | null {
  try {
    const data = JSON.parse(json);
    if (!data.version || !data.sections) return null;
    // Notebooks saved before ids existed get one derived from their own first
    // section id, so reopening the same file finds the same recovery entry
    // instead of adding a new one each session.
    if (!data.id) data.id = data.sections[0]?.id ? `nb-${data.sections[0].id}` : generateId();
    return data as WorkspaceData;
  } catch {
    return null;
  }
}

/**
 * Check if the current document has embedded PowerScroll data. The legacy
 * `powernote-data` id is intentionally stable so every existing notebook opens.
 */
export function getEmbeddedData(): WorkspaceData | null {
  const scriptTag = document.getElementById(DATA_SCRIPT_ID);
  if (!scriptTag) return null;
  const json = scriptTag.textContent?.trim();
  if (!json) return null;
  return deserializeWorkspace(json);
}

/**
 * Build a self-contained HTML file with the app bundle + embedded data.
 *
 * In PRODUCTION (standalone HTML): uses document.documentElement.outerHTML
 * since JS/CSS are already inlined.
 *
 * In DEV: fetches the pre-built single-file template from dist-template/
 * and injects the user data into it.
 */
export async function buildExportHtml(workspace: WorkspaceData): Promise<string> {
  const json = serializeWorkspace(workspace);
  const dataScript = `<script id="${DATA_SCRIPT_ID}" type="application/json">\n${json}\n</script>`;

  let html: string;

  // Detect dev mode: import.meta.env exists in Vite dev, but is {} in IIFE builds
  const isDev = typeof import.meta !== 'undefined'
    && import.meta.env
    && import.meta.env.DEV;

  if (isDev) {
    // In dev mode: fetch the pre-built production template
    try {
      const resp = await fetch('/dist-template/index.html');
      if (!resp.ok) throw new Error(`Template fetch failed: ${resp.status}`);
      html = await resp.text();
    } catch (e) {
      console.error('Failed to fetch export template. Run: npm run build:template', e);
      // Fallback: use current page HTML (won't work standalone but preserves data)
      html = document.documentElement.outerHTML;
    }
  } else {
    // In production (standalone HTML): current page IS the bundled app
    html = document.documentElement.outerHTML;
  }

  // Replace existing data script or insert before </head>
  const existingPattern = /<script id="powernote-data" type="application\/json">[\s\S]*?<\/script>/;
  let out: string;
  if (existingPattern.test(html)) {
    out = html.replace(existingPattern, dataScript);
  } else {
    // Ensure we have <!DOCTYPE html> at the start
    const doctype = html.startsWith('<!') ? '' : '<!DOCTYPE html>\n';
    out = doctype + html.replace('</head>', `${dataScript}\n</head>`);
  }

  // Installed extensions ride in their own blocks, re-injected from the
  // runtime accessor EVERY save. Never rely on the block surviving in the
  // DOM: the dev branch above just refetched a pristine template that has no
  // block at all, and that branch is what every E2E run exercises.
  out = injectExtensionBlocks(out, await collectEmbeddedExtensions());
  return out;
}

/**
 * Trigger a file download in the browser
 */
export function downloadFile(
  content: string,
  filename: string,
  mime: string = 'text/html;charset=utf-8',
) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Read an HTML file and extract embedded PowerScroll data.
 *
 * Also harvests any extension blocks the file carries (v0.65) — this is the
 * one choke point every open path goes through (FSA restore, Open picker,
 * file input, revert), and a notebook opened WITHOUT its extensions being
 * remembered would silently lose them on the next save. The harvest is
 * fire-and-forget and never throws.
 */
export function extractDataFromHtml(htmlContent: string): WorkspaceData | null {
  harvestEmbeddedExtensions(htmlContent);
  const match = htmlContent.match(
    /<script id="powernote-data" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  return deserializeWorkspace(match[1].trim());
}

// ─── Auto-Save ───────────────────────────────────────────────

/**
 * Remove any legacy `powernote-autosave` localStorage snapshot. Older builds
 * used to write the full workspace here; current builds persist via the
 * File System Access handle + notebook library instead. Called once on
 * startup so upgraded installs do not keep stale state around.
 */
export function clearLegacyAutoSave(): void {
  try {
    localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
  } catch {
    // ignored — quota/privacy errors are non-fatal here
  }
}

/**
 * Start the auto-save pipeline. Returns a cleanup function.
 *
 * Cadence:
 *   - Saves 1.5 s after the last edit (debounced).
 *   - If edits keep arriving, saves are forced no later than 5 s after the
 *     notebook first became dirty (max-wait safety net).
 *
 * Destinations (when available):
 *   - Notebook library (localStorage, user-browsable, up to 5 entries).
 *   - Live file on disk via the current `FileSystemFileHandle`, but only
 *     when read-write permission is already granted (no silent prompts).
 *
 * `subscribeToChanges` is invoked with a handler that should fire on any
 * workspace-affecting store update; the returned function is used to
 * unsubscribe on cleanup.
 */
export function startAutoSave(
  flushAndGetWorkspace: () => WorkspaceData,
  getIsDirty: () => boolean,
  subscribeToChanges: (onChange: () => void) => () => void,
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let firstDirtyAt: number | null = null;
  let saveInFlight = false;
  let rerunAfterSave = false;
  // Counts real edits. The flush below writes the canvas into the workspace
  // store, which notifies subscribers too — those notifications are ignored,
  // otherwise every save would schedule the next one forever.
  let changeSeq = 0;
  let flushing = false;

  const runSave = async () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    firstDirtyAt = null;
    if (saveInFlight) {
      // An edit landed while a save was running: save again when it finishes,
      // rather than leaving that edit unsaved until the next one.
      rerunAfterSave = true;
      return;
    }
    if (!getIsDirty()) return;
    saveInFlight = true;
    try {
      const seqAtSnapshot = changeSeq;
      flushing = true;
      let workspace: WorkspaceData;
      try {
        workspace = flushAndGetWorkspace();
      } finally {
        flushing = false;
      }
      (window as any).__POWERNOTE_AUTOSAVE_RUNS__ = ((window as any).__POWERNOTE_AUTOSAVE_RUNS__ ?? 0) + 1;
      const { saveRecovery } = await import('./recoveryStore');
      const { useSaveStatusStore } = await import('../stores/useSaveStatusStore');
      const status = useSaveStatusStore.getState();
      status.setStatus('saving', undefined, status.fileName);

      let browserSaved = false;
      try {
        await saveRecovery(workspace);
        browserSaved = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Browser storage is unavailable';
        useSaveStatusStore.getState().setStatus('error', message);
        // Once per failure streak — not a toast every 1.5 s.
        if (!useSaveStatusStore.getState().failureReported) {
          const { showToast } = await import('../components/layout/Toast');
          showToast(`Could not keep a recovery copy in this browser: ${message}`, 'error');
          useSaveStatusStore.getState().setFailureReported(true);
        }
      }

      let fileSaved = false;
      try {
        const { isFSASupported } = await import('./fileSystemAccess');
        if (isFSASupported() && workspace.id) {
          const { getHandleForNotebook, isHandleForThisDocument } = await import('./fileHandleStore');
          const handle = await getHandleForNotebook(workspace.id);
          if (handle && isHandleForThisDocument(handle)) {
            const perm = await (handle as any).queryPermission?.({ mode: 'readwrite' });
            if (perm === 'granted') {
              const html = await buildExportHtml(workspace);
              const writable = await handle.createWritable();
              await writable.write(html);
              await writable.close();
              fileSaved = true;
              useSaveStatusStore.getState().setStatus('saved-file', undefined, handle.name);
            } else {
              useSaveStatusStore.getState().setStatus('needs-permission', undefined, handle.name);
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'The linked file could not be written';
        useSaveStatusStore.getState().setStatus('error', message);
      }

      if (browserSaved && !fileSaved && useSaveStatusStore.getState().status === 'saving') {
        useSaveStatusStore.getState().setStatus('saved-browser');
      }
      if (browserSaved) useSaveStatusStore.getState().setFailureReported(false);
      // Clean only when the snapshot just persisted is still the latest state.
      if ((browserSaved || fileSaved) && changeSeq === seqAtSnapshot) {
        const { useWorkspaceStore } = await import('../stores/useWorkspaceStore');
        useWorkspaceStore.getState().markClean();
      }
    } finally {
      saveInFlight = false;
      if (rerunAfterSave) {
        rerunAfterSave = false;
        scheduleSave();
      }
    }
  };

  const scheduleSave = () => {
    if (!getIsDirty()) return;
    const now = Date.now();
    if (firstDirtyAt == null) firstDirtyAt = now;
    const elapsed = now - firstDirtyAt;
    const delay = Math.max(0, Math.min(AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_WAIT_MS - elapsed));
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSave, delay);
  };

  const onChange = () => {
    if (flushing) return;
    changeSeq++;
    if (saveInFlight) rerunAfterSave = true;
    scheduleSave();
  };
  const unsubscribe = subscribeToChanges(onChange);

  // Never lose the last seconds: leaving the tab saves at once, skipping the debounce.
  const flushNow = () => {
    void runSave();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flushNow();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flushNow);

  // A notebook that is already dirty when autosave starts (state written
  // before this subscription existed) is saved too.
  scheduleSave();

  return () => {
    unsubscribe();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', flushNow);
  };
}
