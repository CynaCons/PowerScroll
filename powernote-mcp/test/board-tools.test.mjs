/**
 * Board MCP tools: schemas, `me` fill/validation, board_updates polling,
 * and the agents presence frame.
 *
 * Run: npm test --prefix powernote-mcp
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';

const PORT = 41824;
const URL = `ws://127.0.0.1:${PORT}`;
const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');

const BOARD_TOOLS = [
  'board_list',
  'board_create',
  'board_read',
  'card_create',
  'card_get',
  'card_update',
  'card_claim',
  'card_release',
  'card_move',
  'card_note',
  'card_check',
  'card_checklist_add',
  'agent_status',
  'board_updates',
];

let proc;

function startServer(extraEnv = {}) {
  const child = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      POWERNOTE_BRIDGE_PORT: String(PORT),
      POWERNOTE_AGENT_NAME: 'feature-1',
      POWERNOTE_BRIDGE_TIMEOUT_MS: '4000',
      ...extraEnv,
    },
  });
  let buffer = '';
  const waiters = new Map();
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = waiters.get(msg.id);
      if (waiter) {
        waiters.delete(msg.id);
        waiter(msg);
      }
    }
  });
  let nextId = 1;
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      waiters.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  return {
    child,
    rpc,
    async ready() {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server did not start')), 10_000);
        child.stderr.on('data', (data) => {
          if (data.toString().includes('listening on')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      await rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'board-tools-test', version: '1' },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      );
    },
    async call(name, args = {}) {
      const res = await rpc('tools/call', { name, arguments: args });
      const text = res?.result?.content?.[0]?.text ?? '';
      return { isError: !!res?.result?.isError, text, raw: res };
    },
    async listTools() {
      const res = await rpc('tools/list', {});
      return res?.result?.tools ?? [];
    },
    stop() {
      child.kill();
    },
  };
}

function connectNotebook(onCommand) {
  const ws = new WebSocket(URL);
  const frames = [];
  const control = [];
  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        v: 1,
        type: 'hello',
        app: 'powernote',
        appVersion: 'test',
        notebook: 'Board.html',
      }),
    );
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type) {
      control.push(msg);
      return;
    }
    if (!msg.cmd) return;
    frames.push(msg);
    const result = onCommand ? onCommand(msg, frames.length) : { ran: msg.cmd };
    ws.send(JSON.stringify({ v: 1, id: msg.id, ok: true, result }));
  });
  return {
    ws,
    frames,
    control,
    close: () => ws.close(),
  };
}

function waitUntil(fn, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const value = fn();
        if (value) return resolve(value);
      } catch {
        // keep waiting
      }
      if (Date.now() - started > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

before(async () => {
  proc = startServer();
  await proc.ready();
});

after(() => {
  proc?.stop();
});

test('board tools are offered and teach the workflow', async () => {
  const tools = await proc.listTools();
  const names = tools.map((tool) => tool.name);
  for (const name of BOARD_TOOLS) {
    assert.ok(names.includes(name), `missing tool ${name}`);
  }
  const read = tools.find((tool) => tool.name === 'board_read');
  assert.match(read.description, /card_claim/);
  assert.match(read.description, /wait_seconds/);
  const updates = tools.find((tool) => tool.name === 'board_updates');
  assert.equal(updates.inputSchema.properties.me.type, 'string');
});

test('connecting the app receives an agents frame naming the hub', async () => {
  const notebook = connectNotebook();
  const frame = await waitUntil(() => notebook.control.find((item) => item.type === 'agents'));
  assert.equal(frame.type, 'agents');
  assert.ok(frame.agents.some((agent) => agent.label === 'feature-1' && agent.role === 'hub'));
  notebook.close();
});

test('omitted me is filled from POWERNOTE_AGENT_NAME and sent as actor', async () => {
  const notebook = connectNotebook();
  await waitUntil(() => notebook.control.some((item) => item.type === 'agents'));
  const result = await proc.call('card_create', { boardId: 'board-1', title: 'Task' });
  assert.equal(result.isError, false, result.text);
  const frame = notebook.frames.find((item) => item.cmd === 'card_create');
  assert.ok(frame, 'card_create did not reach the notebook');
  assert.equal(frame.params.me, 'feature-1');
  assert.equal(frame.params.actor, 'feature-1');
  notebook.close();
});

test('invalid me is INVALID and never reaches the notebook', async () => {
  const notebook = connectNotebook();
  await waitUntil(() => notebook.control.some((item) => item.type === 'agents'));
  const result = await proc.call('card_create', {
    boardId: 'board-1',
    title: 'Bad',
    me: 'Feature One',
  });
  assert.equal(result.isError, true);
  assert.match(result.text, /INVALID/);
  assert.equal(
    notebook.frames.some((item) => item.cmd === 'card_create'),
    false,
  );
  notebook.close();
});

test('board_updates long-polls until events arrive', async () => {
  let polls = 0;
  const notebook = connectNotebook((msg) => {
    if (msg.cmd !== 'board_updates') return { ran: msg.cmd };
    polls += 1;
    if (polls < 3) return { events: [], cursor: msg.params.since ?? 4 };
    return { events: [{ seq: 5, actor: 'you', type: 'noted' }], cursor: 5 };
  });
  await waitUntil(() => notebook.control.some((item) => item.type === 'agents'));
  const started = Date.now();
  const result = await proc.call('board_updates', {
    boardId: 'board-1',
    wait_seconds: 5,
  });
  const elapsed = Date.now() - started;
  assert.equal(result.isError, false, result.text);
  const payload = JSON.parse(result.text);
  assert.equal(payload.events[0].seq, 5);
  assert.ok(polls >= 3, `expected at least 3 polls, got ${polls}`);
  assert.ok(elapsed >= 1500, `poll loop should wait ~1s between tries, took ${elapsed}ms`);
  notebook.close();
});
