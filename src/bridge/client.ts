/**
 * WebSocket client for the agent bridge.
 *
 * The app dials out to the MCP server (see protocol.ts for why the direction
 * is inverted), announces itself with a hello frame, then serves commands
 * until the socket drops. Reconnects with capped exponential backoff so the
 * app and the MCP server can be started in either order.
 */

import { APP_VERSION } from '../version';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useBridgeStore } from '../stores/useBridgeStore';
import { runBridgeCommand, BridgeCommandError } from './commands';
import { useAgentPresenceStore } from '../stores/useAgentPresenceStore';
import {
  BRIDGE_PROTOCOL_VERSION,
  DEFAULT_BRIDGE_URL,
  type BridgeAgents,
  type BridgeControlFrame,
  type BridgeErrorCode,
  type BridgeHello,
  type BridgeRequest,
} from './protocol';

/**
 * Response body minus the envelope fields. Written out rather than derived via
 * `Omit<BridgeResponse, …>`, which distributes over the union and collapses to
 * only the keys both arms share.
 */
type BridgeResponseBody =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: BridgeErrorCode; message: string } };

const BASE_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 10_000;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let running = false;

function clearReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(url: string): void {
  if (!running) return;
  clearReconnect();
  const delay = Math.min(MAX_RECONNECT_MS, BASE_RECONNECT_MS * 2 ** attempt);
  attempt += 1;
  reconnectTimer = setTimeout(() => open(url), delay);
}

function send(payload: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

/**
 * Stop for good — another notebook has claimed the connection.
 *
 * Deliberately does NOT schedule a reconnect. Retrying is exactly what caused
 * the flip-flop: this client would displace the newcomer, get displaced back,
 * and the two would trade the slot indefinitely while commands landed in
 * whichever notebook happened to hold it at the time.
 */
function standDown(reason: string): void {
  running = false;
  clearReconnect();
  attempt = 0;
  if (socket) {
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
    socket = null;
  }
  // Flip the user-facing toggle off too. The checkbox should reflect that this
  // notebook is no longer connected, and clearing the persisted flag stops a
  // forgotten background tab from silently re-claiming the slot after a reload.
  // Re-checking the box takes the connection back.
  useBridgeStore.getState().setEnabled(false);
  // Status must be set AFTER setEnabled: that call unwinds through stopBridge,
  // which would otherwise overwrite this with 'off'.
  useBridgeStore.getState().setStatus('displaced', reason);
}

/**
 * Entry point for every frame the server sends — control frames first, then
 * ordinary command requests. Exported so tests can drive it without a socket.
 */
export async function handleServerFrame(raw: string): Promise<void> {
  let frame: unknown;
  try {
    frame = JSON.parse(raw);
  } catch {
    return; // unparseable frame — nothing to reply to, no id
  }
  if (!frame || typeof frame !== 'object') return;
  const candidate = frame as Partial<BridgeControlFrame> & Partial<BridgeRequest>;

  if (candidate.type === 'displaced') {
    standDown(
      typeof candidate.reason === 'string' && candidate.reason
        ? candidate.reason
        : 'Another notebook took the connection',
    );
    return;
  }

  if (candidate.type === 'agents') {
    const agentsFrame = frame as BridgeAgents;
    useAgentPresenceStore.getState().setConnected(
      Array.isArray(agentsFrame.agents) ? agentsFrame.agents : [],
    );
    return;
  }

  if (typeof candidate.id === 'string' && typeof candidate.cmd === 'string') {
    await handleRequest(frame as BridgeRequest);
  }
}

async function handleRequest(request: BridgeRequest): Promise<void> {
  const respond = (body: BridgeResponseBody) =>
    send({ v: BRIDGE_PROTOCOL_VERSION, id: request.id, ...body });

  try {
    const result = await runBridgeCommand(request.cmd, request.params ?? {});
    useBridgeStore.getState().noteCommand(request.cmd);
    respond({ ok: true, result });
  } catch (err) {
    const isKnown = err instanceof BridgeCommandError;
    respond({
      ok: false,
      error: {
        code: isKnown ? err.code : 'INTERNAL',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

function open(url: string): void {
  if (!running) return;

  const store = useBridgeStore.getState();
  store.setStatus('connecting');

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    store.setStatus('error', err instanceof Error ? err.message : String(err));
    scheduleReconnect(url);
    return;
  }
  socket = ws;

  ws.onopen = () => {
    attempt = 0;
    useBridgeStore.getState().setStatus('connected');
    const hello: BridgeHello = {
      v: BRIDGE_PROTOCOL_VERSION,
      type: 'hello',
      app: 'powernote',
      appVersion: APP_VERSION,
      notebook: useWorkspaceStore.getState().workspace.filename,
    };
    send(hello);
  };

  ws.onmessage = (event) => {
    if (typeof event.data === 'string') void handleServerFrame(event.data);
  };

  ws.onerror = () => {
    // The close handler drives reconnection; onerror carries no useful detail
    // in browsers, so just surface that something went wrong.
    useBridgeStore.getState().setStatus('error', `Cannot reach ${url}`);
  };

  ws.onclose = () => {
    socket = null;
    if (!running) {
      useBridgeStore.getState().setStatus('off');
      return;
    }
    useBridgeStore.getState().setStatus('connecting');
    scheduleReconnect(url);
  };
}

/** Begin dialing the MCP server. Safe to call repeatedly. */
export function startBridge(url?: string): void {
  const target = url || useBridgeStore.getState().url || DEFAULT_BRIDGE_URL;
  if (running) return;
  running = true;
  attempt = 0;
  open(target);
}

/** Stop the bridge and drop any open socket. */
export function stopBridge(): void {
  running = false;
  clearReconnect();
  attempt = 0;
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  useBridgeStore.getState().setStatus('off');
}

/**
 * Keep the socket in sync with the user's toggle. Returns an unsubscribe fn.
 * The bridge is OFF unless explicitly enabled — a standalone notebook opened
 * on someone else's machine must never dial out on its own.
 */
export function initBridge(): () => void {
  const apply = (enabled: boolean, url: string) => {
    if (enabled) {
      if (!running) startBridge(url || DEFAULT_BRIDGE_URL);
    } else if (running) {
      stopBridge();
    }
  };

  const { enabled, url } = useBridgeStore.getState();
  apply(enabled, url);

  let prevEnabled = enabled;
  let prevUrl = url;
  return useBridgeStore.subscribe((state) => {
    if (state.enabled === prevEnabled && state.url === prevUrl) return;
    const urlChanged = state.url !== prevUrl;
    prevEnabled = state.enabled;
    prevUrl = state.url;
    // A URL change while connected needs a full cycle to take effect.
    if (urlChanged && running) stopBridge();
    apply(state.enabled, state.url);
  });
}
