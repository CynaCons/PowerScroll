#!/usr/bin/env node
/**
 * powerscroll-mcp — MCP server for writing notes into a running PowerScroll.
 *
 * Topology: this process hosts a WebSocket on loopback; the PowerScroll app dials
 * out to it (a browser page cannot listen on a port, and PowerScroll ships as a
 * single static HTML file). Tool calls are forwarded to the connected app,
 * which applies them to its live stores; its normal auto-save then persists
 * them to the notebook file.
 *
 * MULTIPLE AGENTS (v0.36). One MCP server process is spawned per agent session,
 * so several of them race for the same port. The winner becomes the HUB and owns
 * the single app connection; the losers become PEERS and forward their tool
 * calls to the hub over the same loopback port. This keeps exactly one socket to
 * the notebook, which means the app needs no changes and there is one obvious
 * place for the lock.
 *
 * Agents may connect freely but may not operate concurrently: the hub hands out
 * a lease, held for the duration of a command and for a short idle grace after
 * it. A blocked agent is told who holds the lock and when to retry. Read-only
 * tools bypass the lease, because looking while someone writes is harmless and
 * refusing it would make a blocked agent unable to find out anything.
 *
 * IMPORTANT: stdout is the MCP transport. All logging goes to stderr.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const PROTOCOL_VERSION = 1;
const PORT = Number(process.env.POWERNOTE_BRIDGE_PORT || 41777);
const HOST = '127.0.0.1';
const REQUEST_TIMEOUT_MS = Number(process.env.POWERNOTE_BRIDGE_TIMEOUT_MS || 10_000);

const log = (...args) => console.error('[powerscroll-mcp]', ...args);

/** This process's agent identity. Stable for its lifetime. */
const AGENT_ID = randomUUID().slice(0, 8);
const AGENT_LABEL = process.env.POWERNOTE_AGENT_NAME || `agent-${AGENT_ID}`;

/**
 * Tools that only look. They bypass the lease: a blocked agent must still be
 * able to read, and above all to call `bridge_status` to find out why it is
 * blocked.
 */
const READ_ONLY = new Set([
  'list_pages',
  'read_page',
  'read_diagram',
  'read_image',
  'get_block',
  'list_scrolls',
  'get_background',
  'check_update',
  'bridge_status',
  'board_list',
  'board_read',
  'card_get',
  'board_updates',
]);

const AGENT_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const BOARD_ME_TOOLS = new Set([
  'board_create',
  'card_create',
  'card_update',
  'card_claim',
  'card_release',
  'card_move',
  'card_note',
  'card_check',
  'card_checklist_add',
  'card_archive',
  'card_restore',
  'agent_status',
  'agent_leave',
  'board_updates',
]);
const BOARD_WORKFLOW =
  'Workflow: board_read the board, card_claim a card, card_move it to doing, ' +
  'work and call card_check/card_note as you go, agent_status for what you are doing now, ' +
  'card_move to waiting WITH a question when you need the owner, ' +
  'board_updates {mine:true, wait_seconds} to hear back, then card_move to done.';
const HUB_CONNECTED_AT = Date.now();
const ME_PROP = {
  type: 'string',
  description:
    'Your short agent name (^[a-z0-9][a-z0-9._-]{0,39}$). Defaults to POWERNOTE_AGENT_NAME ' +
    'or this process label. Passed to the app as actor and recorded on cards, notes and events.',
};

/** Idle grace between one agent's commands before another may take over. */
const LOCK_IDLE_MS = Number(process.env.POWERNOTE_LOCK_IDLE_MS || 10_000);
/** A holder that keeps working still yields after this, if anyone is waiting. */
const LOCK_MAX_HOLD_MS = Number(process.env.POWERNOTE_LOCK_MAX_HOLD_MS || 120_000);

// ── App connection ──────────────────────────────────────────

/** The currently connected PowerScroll tab, if any. Latest connection wins. */
let app = null;
/** Metadata from the app's hello frame. */
let appInfo = null;
/** id → { resolve, reject, timer } for in-flight requests. */
const pending = new Map();

/** 'hub' once we own the port, 'peer' once we are talking to whoever does. */
let mode = 'starting';
/** Peer mode: our socket to the hub. */
let hub = null;
/** Hub mode: peer socket -> { agentId, label }. */
const peers = new Map();
/** Set when startup failed for a reason the user has to fix. */
let startupError = null;
/** Hub mode: the listening server, so shutdown can close it. */
let wss = null;

/**
 * The lease. `inFlight` is what stops it expiring underneath a slow command:
 * run_update downloads a couple of megabytes without issuing anything, and an
 * idle-only timer would hand the notebook to someone else mid-download.
 */
let lock = { holder: null, label: null, inFlight: 0, idleUntil: 0, since: 0 };
/** agentIds waiting, oldest first. Decides when a long holder must yield. */
const waiting = [];

function releaseLock(why) {
  if (!lock.holder) return;
  log('Lock released by ' + lock.label + ' (' + why + ').');
  lock = { holder: null, label: null, inFlight: 0, idleUntil: 0, since: 0 };
}

/**
 * Expiry is evaluated on use rather than on a timer: a timer that fires while
 * nothing is happening tells us nothing, and one that fires mid-command would
 * be wrong anyway.
 */
function currentHolder(now) {
  now = now || Date.now();
  if (lock.holder && lock.inFlight === 0 && now > lock.idleUntil) releaseLock('idle');
  return lock.holder;
}

function lockStatus(now) {
  now = now || Date.now();
  const holder = currentHolder(now);
  return {
    held: !!holder,
    holderId: holder,
    holder: holder ? lock.label : null,
    retryAfterMs: holder ? Math.max(0, lock.idleUntil - now) : 0,
    heldForMs: holder ? now - lock.since : 0,
    waiting: waiting.length,
  };
}

class Locked extends Error {}

/**
 * Grants the lease, or explains who has it. A holder past LOCK_MAX_HOLD_MS
 * yields at its next command boundary, but only when someone is actually
 * waiting -- otherwise a long solo task would interrupt itself for nothing.
 */
function acquireLock(agentId, label) {
  const now = Date.now();
  const holder = currentHolder(now);

  if (holder && holder !== agentId) {
    if (waiting.indexOf(agentId) < 0) waiting.push(agentId);
    const st = lockStatus(now);
    throw new Locked(
      'Another agent is operating this notebook. "' + st.holder + '" holds it and has ' +
      'been working for ' + Math.round(st.heldForMs / 1000) + 's; it frees up after about ' +
      Math.ceil(st.retryAfterMs / 1000) + 's of inactivity. Do other work and retry, or call ' +
      'bridge_status to check. You are queued at position ' + (waiting.indexOf(agentId) + 1) + '.',
    );
  }

  if (holder === agentId && now - lock.since > LOCK_MAX_HOLD_MS && waiting.length > 0) {
    const n = waiting.length;
    releaseLock('max hold reached with agents waiting');
    throw new Locked(
      'You have held this notebook for over ' + Math.round(LOCK_MAX_HOLD_MS / 1000) + 's and ' +
      n + ' agent(s) are waiting, so the lock was handed on. Retry to queue for it again.',
    );
  }

  const idx = waiting.indexOf(agentId);
  if (idx >= 0) waiting.splice(idx, 1);

  if (!holder) {
    lock = { holder: agentId, label: label, inFlight: 0, idleUntil: now + LOCK_IDLE_MS, since: now };
    log('Lock acquired by ' + label + '.');
  }
  lock.inFlight += 1;
  return function release() {
    lock.inFlight = Math.max(0, lock.inFlight - 1);
    lock.idleUntil = Date.now() + LOCK_IDLE_MS;
  };
}

/** Fail every in-flight request now, rather than letting each one time out. */
function rejectPending(message) {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.reject(new BridgeUnavailable(message));
  }
}

// -- Hub mode: own the port, own the app, own the lock -------

function startHub() {
  return new Promise((resolve, reject) => {
    const candidate = new WebSocketServer({ host: HOST, port: PORT });
    candidate.on('listening', () => {
      wss = candidate;
      log('Hub: listening on ws://' + HOST + ':' + PORT + ' as "' + AGENT_LABEL + '".');
      resolve(candidate);
    });
    candidate.on('error', (err) => reject(err));
    candidate.on('connection', (socket) => onHubConnection(socket));
  });
}

function onHubConnection(socket) {
  let kind = null;

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }

    // A peer announces itself before anything else; the app sends 'hello'.
    if (msg.type === 'peer-hello') {
      kind = 'peer';
      peers.set(socket, { agentId: msg.agentId, label: msg.label, connectedAt: Date.now() });
      log('Peer agent "' + msg.label + '" connected. ' + peers.size + ' peer(s).');
      socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'peer-welcome', hub: AGENT_LABEL }));
      pushAgents();
      return;
    }

    if (msg.type === 'hello') {
      kind = 'app';
      adoptApp(socket, msg);
      return;
    }

    if (kind === 'peer' && msg.type === 'peer-request') {
      handlePeerRequest(socket, msg);
      return;
    }

    // Otherwise it is the app answering one of our requests.
    const entry = pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    entry.resolve(msg);
  });

  socket.on('close', () => {
    if (kind === 'peer') {
      const info = peers.get(socket);
      peers.delete(socket);
      if (info) {
        // A peer that goes away must not keep the notebook locked.
        if (lock.holder === info.agentId) releaseLock('peer disconnected');
        const w = waiting.indexOf(info.agentId);
        if (w >= 0) waiting.splice(w, 1);
      }
      log('Peer agent disconnected. ' + peers.size + ' peer(s).');
      pushAgents();
      return;
    }
    if (app === socket) {
      app = null;
      appInfo = null;
      // The notebook going away invalidates any lease over it.
      releaseLock('notebook disconnected');
      log('Notebook disconnected.');
    }
  });

  socket.on('error', (err) => log('Socket error:', (err && err.message) || err));
}

function adoptApp(socket, msg) {
  const previous = app;
  // Newest connection wins: a stale or zombie socket must never lock out a
  // notebook the user is actually looking at.
  app = socket;
  appInfo = { appVersion: msg.appVersion, notebook: msg.notebook };
  log('Hello from PowerScroll v' + msg.appVersion + ' -- notebook "' + msg.notebook + '"');

  if (previous && previous !== socket && previous.readyState === previous.OPEN) {
    log('A second notebook connected; displacing the previous one.');
    // Tell the old client to stand down BEFORE closing it. Without this it
    // reconnects on backoff, displaces this new client in turn, and the two
    // trade the slot forever -- commands then land in whichever notebook
    // happens to hold it, which is how writes ended up in the wrong file.
    try {
      previous.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: 'displaced',
          reason: 'Another notebook connected to the agent bridge.',
        }),
      );
    } catch (err) {
      log('Could not notify displaced notebook:', (err && err.message) || err);
    }
    previous.close();
    releaseLock('notebook displaced');
    rejectPending(
      'The notebook this request was sent to was displaced by another connection. Retry.',
    );
  }

  pushAgents();
}

function agentsFrame() {
  const agents = [{ label: AGENT_LABEL, role: 'hub', connectedAt: HUB_CONNECTED_AT }];
  for (const info of peers.values()) {
    agents.push({
      label: info.label,
      role: 'peer',
      connectedAt: info.connectedAt || Date.now(),
    });
  }
  return { v: PROTOCOL_VERSION, type: 'agents', agents };
}

function pushAgents() {
  if (!app || app.readyState !== app.OPEN) return;
  try {
    app.send(JSON.stringify(agentsFrame()));
  } catch (err) {
    log('Could not push agents frame:', (err && err.message) || err);
  }
}

async function handlePeerRequest(socket, msg) {
  const reply = (body) =>
    socket.send(
      JSON.stringify(Object.assign(
        { v: PROTOCOL_VERSION, type: 'peer-response', reqId: msg.reqId },
        body,
      )),
    );
  try {
    const result = await runToolAsAgent(msg.cmd, msg.params, msg.agentId, msg.label);
    reply({ ok: true, result: result });
  } catch (err) {
    reply({
      ok: false,
      error: { code: err instanceof Locked ? 'LOCKED' : 'ERROR', message: err.message },
    });
  }
}

// -- Peer mode: forward everything to the hub ----------------

function connectToHub() {
  const socket = new WebSocket('ws://' + HOST + ':' + PORT);
  socket.on('open', () => {
    hub = socket;
    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'peer-hello',
        agentId: AGENT_ID,
        label: AGENT_LABEL,
      }),
    );
    log('Peer: joined the hub on ws://' + HOST + ':' + PORT + ' as "' + AGENT_LABEL + '".');
  });
  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (msg.type !== 'peer-response') return;
    const entry = pending.get(msg.reqId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.reqId);
    entry.resolve(msg);
  });
  socket.on('close', () => {
    hub = null;
    rejectPending('The agent hub went away. Retrying.');
    // The hub process exited, so the port is free again. Whoever gets there
    // first becomes the new hub; everyone else re-joins it. The jitter stops
    // every survivor retrying in lockstep.
    log('Hub connection lost -- re-racing for the port.');
    setTimeout(() => { void start(); }, 250 + Math.floor(Math.random() * 500));
  });
  socket.on('error', () => {
    // The close handler drives the retry; the error carries nothing useful.
  });
}

/** Peer side of a tool call: ask the hub to run it on our behalf. */
function askHub(cmd, params) {
  return new Promise((resolve, reject) => {
    if (!hub || hub.readyState !== hub.OPEN) {
      reject(new BridgeUnavailable('Not connected to the agent hub yet. Retry in a moment.'));
      return;
    }
    const reqId = randomUUID();
    const budget = timeoutFor(cmd, params);
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error('The agent hub did not answer "' + cmd + '" within ' + budget + 'ms'));
    }, budget);
    pending.set(reqId, { resolve: resolve, reject: reject, timer: timer });
    hub.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'peer-request',
        reqId: reqId,
        agentId: AGENT_ID,
        label: AGENT_LABEL,
        cmd: cmd,
        params: params,
      }),
    );
  });
}

async function start() {
  try {
    await startHub();
    mode = 'hub';
    startupError = null;
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      mode = 'peer';
      connectToHub();
      return;
    }
    startupError =
      'Could not start the agent bridge on ' + HOST + ':' + PORT + ': ' +
      ((err && err.message) || err) + '. Set POWERNOTE_BRIDGE_PORT to a free port.';
    log(startupError);
  }
}

class BridgeUnavailable extends Error {}

/**
 * Commands that reach the network need more than the default budget: the
 * update path downloads a ~2.4MB single-file build from GitHub before it can
 * answer, which routinely outlasts 10s on a slow link.
 */
const SLOW_COMMAND_TIMEOUT_MS = Number(
  process.env.POWERNOTE_BRIDGE_SLOW_TIMEOUT_MS || 120_000,
);
const SLOW_COMMANDS = new Set(['check_update', 'run_update', 'save_notebook']);

function timeoutFor(cmd, params) {
  if (cmd === 'board_updates') {
    const wait = Math.min(Math.max(0, Number(params && params.wait_seconds) || 0), 300);
    return wait * 1000 + REQUEST_TIMEOUT_MS + 2000;
  }
  return SLOW_COMMANDS.has(cmd) ? SLOW_COMMAND_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

function callApp(cmd, params) {
  return new Promise((resolve, reject) => {
    if (!app || app.readyState !== app.OPEN) {
      reject(
        new BridgeUnavailable(
          'No PowerScroll notebook is connected. Open your notebook, then turn on ' +
          'Settings → Agent bridge → "Let a local agent write into this notebook".',
        ),
      );
      return;
    }

    const id = randomUUID();
    const budget = timeoutFor(cmd, params);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Notebook did not respond to "${cmd}" within ${budget}ms`));
    }, budget);

    pending.set(id, { resolve, reject, timer });
    app.send(JSON.stringify({ v: PROTOCOL_VERSION, id, cmd, params }));
  });
}

// ── MCP tools ───────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_pages',
    description:
      'List every section and page in the connected notebook, with the number of ' +
      'text blocks on each and which page is currently open. Call this first to ' +
      'discover page ids.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_page',
    description:
      'Read a page. DEFAULT CHANGED in v0.54: blocks[] is free-standing markdown ' +
      'only — diagram labels (text nodes with a groupId) no longer leak in as fake ' +
      'content, and diagrams are collapsed to diagrams[] {id, title, format, ' +
      'memberCount, bounds} with NO members and NO source. Images are a compact ' +
      'images[] index {id, alt, x, y, w, h, naturalWidth, naturalHeight, bytes, mini, scrollId} ' +
      '— never the base64 payload. Discovery flow: read_page → diagrams[].id → ' +
      'read_diagram / delete_diagram / fit_diagram; read_page → images[].id → ' +
      'read_image (writes a local file you open with vision). ' +
      'include defaults to ["blocks","diagrams","images"]; pass ["images"] for an ' +
      'images-only fetch or ["diagrams"] for diagrams-only. Optional scrollId filters ' +
      'all three lists. limit + cursor page blocks in column-major reading order ' +
      '(cursor = last block id from the previous page; stable across appends). ' +
      'Serialized reads are hard-capped at 20000 characters and never fail for size: ' +
      'blocks drop first (truncated {at, notice}), then per-diagram source is replaced ' +
      'with sourceOmitted {length, notice: "use read_diagram"}, then diagrams[] trims ' +
      'at an entry boundary, then images[] trims (imagesTruncated {at, notice}). A ' +
      'single oversized block has its markdown cut (markdownTruncated {fullLength, notice}). ' +
      'include_diagram_source:true adds source on each diagrams[] entry. Use ' +
      'get_block(blockId) to re-fetch one block after a cap.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'Page to read. Defaults to the page currently open in the app.',
        },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['blocks', 'diagrams', 'images', 'strokes-summary'] },
          description:
            'Which collections to return. Default ["blocks","diagrams","images"]. ' +
            '"images" alone is the images-only fetch; "diagrams" alone is diagrams-only.',
        },
        scrollId: {
          type: 'string',
          description: 'Restrict blocks, diagrams and images to this scroll band.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          description: 'Max blocks to return (after filters). Combine with cursor to page.',
        },
        cursor: {
          type: 'string',
          description:
            'Block id to start AFTER. Pass the last blockId (or nextCursor) from the ' +
            'previous read_page. Stable across appends.',
        },
        include_diagram_source: {
          type: 'boolean',
          description:
            'If true, each diagrams[] entry includes its source text. Default false.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'read_diagram',
    description:
      'Read one diagram: id, title, format, source, bounds, memberCount, and a page of ' +
      'members [{id, type, x, y, w, h, label?}]. member_limit + member_cursor page members ' +
      '(cursor = last member id; same style as read_page). Default member_limit is derived ' +
      'from the 20000-character budget so a typical page sits well under it. If the ' +
      'serialized response still exceeds the budget, members trim at an entry boundary ' +
      '(truncated {at, notice}). Source counts toward the budget; if source alone blows ' +
      'it, source is cut (sourceTruncated {fullLength, notice}) and the notice names the ' +
      'full length and suggests exporting as .drawio. Discover ids from read_page ' +
      'diagrams[]. An unknown id is NOT_FOUND. A non-diagram id is UNSUPPORTED naming the type. ' +
      "A draw.io diagram rendered as an exact snapshot (renderMode 'snapshot', v0.64+) " +
      'returns members: [] and memberCount 0 BY DESIGN — its structure lives entirely in ' +
      'the source XML, which is what you read and edit.',
    inputSchema: {
      type: 'object',
      properties: {
        diagramId: {
          type: 'string',
          description: 'Diagram frame id from read_page diagrams[].id or create_diagram.',
        },
        member_limit: {
          type: 'integer',
          minimum: 1,
          description:
            'Max members to return. Default is derived from the 20000-character budget.',
        },
        member_cursor: {
          type: 'string',
          description:
            'Member id to start AFTER. Pass the last member id (or nextCursor) from the ' +
            'previous read_diagram.',
        },
      },
      required: ['diagramId'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_image',
    description:
      'Export one image by node id so you can look at it. Discovers ids from ' +
      'read_page images[].id. The notebook returns the embedded bytes over the ' +
      'bridge; this server decodes them and writes a local file. Optional out_path ' +
      '(absolute) names the destination — parent dirs are created; an existing file ' +
      'is overwritten. When omitted, the file lands in os.tmpdir()/powerscroll-images/' +
      '<id>.<ext>. The response is {path, format, bytes, naturalWidth, naturalHeight, alt} ' +
      '— NEVER the base64 payload. Unknown id is NOT_FOUND. A non-image id is ' +
      'UNSUPPORTED naming the type. Then open the file with your vision tools.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Image node id from read_page images[].id.',
        },
        out_path: {
          type: 'string',
          description:
            'Absolute file path to write. Parent directory is created if missing. ' +
            'Omit to write os.tmpdir()/powerscroll-images/<id>.<ext>.',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_block',
    description:
      'Re-fetch a single markdown block by id (BlockSummary plus page location). ' +
      'Use this after read_page hits the size cap. A block larger than the 20000-character ' +
      'budget is returned in slices: the response carries markdownTruncated {fullLength, notice} ' +
      'and nextOffset — pass nextOffset back as offset to continue. Any block, any size, is ' +
      'fully readable in bounded calls. Unknown or non-block ids are NOT_FOUND.',
    inputSchema: {
      type: 'object',
      properties: {
        blockId: { type: 'string', description: 'Block id from read_page.' },
        offset: {
          type: 'number',
          description:
            "Character offset into the block markdown (from a previous response's nextOffset). Omit to start at 0.",
        },
      },
      required: ['blockId'],
      additionalProperties: false,
    },
  },
  {
    name: 'fit_diagram',
    description:
      'Refit an existing diagram to the scroll band its frame sits in. Unlike ' +
      'placement-time fit (shrink-only), this scales BOTH directions: up to fill ' +
      'band-width minus padding when the diagram is under-width, down with the same ' +
      '0.45 floor when over. Works on member diagrams (members rescale) and on ' +
      "renderMode 'snapshot' diagrams (the frame rescales; the image follows). " +
      'Out-of-band frames are refused (PRECONDITION, naming the ' +
      'diagram). Discover ids from read_page diagrams[]. One undo in the app.',
    inputSchema: {
      type: 'object',
      properties: {
        diagramId: {
          type: 'string',
          description: 'Diagram frame id from read_page diagrams[].id.',
        },
      },
      required: ['diagramId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_section',
    description:
      'Create a new section (a tab in the notebook sidebar). Sections contain pages. ' +
      'A first empty page is created along with it.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', description: 'Section title.' } },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_page',
    description:
      'Create a new page and open it. By default also writes the title onto the ' +
      'canvas as an H1 block so the page reads as a titled note.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Page title.' },
        sectionId: {
          type: 'string',
          description: 'Section to create the page in. Defaults to the active section.',
        },
        withHeading: {
          type: 'boolean',
          description: 'Write an "# Title" block onto the canvas too. Default true.',
        },
        column: {
          type: 'integer',
          minimum: 0,
          description:
            'A4 page guide to place the heading in: 0 is the leftmost (default).',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'append_block',
    description:
      'Append a markdown block to the bottom of a page. This is the main way to ' +
      'write content. The markdown is rendered live in the app: use "- " for ' +
      'bullets, "1. " for numbered lists, "- [ ] " for checkboxes (which the user ' +
      'can then click to tick), "#"/"##" for headings, **bold**, `code`, tables, ' +
      'and $math$. Prefer one block per logical chunk (one list, one paragraph) ' +
      'rather than one block per line.',
    inputSchema: {
      type: 'object',
      properties: {
        markdown: { type: 'string', description: 'Markdown content for the block.' },
        pageId: {
          type: 'string',
          description: 'Page to append to. Defaults to the page currently open.',
        },
        scrollId: {
          type: 'string',
          description:
            'Scroll (named column) to write into. THIS IS THE PREFERRED WAY to choose ' +
            'where a block lands — call list_scrolls first and pass an id from it. ' +
            'Each scroll stacks independently, so two workstreams can fill different ' +
            'scrolls on one page without ever interleaving. Defaults to the leftmost.',
        },
        column: {
          type: 'integer',
          minimum: 0,
          description:
            'Raw A4 page-guide index: 0 is the leftmost, 1 the guide to its right. ' +
            'Legacy fallback — prefer scrollId, which keeps pointing at the same ' +
            'scroll after scrolls are reordered. Ignored when scrollId is given.',
        },
      },
      required: ['markdown'],
      additionalProperties: false,
    },
  },
  {
    name: 'insert_block',
    description:
      'Insert a markdown block into a scroll at a chosen position, shifting ' +
      'every occupant below it (text, diagram frames, images, shapes, ungrouped ' +
      'ink) down by the new block\'s height + 12px. Frame members ride the frame. ' +
      'Prefer after (a block or diagram-frame id): ids survive reordering, indices ' +
      'do not. Exactly one of after or index. index 0 is the top of the column ' +
      '(ceiling-clamped when a titled scroll arms the page ceiling). index counts ' +
      'packed occupants of the scroll, not read_page blocks[] — prefer after. ' +
      'Returns the new block plus displacedCount.',
    inputSchema: {
      type: 'object',
      properties: {
        scrollId: {
          type: 'string',
          description: 'Scroll to insert into (from list_scrolls). Required.',
        },
        markdown: { type: 'string', description: 'Markdown content for the block.' },
        after: {
          type: 'string',
          description:
            'Insert after this occupant id (a markdown block or diagram frame in the same scroll). ' +
            'Preferred. Do not pass index at the same time.',
        },
        index: {
          type: 'integer',
          minimum: 0,
          description:
            '0-based index in the scroll\'s packed-occupant reading order (text and diagrams). 0 = column top. ' +
            'Do not pass after at the same time. Prefer after: index is not read_page blocks[] order.',
        },
      },
      required: ['scrollId', 'markdown'],
      additionalProperties: false,
    },
  },
  {
    name: 'insert_image',
    description:
      'Insert an image into a scroll at a chosen position, shifting every occupant ' +
      'below it (text, diagram frames, images, shapes, ungrouped ink) down by the ' +
      'image\'s display height + 12px. Frame members ride the frame. Source is ' +
      'exactly one of data (a data:image/...;base64, URI) or path (a local png/jpg/' +
      'jpeg/gif/webp file this server reads and encodes — the app never sees paths). ' +
      'Both or neither is an error. Placement matches insert_block: prefer after (an ' +
      'occupant id); exactly one of after or index. index 0 is the column top ' +
      '(ceiling-clamped when a titled scroll arms the page ceiling). Optional alt ' +
      '(defaults to "image") and mini (land as a 160px-wide thumbnail). Oversized ' +
      'images are downscaled to a 2048px long edge like UI imports. Returns id + ' +
      'display and natural dims + displacedCount — never the base64 payload. One undo.',
    inputSchema: {
      type: 'object',
      properties: {
        scrollId: {
          type: 'string',
          description: 'Scroll to insert into (from list_scrolls). Required.',
        },
        data: {
          type: 'string',
          description:
            'Base64 data URI (data:image/...;base64,...). Exactly one of data or path.',
        },
        path: {
          type: 'string',
          description:
            'Local file path (png, jpg, jpeg, gif, or webp). This server reads and ' +
            'encodes it; the app never sees the path. Exactly one of data or path.',
        },
        after: {
          type: 'string',
          description:
            'Insert after this occupant id (a markdown block or diagram frame in the same scroll). ' +
            'Preferred. Do not pass index at the same time.',
        },
        index: {
          type: 'integer',
          minimum: 0,
          description:
            '0-based index in the scroll\'s packed-occupant reading order. 0 = column top. ' +
            'Do not pass after at the same time. Prefer after.',
        },
        alt: {
          type: 'string',
          description: 'Alt text. Defaults to "image".',
        },
        mini: {
          type: 'boolean',
          description:
            'If true, land as a Mini thumbnail (default width 160). Displacement uses the mini height.',
        },
      },
      required: ['scrollId'],
      additionalProperties: false,
    },
  },
  {
    name: 'move_block',
    description:
      'Move a markdown block or diagram frame inside a scroll or across scrolls ' +
      'on the same page. Occupants below the source close up; occupants at the ' +
      'target open a gap. Diagram members ride the frame. ONE undo. Prefer after ' +
      '(a block or diagram-frame id) over index: ids survive reordering. scrollId ' +
      'is optional and defaults to the block\'s current scroll; when given it must ' +
      'be on the same page. Exactly one of after or index. Diagram members, shapes ' +
      'and images as the move target are refused by name. Returns the block plus ' +
      'displacedCount.',
    inputSchema: {
      type: 'object',
      properties: {
        blockId: { type: 'string', description: 'Markdown block or diagram frame to move (from read_page / diagrams[].id).' },
        scrollId: {
          type: 'string',
          description:
            'Destination scroll. Omit to stay in the current scroll. Must be on the same page.',
        },
        after: {
          type: 'string',
          description:
            'Place after this block id in the destination scroll. Preferred. ' +
            'Do not pass index at the same time.',
        },
        index: {
          type: 'integer',
          minimum: 0,
          description:
            '0-based index in the destination scroll\'s remaining content blocks. ' +
            'Do not pass after at the same time.',
        },
      },
      required: ['blockId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_diagram_plantuml',
    description:
      'Draw a UML diagram on the page from PLANTUML source. (For Mermaid source, use ' +
      'create_diagram_mermaid instead - this tool refuses it rather than half-drawing it.) ' +
      'Two PlantUML dialects are supported, and the right one is detected automatically. ' +
      '(1) COMPONENT / COMPOSITE STRUCTURE: components, nested components, ports ' +
      '(port / portin / portout), provided and required interfaces, and assembly and ' +
      'delegation connectors. A composite-structure part puts its role in the label, as ' +
      'component "role : Type [multiplicity]" as alias. Nesting uses braces. ' +
      '(2) ACTIVITY / SWIMLANE FLOWCHARTS: |Lane| switches the swimlane, start and stop ' +
      'are the pseudostates, :action; is a step, and if (cond) then (label) / else ' +
      '(label) / endif adds a decision with guards on the arrows. Steps run top to bottom ' +
      'in source order and the lane fixes the column. ' +
      'What lands on the canvas is ordinary PowerScroll shapes and text inside a diagram ' +
      'frame, so the user can drag any part of it afterwards - this is NOT an image. ' +
      'Supply semantics only: name the steps or entities and what connects to what. Every ' +
      'coordinate is computed here from real text metrics, and there is no way to position ' +
      'anything yourself. Do NOT include skinparam, !include, !theme or any styling - ' +
      'PowerScroll supplies the style and those lines come back as skipped diagnostics. ' +
      'fork, split, while and repeat are refused rather than drawn wrong, and activity ' +
      'branches currently render in source order rather than as parallel paths that rejoin. ' +
      'The response carries the diagnostics, so one call is enough to know whether it came out right.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'PlantUML text; @startuml/@enduml optional, one statement per line. ' +
            'Component example: component "gateway" as gw { portin telemetry ... }. ' +
            'Swimlane example: |Sensor| then start then :sample burst; then |Gateway| ' +
            'then :buffer to flash; then stop.',
        },
        title: {
          type: 'string',
          description: 'Title shown on the diagram frame. Defaults to "Diagram".',
        },
        pageId: {
          type: 'string',
          description: 'Page to draw on. Defaults to the page currently open.',
        },
        scrollId: {
          type: 'string',
          description:
            'Scroll (named column) to draw into - call list_scrolls first. The diagram ' +
            'lands below whatever is already in that column, like append_block. Defaults to the leftmost.',
        },
        column: {
          type: 'integer',
          minimum: 0,
          description: 'Raw A4 page-guide index. Legacy fallback - prefer scrollId. Ignored when scrollId is given.',
        },
      },
      required: ['source'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_diagram_mermaid',
    description:
      'Draw a diagram on the page from MERMAID source. (For PlantUML source, use ' +
      'create_diagram_plantuml instead.) A DOCUMENTED SUBSET is read, and anything ' +
      'outside it comes back as a diagnostic instead of being drawn wrong. ' +
      '(1) FLOWCHART: "flowchart TD" / "flowchart LR" / "graph LR" as the first line, then ' +
      'nodes A[Label], A(Label) and A{Label}, and edges A --> B, A -->|guard| B and ' +
      'A --- B. Chains such as A --> B --> C work. ' +
      '(2) SEQUENCE: "sequenceDiagram" as the first line, then participant X (optionally ' +
      '"participant X as Label") and messages A->>B: text and A-->>B: reply. ' +
      'TWO THINGS TO EXPECT. Node SHAPE is carried as a stereotype above the name, not as ' +
      'geometry: a {decision} renders as a box labelled "decision" rather than as a diamond, ' +
      'because the shared layout has one box shape. LAYOUT is left to right whatever direction ' +
      'the header names, and a sequence renders as participants side by side with numbered ' +
      'messages between them, not as lifelines running down the page. ' +
      'NOT SUPPORTED, and refused with a diagnostic: subgraphs, dotted (-.->), thick (==>) ' +
      'and circle/cross (--o, --x) links, compound node shapes such as A[[Sub]] or ' +
      'A((Circle)), loop/alt/opt/par/note blocks, and the class, state, ER and Gantt families. ' +
      'What lands on the canvas is ordinary PowerScroll shapes and text inside a diagram frame, ' +
      'so the user can drag any part of it afterwards - this is NOT an image. Supply semantics ' +
      'only; every coordinate is computed here from real text metrics. The response carries ' +
      'the diagnostics, so one call is enough to know whether it came out right.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'Mermaid text. The FIRST line must be flowchart/graph with a direction, or ' +
            'sequenceDiagram. Example: "flowchart LR" then A[Read sensor] --> B{Uplink up?} ' +
            'then B -->|yes| C[Send batch].',
        },
        title: {
          type: 'string',
          description: 'Title shown on the diagram frame. Defaults to "Diagram".',
        },
        pageId: {
          type: 'string',
          description: 'Page to draw on. Defaults to the page currently open.',
        },
        scrollId: {
          type: 'string',
          description:
            'Scroll (named column) to draw into - call list_scrolls first. The diagram ' +
            'lands below whatever is already in that column, like append_block. Defaults to the leftmost.',
        },
        column: {
          type: 'integer',
          minimum: 0,
          description: 'Raw A4 page-guide index. Legacy fallback - prefer scrollId. Ignored when scrollId is given.',
        },
      },
      required: ['source'],
      additionalProperties: false,
    },
  },
  {
    name: 'bridge_status',
    description:
      'Who else is working in this notebook. Several agents may be connected at ' +
      'once but only one may operate at a time, so call this when a tool comes ' +
      'back LOCKED, or before starting a long piece of work. Reports the ' +
      'connected notebook, every connected agent, which one holds the notebook, ' +
      'how long until it frees up, and whether that is you. This tool is never ' +
      'blocked. Note that a free result can go stale immediately -- another agent ' +
      'may take the lock before your next call -- so treat the LOCKED error as the ' +
      'real signal and this as a way to understand it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'create_diagram_svg',
    description:
      'Draw an SVG onto the page as native PowerScroll shapes. Every element becomes an ' +
      'ordinary rectangle, circle, line or text run that the user can select and drag ' +
      'afterwards -- it is transpiled, NOT embedded as an image. ' +
      'THIS TOOL IS THE OPPOSITE OF THE OTHER TWO: create_diagram_plantuml and ' +
      'create_diagram_mermaid want semantics and compute every coordinate for you, ' +
      'whereas here YOU have already done the layout and the coordinates are the ' +
      'payload. Use this when you want exact placement, and one of the others when you ' +
      'want a diagram laid out well without doing the geometry yourself. ' +
      'Supported: svg (viewBox and width/height set a uniform scale), g with translate ' +
      'and uniform scale, rect (incl. rx), circle, ellipse, line, polyline, polygon, ' +
      'and text with tspan and text-anchor. Paint via fill, stroke, stroke-width, ' +
      'stroke-dasharray and font-*, read from attributes or a style attribute and ' +
      'inherited down the tree. ' +
      'REFUSED, each with a diagnostic naming it: path (a bezier has no native node, ' +
      'and flattening it to line segments is a lie that survives every later edit), ' +
      'gradients, patterns, filters, masks, clipPath, use, symbol, image, ' +
      'foreignObject, textPath, style, script, animation and nested svg. rotate() ' +
      'transforms are refused too, because the native rotation turns about an ' +
      'element\'s own corner rather than the user-space origin, so honouring it would ' +
      'move your drawing. Keep to the supported subset and nothing is silently lost. ' +
      'The response carries the diagnostics, so one call tells you what was dropped.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'SVG markup. A root <svg> with a viewBox is best -- it fixes the scale and ' +
            'the corner lands where the diagram is placed.',
        },
        title: {
          type: 'string',
          description: 'Title shown on the diagram frame. Defaults to "Diagram".',
        },
        pageId: {
          type: 'string',
          description: 'Page to draw on. Defaults to the page currently open.',
        },
        scrollId: {
          type: 'string',
          description:
            'Scroll (named column) to draw into - call list_scrolls first. Lands below ' +
            'whatever is already in that column. Defaults to the leftmost.',
        },
        column: {
          type: 'integer',
          minimum: 0,
          description: 'Raw A4 page-guide index. Legacy fallback - prefer scrollId.',
        },
      },
      required: ['source'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_diagram_drawio',
    description:
      'Draw a draw.io / mxGraph diagram onto the page. BY DEFAULT (v0.64+) the source is ' +
      'rendered by the embedded draw.io viewer into an exact vector snapshot — colours, ' +
      'gradients, curved edges, double-headed arrows, HTML labels, shadows and every ' +
      'built-in shape render exactly as diagrams.net shows them. The response then carries ' +
      "renderMode 'snapshot' and elementCount 0: a snapshot diagram has NO member nodes BY " +
      'DESIGN — the stored XML remains the editable source, read_diagram returns it, and ' +
      '"Export as .drawio" emits it verbatim. Library stencil ICONS (mxgraph.aws4/mscae/' +
      'cisco) are the one gap: they render as their styled box + label, since stencil packs ' +
      'are not bundled. If the viewer extension is unavailable (e.g. offline before it was ' +
      'installed), the tool FALLS BACK to transpiling the source into native PowerScroll ' +
      "shapes and says so in warnings. Pass render:'nodes' to force that transpile path " +
      'deliberately, when you WANT individually-selectable member nodes instead of exact ' +
      'paint. Everything below documents the transpiled subset — it applies to ' +
      "render:'nodes' and to the fallback, NOT to snapshots. " +
      'THIS TOOL IS A SIBLING OF create_diagram_svg: YOU have already done the layout and the ' +
      'coordinates are the payload. Use create_diagram_plantuml or create_diagram_mermaid when ' +
      'you want a diagram laid out well without doing the geometry yourself. ' +
      'Supported vertices: default and rounded rectangles, ellipses, rhombi (as a 45° rect ' +
      'fitted to the cell), triangles, labels, standalone text cells, and flattened groups / ' +
      'containers / swimlanes. Paint via fillColor, strokeColor, strokeWidth, dashed=1 and ' +
      'dashPattern. rotation on a rectangle is honoured. ' +
      'Supported vertices also include UML module/component (rectangle with two left tabs), ' +
      'ports (small rectangles, including relative geometry + mxPoint offset so they sit on ' +
      'the parent edge), and box-like mxgraph.uml / mxgraph.basic library shapes (drawn as ' +
      'rectangles; an ignored diagnostic names the original stencil). ' +
      'Supported edges: a straight edge with endArrow other than none becomes an arrow ' +
      '(signed direction vector); endArrow=none becomes a line. Connected terminals clip ' +
      'centre-to-centre at each cell\'s bounding box. Orthogonal edges WITH explicit mxPoint ' +
      'waypoints in <Array as="points"> are decomposed into consecutive 2-point segments ' +
      '(all line, last one arrow if arrowheaded). Orthogonal edges WITHOUT waypoints are ' +
      'ROUTED from exitX/entryX (or the box edge) as an L/Z — that is the default draw.io ' +
      'connector, not a refusal. An edge label lands as text at the midpoint of the longest segment. ' +
      'Compressed files (base64+raw-deflate <diagram> payloads) are accepted and normalized ' +
      'to readable XML before transpile; the stored source is always uncompressed. ' +
      'REFUSED, each with a diagnostic naming it: ' +
      'curved=1 is refused — the canvas has no bezier primitive, and a straightened curve misstates the drawing; ' +
      'startArrow other than none/classic/block/open is refused — PowerScroll arrows have one head, at the end of the segment, and this start head has no canvas equivalent; ' +
      'startArrow=classic with an end head is refused — the canvas has no double-headed primitive, and dropping one head would misstate the drawing; ' +
      'custom stencils (mscae/aws/cisco image libraries) are little rendering programs this transpiler does not run; UML module/component/port and box-like mxgraph.uml/basic shapes ARE drawn (as rectangles / tabbed modules); ' +
      'image= is refused — an embedded raster is not a canvas node. Import the picture as an image block instead; ' +
      'gradientColor is refused — a shape node carries one flat fill, and picking a stop colour would misrepresent the drawing; ' +
      'rotation on a non-rectangle is refused — circle/triangle Konva components ignore rotation, and silently dropping it would misplace the drawing; ' +
      'sketch=1 is refused — rough/hand-drawn rendering has no canvas equivalent, and a clean shape would not be what was drawn; ' +
      'A nested <mxGraphModel> is refused — it opens a second graph with its own origin, and flattening it would move everything inside; ' +
      'HTML labels: simple <br>/<div>/<font>/<b> markup is stripped and the words are kept (ignored diagnostic); remaining empty markup is refused. ' +
      'Keep to the supported subset and nothing is silently lost. The response carries the ' +
      'diagnostics, so one call tells you what was dropped. (Snapshot renders have none of ' +
      'these restrictions.)',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'draw.io / mxGraph XML. An <mxfile> or a bare <mxGraphModel>. Compressed ' +
            '(base64+deflate) pages are accepted — they are inflated before use.',
        },
        render: {
          type: 'string',
          enum: ['snapshot', 'nodes'],
          description:
            "How to draw it. 'snapshot' (default): exact image via the draw.io viewer. " +
            "'nodes': transpile into native, individually-editable shapes (lossy — see the " +
            'subset above).',
        },
        title: {
          type: 'string',
          description: 'Title shown on the diagram frame. Defaults to "Diagram".',
        },
        pageId: {
          type: 'string',
          description: 'Page to draw on. Defaults to the page currently open.',
        },
        scrollId: {
          type: 'string',
          description:
            'Scroll (named column) to draw into - call list_scrolls first. Lands below ' +
            'whatever is already in that column. Defaults to the leftmost.',
        },
        column: {
          type: 'integer',
          minimum: 0,
          description: 'Raw A4 page-guide index. Legacy fallback - prefer scrollId.',
        },
      },
      required: ['source'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_diagram',
    description:
      'DEPRECATED - use create_diagram_plantuml, create_diagram_mermaid, ' +
      'create_diagram_svg or create_diagram_drawio instead, which name the language they take and each ' +
      'document their own subset. This name still works and sniffs the format from ' +
      'the source, but it will be removed. Behaviour is otherwise identical.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Diagram source. The format is sniffed.' },
        title: { type: 'string', description: 'Title shown on the diagram frame.' },
        pageId: { type: 'string', description: 'Page to draw on. Defaults to the open page.' },
        scrollId: { type: 'string', description: 'Scroll to draw into. Defaults to the leftmost.' },
        column: { type: 'integer', minimum: 0, description: 'Legacy fallback - prefer scrollId.' },
        render: {
          type: 'string',
          enum: ['snapshot', 'nodes'],
          description:
            "draw.io sources only: 'snapshot' (default) renders an exact image; 'nodes' " +
            'transpiles to native shapes.',
        },
      },
      required: ['source'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_scrolls',
    description:
      'List the scrolls (named vertical columns) on a page, with how many blocks ' +
      'each holds. Call this before writing when a page may have more than one ' +
      'workstream on it: passing the returned scrollId to append_block keeps your ' +
      'blocks in their own column instead of stacking under someone else\'s. ' +
      'A block belongs to whichever scroll it physically sits in, so a block the ' +
      'user drags to another scroll moves with it.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'Page to inspect. Defaults to the page currently open.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_scroll',
    description:
      'Create a new named scroll on a page — a fresh vertical column to the right ' +
      'of the existing ones, with its title shown at the top on the canvas. Use ' +
      'this to keep a separate workstream (say "Open questions" beside "Research ' +
      'log") from interleaving with what is already there. Returns a scrollId to ' +
      'pass to append_block.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title shown at the top of the scroll.' },
        pageId: {
          type: 'string',
          description: 'Page to add the scroll to. Defaults to the page currently open.',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'rename_scroll',
    description:
      'Rename a scroll. The new title appears immediately at the top of that ' +
      'column on the canvas. Naming a previously untitled scroll is how its ' +
      'header first appears. Pass an empty title to untitle it: the header ' +
      'disappears and the page ceiling disarms — a plain page is one untitled ' +
      'scroll, not zero scrolls.',
    inputSchema: {
      type: 'object',
      properties: {
        scrollId: { type: 'string', description: 'Scroll to rename (from list_scrolls).' },
        title: {
          type: 'string',
          description:
            'New title. Empty string untitleds the scroll (header gone, ceiling off).',
        },
      },
      required: ['scrollId', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'move_scroll',
    description:
      'Move a scroll (named column band) left or right, or to an absolute column. ' +
      'Members, grouped ink and the band\'s own width travel with it; neighbouring ' +
      'scrolls shift to make room and cumulative offsets are recomputed. A diagram ' +
      'belongs to the band of its frame origin — the whole group moves, it is never ' +
      'split. Refuses with NOT_FOUND on an unknown id and PRECONDITION when the ' +
      'scroll is already at the named edge.',
    inputSchema: {
      type: 'object',
      properties: {
        scrollId: { type: 'string', description: 'Scroll to move (from list_scrolls).' },
        direction: {
          type: 'string',
          enum: ['left', 'right'],
          description: 'Step one band left or right. Refused at the corresponding edge.',
        },
        toColumn: {
          type: 'integer',
          description:
            'Absolute 0-based column to move to. Refused when already there or past an edge.',
        },
      },
      required: ['scrollId'],
      additionalProperties: false,
    },
  },
  {
    name: 'resize_scroll',
    description:
      'Resize a scroll band by stable id. The width is clamped to PowerScroll\'s shared ' +
      'limits, persists on that page, and every node or stroke in bands to the right ' +
      'moves by the same delta. The resized band\'s own content stays fixed. One undo ' +
      'restores width and positions. list_scrolls reports the effective width.',
    inputSchema: {
      type: 'object',
      properties: {
        scrollId: { type: 'string', description: 'Scroll to resize (from list_scrolls).' },
        width: {
          type: 'number',
          description: 'Requested band width in canvas pixels; clamped by the app.',
        },
      },
      required: ['scrollId', 'width'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_block',
    description:
      'Replace the markdown of an existing block, found via read_page. Use this to ' +
      'revise content or tick a checkbox ("- [ ]" to "- [x]") rather than appending ' +
      'a duplicate block. If the block grows or shrinks, every occupant below it in ' +
      'the scroll (text, diagram frames, images, shapes, ungrouped ink) shifts by the ' +
      'height delta; frame members ride the frame. One undo. Returns displacedCount. ' +
      'A diagram-member id is refused (UNSUPPORTED) naming the owning diagram — redraw ' +
      'the source instead.',
    inputSchema: {
      type: 'object',
      properties: {
        blockId: { type: 'string', description: 'Block id from read_page.' },
        markdown: { type: 'string', description: 'New markdown content.' },
      },
      required: ['blockId', 'markdown'],
      additionalProperties: false,
    },
  },
  {
    name: 'rename_page',
    description:
      'Retitle a page in the sidebar. If the page still opens with the "# Old title" ' +
      'heading block that create_page wrote, that block is retitled too so the two ' +
      'do not drift apart; a hand-edited heading is left alone.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'New page title.' },
        pageId: {
          type: 'string',
          description: 'Page to rename. Defaults to the page currently open.',
        },
        updateHeading: {
          type: 'boolean',
          description: 'Also rewrite the matching canvas H1. Default true.',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'move_page',
    description:
      'Move a page into a different section. Section ids come from list_pages. ' +
      'A section must keep at least one page, so moving the only page out of a ' +
      'section is refused — create another page there first.',
    inputSchema: {
      type: 'object',
      properties: {
        toSectionId: { type: 'string', description: 'Destination section id.' },
        pageId: {
          type: 'string',
          description: 'Page to move. Defaults to the page currently open.',
        },
        toIndex: {
          type: 'integer',
          minimum: 0,
          description:
            'Position within the destination section. Defaults to last.',
        },
      },
      required: ['toSectionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'rename_notebook',
    description:
      'Rename the notebook itself (the title shown in the app and used for future ' +
      'Save As filenames). This does NOT rename the .html file already on disk — ' +
      'that keeps its current name until the user saves to a new location. The ' +
      'result reports the bound filename so you can tell them.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'New notebook name.' },
      },
      required: ['filename'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_page',
    description:
      'Delete a page and everything on it. Cannot be undone from here — the app ' +
      'has no agent-facing undo — so ask the user before calling, then pass ' +
      'confirm:true. Refuses when the page is the last one in its section.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'Page to delete. Defaults to the page currently open.',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true. Confirms the user agreed to the deletion.',
        },
      },
      required: ['confirm'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_section',
    description:
      'Delete a section AND every page inside it. This is the widest-reaching ' +
      'delete available — confirm the page list with the user first (list_pages ' +
      'shows what would go). Refuses when it is the notebook\'s only section.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionId: { type: 'string', description: 'Section to delete.' },
        confirm: {
          type: 'boolean',
          description: 'Must be true. Confirms the user agreed to the deletion.',
        },
      },
      required: ['sectionId', 'confirm'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_scroll',
    description:
      'Delete a named scroll (a column band). When the band holds ANY content — ' +
      'nodes, group members, or ink — content is REQUIRED: "delete" removes them ' +
      'with the band, "keep" closes the gap and leaves them where they are. There ' +
      'is deliberately no default. The old default was keep (confirm:true used to ' +
      'be a safe trim); a default flip would silently destroy callers that never ' +
      'passed the flag. An empty band needs no content param. Membership is ' +
      'group-aware: a diagram belongs to the band of its frame origin, and its ' +
      'members and grouped ink follow that verdict. A page must keep at least one ' +
      'scroll: a plain page is one untitled scroll — untitle it instead of deleting ' +
      'the last one.',
    inputSchema: {
      type: 'object',
      properties: {
        scrollId: { type: 'string', description: 'Scroll to delete (from list_scrolls).' },
        content: {
          type: 'string',
          enum: ['delete', 'keep'],
          description:
            'Required when the band is not empty. "delete" removes the band\'s ' +
            'nodes, group members and ink with the scroll. "keep" closes the gap ' +
            'and leaves them. There is no default — the old default was keep, and ' +
            'a default flip is unrecoverable for callers who never passed the flag. ' +
            'An empty band does not need this param.',
        },
        withBlocks: {
          type: 'boolean',
          description:
            'Deprecated alias for content. true = delete, false = keep. Ignored when content is set. The response includes a deprecation notice.',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true. Confirms the user agreed to the deletion.',
        },
      },
      required: ['scrollId', 'confirm'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_block',
    description:
      'Delete a single markdown block by id. Use read_page first to get block ids ' +
      'and check you are removing the right one. Passed a diagram FRAME id, this ' +
      'cascades to the frame\'s members and grouped strokes — same primitive as ' +
      'delete_diagram, which names the act and reports the counts. Passed a diagram ' +
      'MEMBER id (a node whose groupId is owned by a diagram frame), the call is ' +
      'refused (UNSUPPORTED) naming the owning diagram and pointing at delete_diagram ' +
      'or the redraw path.',
    inputSchema: {
      type: 'object',
      properties: {
        blockId: { type: 'string', description: 'Block to delete (from read_page).' },
        confirm: {
          type: 'boolean',
          description: 'Must be true. Confirms the user agreed to the deletion.',
        },
      },
      required: ['blockId', 'confirm'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_diagram',
    description:
      'Delete a diagram frame and everything that belongs to it: every node whose ' +
      'groupId is the frame id, and every stroke grouped with it. Use this when you ' +
      'placed a diagram you no longer want — delete_block on the frame id does the ' +
      'same cascade, but this tool names the act and reports how many members and ' +
      'strokes went. Occupants below the frame in the same scroll close the gap. ' +
      'An unknown id is NOT_FOUND. Passing a non-diagram node id is refused (the ' +
      'message names the type and points at delete_block). The bridge has no undo, ' +
      'so pass confirm:true once the user has agreed. Returns deletedMembers and ' +
      'deletedStrokes.',
    inputSchema: {
      type: 'object',
      properties: {
        diagramId: {
          type: 'string',
          description:
            'Id of the diagram frame (from read_page diagrams[].id or create_diagram).',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true. Confirms the user agreed to the deletion.',
        },
      },
      required: ['diagramId', 'confirm'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_background',
    description:
      'Read the canvas look a page is actually drawn with: which guide style is ' +
      'active and which background colour. A page may override the notebook ' +
      'default, so the reply also carries "source" (whether each value came from ' +
      'the page or the notebook) and "notebookDefault". Call before ' +
      'set_background when you intend to restore the previous look afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'Page to read. Defaults to the active page.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_background',
    description:
      'Change the notebook\'s canvas look. "scroll" renders each column as one ' +
      'continuous vertical sheet with light page separators — best for long ' +
      'reading and for notes an agent is filling in. "pages" shows detached A4 ' +
      'cards, "grid" a dot grid, "none" a blank canvas. The setting is stored in ' +
      'the notebook itself, so it survives closing and reopening. Pass at least ' +
      'one of guideStyle or color.\n\n' +
      'Scope defaults to "notebook" (every page that has not overridden it). Pass ' +
      'scope:"page" to change one page only — useful when a notebook wants a ' +
      'scrolling page of notes next to a grid page of diagrams.',
    inputSchema: {
      type: 'object',
      properties: {
        guideStyle: {
          type: 'string',
          enum: ['pages', 'scroll', 'grid', 'none'],
          description: 'Guide overlay to use.',
        },
        color: {
          type: 'string',
          enum: ['white', 'light-gray', 'gray', 'paper'],
          description: 'Canvas background colour. "paper" is a warm off-white.',
        },
        scope: {
          type: 'string',
          enum: ['notebook', 'page'],
          description:
            'Which layer to write. "notebook" (default) sets the default every ' +
            'page follows unless it overrides it, and leaves existing overrides ' +
            'alone. "page" overrides one page only.',
        },
        pageId: {
          type: 'string',
          description: 'Page to change when scope is "page". Defaults to the active page.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'save_notebook',
    description:
      'Write the notebook back to the file it was opened from. Only works when the ' +
      'notebook is already bound to a file: the Save As picker needs a click from ' +
      'the user, which an agent cannot supply. Call this after a batch of edits so ' +
      'the work is on disk.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'check_update',
    description:
      'Check whether a newer PowerScroll release exists on GitHub. Reports the running ' +
      'version and the latest one. Note "checked": when false the API was unreachable ' +
      'or rate limited and the status is unknown — that is not the same as up to date.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_update',
    description:
      'Install the latest PowerScroll release into the current notebook file. This ' +
      'rewrites the .html on disk and reloads the app, which drops this bridge ' +
      'connection until the notebook reconnects. Ask the user before calling it, ' +
      'then pass confirm:true. A safety backup is downloaded first where the browser ' +
      'allows it. Run check_update first.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true. Confirms the user agreed to the overwrite + reload.',
        },
      },
      required: ['confirm'],
      additionalProperties: false,
    },
  },
  {
    name: 'board_list',
    description:
      'List every board page in the notebook: id, title, section, and card counts per column. ' +
      BOARD_WORKFLOW,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'board_create',
    description:
      'Create a new board page. Does NOT switch the owner\'s active page. ' + BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Board title.' },
        sectionId: {
          type: 'string',
          description: 'Section to create the board in. Defaults to the active section.',
        },
        me: ME_PROP,
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'board_read',
    description:
      'Read cards on a board: number, id, title, column, order, assignee, labels, ' +
      'checklist done/total, question, last note, updatedAt. Filter with column or assignee. ' +
      'Archived cards are omitted unless include_archived is true. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string', description: 'Board page id from board_list.' },
        column: {
          type: 'string',
          enum: ['todo', 'doing', 'waiting', 'done'],
          description: 'If set, only cards in this column.',
        },
        assignee: { type: 'string', description: 'If set, only cards assigned to this name.' },
        include_archived: {
          type: 'boolean',
          description: 'If true, include archived cards. Default false.',
        },
      },
      required: ['boardId'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_create',
    description:
      'Create a card on a board. Returns the card including its number. Default column is todo. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        column: { type: 'string', enum: ['todo', 'doing', 'waiting', 'done'] },
        labels: { type: 'array', items: { type: 'string' } },
        checklist: {
          type: 'array',
          items: { type: 'string' },
          description: 'Checklist item titles, all unchecked.',
        },
        me: ME_PROP,
      },
      required: ['boardId', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_get',
    description:
      'Read one card in full, including notes, checklist and history events. ' +
      '`card` accepts the id or the number (15 or "#15"). ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
      },
      required: ['boardId', 'card'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_update',
    description: 'Update a card title, description or labels. ' + BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        title: { type: 'string' },
        description: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        me: ME_PROP,
      },
      required: ['boardId', 'card'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_claim',
    description: 'Assign the card to me. ' + BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        me: ME_PROP,
      },
      required: ['boardId', 'card'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_release',
    description: 'Clear the card assignee. ' + BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        me: ME_PROP,
      },
      required: ['boardId', 'card'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_move',
    description:
      'Move a card to todo, doing, waiting or done. `question` is required when moving to waiting. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        to: { type: 'string', enum: ['todo', 'doing', 'waiting', 'done'] },
        position: { type: 'integer', minimum: 0, description: 'Index in the destination column.' },
        question: {
          type: 'string',
          description: 'Required when `to` is waiting. Shown to the owner.',
        },
        me: ME_PROP,
      },
      required: ['boardId', 'card', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_note',
    description: 'Add a signed note on a card. ' + BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        text: { type: 'string' },
        me: ME_PROP,
      },
      required: ['boardId', 'card', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_check',
    description:
      'Tick or untick a checklist item. `item` is the item id or a 1-based index. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        item: { description: 'Checklist item id or 1-based index.' },
        done: { type: 'boolean' },
        me: ME_PROP,
      },
      required: ['boardId', 'card', 'item', 'done'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_checklist_add',
    description: 'Append a checklist item to a card. ' + BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        text: { type: 'string' },
        me: ME_PROP,
      },
      required: ['boardId', 'card', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_archive',
    description:
      'Archive a card (hide it from columns; it stays in the notebook and can be restored). ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        me: ME_PROP,
      },
      required: ['boardId', 'card'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_restore',
    description:
      'Restore an archived card into its previous column, at the end. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        me: ME_PROP,
      },
      required: ['boardId', 'card'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_status',
    description:
      'Set the one-line status shown in the board agents strip. Naming a card marks you active on it. ' +
      'Does not change the board. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        me: ME_PROP,
        text: { type: 'string', description: 'What you are doing now.' },
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15". Marks you active on that card.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_leave',
    description:
      'Sign off: remove me from the board\'s active agents. Call when you finish or stop working. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        me: ME_PROP,
        boardId: {
          type: 'string',
          description: 'Board to record the leave event on. Defaults to the last board you acted on.',
        },
        note: { type: 'string', description: 'Optional sign-off note stored on the leave event.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'board_updates',
    description:
      'Events with seq > since (omit since to receive only the cursor). ' +
      'mine:true limits to cards assigned to you. If none and wait_seconds > 0, this server ' +
      're-asks the app every 1 s until something arrives or the wait (max 300 s) ends. ' +
      'Returns {events, cursor}. This is how you hear the owner\'s replies and moves. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        since: { type: 'integer', minimum: 0, description: 'Return events with seq greater than this.' },
        mine: { type: 'boolean', description: 'Only events on cards currently assigned to me.' },
        wait_seconds: {
          type: 'integer',
          minimum: 0,
          maximum: 300,
          description: 'Long-poll up to this many seconds (max 300) when there are no events.',
        },
        me: ME_PROP,
      },
      required: ['boardId'],
      additionalProperties: false,
    },
  },
];

/**
 * Tools that are one app command carrying a fixed argument.
 *
 * The TOOL is named for the language, because choosing between languages is the
 * decision a model actually has to make and a name it can read beats a `format`
 * enum it has to remember. The COMMAND is one, because once a source is parsed
 * into a spec the language is nothing but which parser ran.
 */
const TOOL_ROUTES = {
  create_diagram_plantuml: { cmd: 'create_diagram', params: { format: 'plantuml' } },
  create_diagram_mermaid: { cmd: 'create_diagram', params: { format: 'mermaid' } },
  create_diagram_svg: { cmd: 'create_diagram', params: { format: 'svg' } },
  create_diagram_drawio: { cmd: 'create_diagram', params: { format: 'drawio' } },
  // Deprecated alias, kept so anything written against the pre-v0.37 name still
  // works. No `format`, so the grammar is sniffed exactly as it used to be.
  create_diagram: { cmd: 'create_diagram', params: {} },
};

const IMAGE_EXT_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const DATA_IMAGE_URI = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;
const IMAGE_EXTS = 'png, jpg, jpeg, gif, webp';
const READ_IMAGE_URI = /^data:image\/([a-zA-Z0-9.+-]+);base64,([\s\S]*)$/;

function isPresentParam(value) {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Resolve insert_image's XOR of data/path. `path` is read and encoded here so
 * the app only ever receives a data URI.
 */
async function prepareInsertImageParams(params) {
  const hasData = isPresentParam(params.data);
  const hasPath = isPresentParam(params.path);
  if (hasData && hasPath) {
    throw new Error('BAD_PARAMS: Pass data (a base64 data URI) or path, not both.');
  }
  if (!hasData && !hasPath) {
    throw new Error(
      'BAD_PARAMS: insert_image needs exactly one of data (a base64 data URI) or path (a local file).',
    );
  }
  const next = { ...params };
  if (hasPath) {
    if (typeof params.path !== 'string') {
      throw new Error('BAD_PARAMS: "path" must be a string');
    }
    const ext = extname(params.path).toLowerCase();
    const mime = IMAGE_EXT_MIME[ext];
    if (!mime) {
      throw new Error(
        `BAD_PARAMS: path must be a ${IMAGE_EXTS} file (got "${ext || 'no extension'}").`,
      );
    }
    let bytes;
    try {
      bytes = await readFile(params.path);
    } catch (err) {
      throw new Error(
        `BAD_PARAMS: could not read image file "${params.path}": ${err.message}`,
      );
    }
    next.data = `data:${mime};base64,${bytes.toString('base64')}`;
    delete next.path;
    return next;
  }
  if (typeof params.data !== 'string' || !DATA_IMAGE_URI.test(params.data)) {
    throw new Error('BAD_PARAMS: "data" must be a data:image/...;base64, URI');
  }
  return next;
}

function extForImageFormat(format) {
  if (format === 'jpeg' || format === 'jpg') return 'jpg';
  if (format === 'svg+xml') return 'svg';
  const clean = String(format).toLowerCase().replace(/[^a-z0-9]/g, '');
  return clean || 'bin';
}

/**
 * Decode the app's read_image data URI and write a local file. Agent-visible
 * result never includes src.
 */
async function writeReadImageFile(result, params) {
  const src = result && result.src;
  if (typeof src !== 'string') {
    throw new Error('INTERNAL: notebook did not return image bytes');
  }
  const match = READ_IMAGE_URI.exec(src);
  if (!match) {
    throw new Error('INTERNAL: image src is not a base64 data URI');
  }
  const format = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
  const ext = extForImageFormat(format);
  let bytes;
  try {
    bytes = Buffer.from(match[2], 'base64');
  } catch (err) {
    throw new Error('INTERNAL: could not decode image: ' + err.message);
  }
  const id = typeof result.id === 'string' && result.id ? result.id : 'image';
  let outPath = params && params.out_path;
  if (outPath !== undefined && outPath !== null && outPath !== '') {
    if (typeof outPath !== 'string' || !isAbsolute(outPath)) {
      throw new Error('BAD_PARAMS: "out_path" must be an absolute file path');
    }
  } else {
    outPath = join(tmpdir(), 'powerscroll-images', `${id}.${ext}`);
  }
  try {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, bytes);
  } catch (err) {
    throw new Error(`Could not write image to "${outPath}": ${err.message}`);
  }
  return {
    path: outPath,
    format,
    bytes: bytes.length,
    naturalWidth: result.naturalWidth,
    naturalHeight: result.naturalHeight,
    alt: typeof result.alt === 'string' ? result.alt : '',
  };
}

const server = new Server(
  { name: 'powerscroll-mcp', version: '0.69.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

/** Everyone connected right now, from the hub's point of view. */
function connectedAgents() {
  const list = [{ agentId: AGENT_ID, label: AGENT_LABEL, role: 'hub' }];
  for (const info of peers.values()) {
    list.push({ agentId: info.agentId, label: info.label, role: 'peer' });
  }
  return list;
}

/**
 * Runs one tool on behalf of an agent, holding the lease for its duration.
 *
 * Only the hub ever gets here: peers forward to it, so there is exactly one
 * arbiter no matter how many agent processes are running.
 */
function withAgentMe(name, params, label) {
  if (!BOARD_ME_TOOLS.has(name)) return { ...params };
  const next = { ...params };
  if (next.me === undefined || next.me === null || next.me === '') {
    next.me = label;
  }
  if (typeof next.me !== 'string' || !AGENT_NAME_RE.test(next.me)) {
    throw new Error(
      'INVALID: "me" must match ^[a-z0-9][a-z0-9._-]{0,39}$ (powerboard convention)',
    );
  }
  next.actor = next.me;
  return next;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollBoardUpdates(args) {
  const wait = Math.min(Math.max(0, Number(args.wait_seconds) || 0), 300);
  const started = Date.now();
  const params = { ...args };
  delete params.wait_seconds;
  let since = params.since;

  while (true) {
    const response = await callApp('board_updates', { ...params, since });
    const result = unwrap(response);
    if (result && Array.isArray(result.events) && result.events.length > 0) {
      return result;
    }
    if (since === undefined && result && typeof result.cursor === 'number') {
      since = result.cursor;
    }
    if (wait <= 0) return result;
    if (Date.now() - started >= wait * 1000) {
      return result || { events: [], cursor: since ?? 0 };
    }
    await sleep(1000);
  }
}

async function runToolAsAgent(name, params, agentId, label) {
  if (name === 'bridge_status') {
    const st = lockStatus();
    return {
      notebook: appInfo ? appInfo.notebook : null,
      notebookConnected: !!app,
      you: { agentId: agentId, label: label, isHolder: st.holderId === agentId },
      agents: connectedAgents(),
      lock: {
        held: st.held,
        heldBy: st.holder,
        heldByYou: st.holderId === agentId,
        heldForMs: st.heldForMs,
        freesUpInMs: st.retryAfterMs,
        agentsWaiting: st.waiting,
      },
    };
  }

  const route = TOOL_ROUTES[name];
  const cmd = route ? route.cmd : name;
  let args = route ? { ...params, ...route.params } : params;
  args = withAgentMe(name, args ?? {}, label);
  if (name === 'insert_image') {
    args = await prepareInsertImageParams(args);
  }

  // Reads never queue: an agent that cannot look also cannot find out why.
  if (READ_ONLY.has(name)) {
    if (name === 'read_image') {
      const appArgs = { ...args };
      delete appArgs.out_path;
      const response = await callApp(cmd, appArgs);
      return await writeReadImageFile(unwrap(response), args);
    }
    if (name === 'board_updates') {
      return await pollBoardUpdates(args);
    }
    const response = await callApp(cmd, args);
    return unwrap(response);
  }

  const release = acquireLock(agentId, label);
  try {
    const response = await callApp(cmd, args);
    return unwrap(response);
  } finally {
    release();
  }
}

class CommandFailed extends Error {}

function unwrap(response) {
  if (response.ok === false) {
    throw new CommandFailed(
      (response.error && response.error.code) + ': ' + (response.error && response.error.message),
    );
  }
  return response.result;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (!TOOLS.some((t) => t.name === name)) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Unknown tool "${name}"` }],
    };
  }

  if (startupError) {
    return { isError: true, content: [{ type: 'text', text: startupError }] };
  }

  try {
    // Hub runs it directly; a peer asks the hub, so the lease is decided in one
    // place regardless of which process the agent happens to be talking to.
    let result;
    if (mode === 'peer') {
      const response = await askHub(name, args ?? {});
      if (response.ok === false) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: (response.error && response.error.code) + ': ' + (response.error && response.error.message),
            },
          ],
        };
      }
      result = response.result;
    } else {
      result = await runToolAsAgent(name, args ?? {}, AGENT_ID, AGENT_LABEL);
    }

    const payload = { ...result };
    if (appInfo) payload._notebook = appInfo.notebook;
    // Stamp identity on every result: an agent that never learns who it is
    // cannot make sense of a LOCKED message naming someone else.
    payload._agent = { id: AGENT_ID, label: AGENT_LABEL, role: mode };
    return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
  } catch (err) {
    const code = err instanceof Locked ? 'LOCKED: ' : '';
    return { isError: true, content: [{ type: 'text', text: code + err.message }] };
  }
});

// ── Startup / shutdown ──────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Race for the port: winner hosts the notebook connection and the lock,
  // losers become peers of whoever won.
  await start();
  log('MCP server ready on stdio (' + mode + ').');
}

function shutdown() {
  for (const { timer } of pending.values()) clearTimeout(timer);
  pending.clear();
  if (wss) wss.close();
  if (hub) hub.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  log('Fatal:', err?.stack || err);
  process.exit(1);
});
