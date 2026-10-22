import { expect, type Page } from '@playwright/test';

/**
 * Read the canvas store state from the app via window.__POWERNOTE_STORES__
 */
export async function getCanvasStore(page: Page) {
  return page.evaluate(() => {
    const stores = (window as any).__POWERNOTE_STORES__;
    if (!stores) throw new Error('Stores not exposed on window');
    const state = stores.canvas.getState();
    return {
      nodes: state.nodes,
      viewport: state.viewport,
      selectedNodeIds: state.selectedNodeIds,
      // Backward compat: first selected or null
      selectedNodeId: state.selectedNodeIds?.[0] ?? null,
    };
  });
}

/**
 * Read the workspace store state
 */
export async function getWorkspaceStore(page: Page) {
  return page.evaluate(() => {
    const stores = (window as any).__POWERNOTE_STORES__;
    if (!stores) throw new Error('Stores not exposed on window');
    const state = stores.workspace.getState();
    return {
      workspace: state.workspace,
      activeSectionId: state.activeSectionId,
      activePageId: state.activePageId,
    };
  });
}

/**
 * Read the tool store state
 */
export async function getToolStore(page: Page) {
  return page.evaluate(() => {
    const stores = (window as any).__POWERNOTE_STORES__;
    if (!stores) throw new Error('Stores not exposed on window');
    const state = stores.tool.getState();
    return {
      activeTool: state.activeTool,
      textOptions: state.textOptions,
    };
  });
}

/**
 * Wait for the agent bridge module to finish its dynamic import.
 */
export async function waitForBridgeReady(page: Page) {
  await page.waitForFunction(() => Boolean((window as any).__POWERNOTE_BRIDGE__));
}

/**
 * Run an agent bridge command in-page, bypassing the WebSocket transport.
 * Exercises the same handler the socket would dispatch to.
 */
export async function runBridge<T = any>(
  page: Page,
  cmd: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return page.evaluate(
    ({ cmd, params }) => {
      const bridge = (window as any).__POWERNOTE_BRIDGE__;
      if (!bridge) throw new Error('Bridge not exposed on window');
      return bridge.runBridgeCommand(cmd, params);
    },
    { cmd, params },
  );
}

/**
 * Point the bridge at a port nothing is listening on, so enabling it dials into
 * the void instead of reaching a real server.
 *
 * Required for any test that enables the bridge: the default port is 41777, and
 * if a real powernote-notes server happens to be running there, every parallel
 * worker connects to it and they displace each other — which makes bridge
 * status assertions flaky in a way that has nothing to do with the test.
 *
 * Must be called BEFORE page.goto() — the store reads the URL from localStorage
 * when it is created.
 */
export async function stubBridgeUrl(page: Page, url = 'ws://127.0.0.1:9') {
  await page.addInitScript((u) => {
    try {
      localStorage.setItem('powernote-bridge-url', u);
    } catch {
      // ignored — private mode
    }
  }, url);
}

/**
 * Push a frame at the app exactly as the bridge server would, without standing
 * up a real WebSocket. Accepts an object (serialized for you) or a raw string,
 * so malformed input can be tested too.
 */
export async function sendServerFrame(page: Page, frame: object | string) {
  const raw = typeof frame === 'string' ? frame : JSON.stringify(frame);
  await page.evaluate(async (raw) => {
    const bridge = (window as any).__POWERNOTE_BRIDGE__;
    if (!bridge) throw new Error('Bridge not exposed on window');
    await bridge.handleServerFrame(raw);
  }, raw);
}

/**
 * Run a bridge command expected to fail; returns the error code + message.
 */
export async function runBridgeExpectingError(
  page: Page,
  cmd: string,
  params: Record<string, unknown> = {},
): Promise<{ code: string; message: string }> {
  return page.evaluate(
    async ({ cmd, params }) => {
      const bridge = (window as any).__POWERNOTE_BRIDGE__;
      if (!bridge) throw new Error('Bridge not exposed on window');
      try {
        await bridge.runBridgeCommand(cmd, params);
      } catch (err: any) {
        return { code: err.code ?? 'UNKNOWN', message: String(err.message ?? err) };
      }
      throw new Error(`Expected "${cmd}" to throw, but it succeeded`);
    },
    { cmd, params },
  );
}

/**
 * Click on the Konva canvas at specific viewport coordinates
 */
export async function clickCanvas(page: Page, x: number, y: number) {
  const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
  await canvas.click({ position: { x, y } });
}

/**
 * Double-click on the Konva canvas at specific viewport coordinates
 */
export async function dblClickCanvas(page: Page, x: number, y: number) {
  const canvas = page.locator('[data-testid="canvas-container"] canvas').last();
  await canvas.dblclick({ position: { x, y } });
}

/**
 * Wait for the canvas to be ready (Stage rendered)
 */
export async function waitForCanvasReady(page: Page) {
  await page.locator('[data-testid="canvas-container"] canvas').first().waitFor({ state: 'visible' });
}

/** Presence store used by the live board (agents strip / active cards). */
export async function getPresenceStore(page: Page) {
  return page.evaluate(() => {
    const store =
      (window as any).__POWERNOTE_AGENT_PRESENCE__
      ?? (window as any).__POWERNOTE_STORES__?.agentPresence;
    if (!store) throw new Error('Agent presence store is not exposed');
    const state = store.getState();
    return {
      connected: state.connected,
      actors: state.actors,
      left: state.left ?? {},
      now: state.now,
    };
  });
}

/**
 * Activate a tool by clicking its NavRail button
 */
export async function activateTool(page: Page, tool: 'text' | 'hierarchy') {
  const testId = tool === 'text' ? 'nav-text-tool' : 'nav-hierarchy';
  await page.locator(`[data-testid="${testId}"]`).click();
}

/**
 * Disable the File System Access API in the page, forcing the app to use
 * the legacy download-based save flow. Call this in beforeEach for tests
 * that rely on `page.waitForEvent('download')`.
 *
 * Must be called BEFORE page.goto() — uses addInitScript to run before
 * any app code executes.
 */
export async function disableFSA(page: Page) {
  await page.addInitScript(() => {
    try {
      delete (window as any).showSaveFilePicker;
      delete (window as any).showOpenFilePicker;
      delete (window as any).showDirectoryPicker;
    } catch {
      // Some browsers don't allow deleting window properties; override with undefined
      (window as any).showSaveFilePicker = undefined;
      (window as any).showOpenFilePicker = undefined;
      (window as any).showDirectoryPicker = undefined;
    }
  });
}

/**
 * Load a source module into `window.__mods[path]` for later synchronous use
 * inside `page.evaluate`. Never `await import()` inside an evaluate: Chromium
 * occasionally garbage-collects the promise the evaluate returns while the
 * import is pending, which Playwright reports as "Execution context was
 * destroyed, most likely because of a navigation" (CDP: "Promise was
 * collected"). T151/T158 flaked at ~10% that way; this pattern ran 48/48.
 */
export async function preloadModule(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    const w = window as any;
    w.__mods ??= {};
    if (!w.__mods[p]) import(/* @vite-ignore */ p).then((m) => { w.__mods[p] = m; });
  }, path);
  await page.waitForFunction((p) => Boolean((window as any).__mods?.[p]), path);
}

// ── Text-block editor (ProseMirror) ──────────────────────────────────────
// The editor is a contenteditable, not a textarea: drive it with the real
// keyboard, and read/set its markdown through the app's editor hook.

/** The live text-block editor's content element. */
export function textEditor(page: Page) {
  return page.getByTestId('text-editor');
}

/** The markdown currently in the live editor (null when none is open). */
export async function editorValue(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as any).__POWERNOTE_TEXT_EDITOR__?.getValue() ?? null);
}

/** Wait until the live editor holds exactly `expected`. */
export async function expectEditorValue(page: Page, expected: string) {
  await expect.poll(() => editorValue(page)).toBe(expected);
}

/** Replace the editor's whole text (caret at the end) and keep it focused. */
export async function fillEditor(page: Page, text: string) {
  await textEditor(page).waitFor({ state: 'visible' });
  await page.evaluate((t) => {
    const ed = (window as any).__POWERNOTE_TEXT_EDITOR__;
    ed.setSelection(0);
    ed.setValue(t);
  }, text);
}

/** Select [from, to) in the editor (a caret when `to` is omitted). */
export async function selectInEditor(page: Page, from: number, to?: number) {
  await page.evaluate(([f, t]) => (window as any).__POWERNOTE_TEXT_EDITOR__.setSelection(f, t ?? f), [from, to] as const);
}

/** The editor's selection as [from, to]. */
export async function editorSelection(page: Page): Promise<[number, number]> {
  return page.evaluate(() => (window as any).__POWERNOTE_TEXT_EDITOR__.getSelection());
}

/** Commit the edit the way a user does: focus leaves the editor. */
export async function commitEditor(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(textEditor(page)).toHaveCount(0);
}
