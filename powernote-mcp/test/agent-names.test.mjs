/**
 * Agents must name themselves: no generated names (owner request 2026-10-14).
 * A server started WITHOUT POWERNOTE_AGENT_NAME refuses board calls that do
 * not carry `me`, refuses generated-looking names, and lists its own process
 * as unnamed.
 *
 * Run: npm test --prefix powernote-mcp
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';

const PORT = 41825;
const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');

const BOARD_WRITE_TOOLS = [
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
];

let child;
let nextId = 1;
const waiters = new Map();

function rpc(method, params) {
  return new Promise((resolve) => {
    const id = nextId++;
    waiters.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

async function call(name, args = {}) {
  const res = await rpc('tools/call', { name, arguments: args });
  return {
    isError: !!res?.result?.isError,
    text: res?.result?.content?.[0]?.text ?? '',
  };
}

before(async () => {
  const env = { ...process.env, POWERNOTE_BRIDGE_PORT: String(PORT) };
  delete env.POWERNOTE_AGENT_NAME;
  child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'], env });

  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const waiter = waiters.get(msg.id);
        if (waiter) {
          waiters.delete(msg.id);
          waiter(msg);
        }
      } catch {
        // not a JSON-RPC line
      }
    }
  });

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
    clientInfo: { name: 'agent-names-test', version: '1' },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
});

after(() => {
  child?.kill();
});

test('every board write tool requires me in its schema', async () => {
  const res = await rpc('tools/list', {});
  const tools = res.result.tools;
  for (const name of BOARD_WRITE_TOOLS) {
    const tool = tools.find((item) => item.name === name);
    assert.ok(tool, `missing tool ${name}`);
    assert.ok(tool.inputSchema.required.includes('me'), `${name} does not require me`);
  }
});

test('a board call without me is refused with NAME_REQUIRED, never given a made-up name', async () => {
  const result = await call('card_create', { boardId: 'b1', title: 'No name' });
  assert.equal(result.isError, true);
  assert.match(result.text, /NAME_REQUIRED/);
});

test('generated-looking names are refused', async () => {
  for (const me of ['agent-1a2b3c4d', 'unnamed-0f9e8d7c']) {
    const result = await call('card_create', { boardId: 'b1', title: 'Fake', me });
    assert.equal(result.isError, true, me);
    assert.match(result.text, /NAME_REQUIRED/, me);
  }
});

test('the agents frame lists an unnamed process as unnamed', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const frame = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no agents frame')), 5000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ v: 1, type: 'hello', app: 'powernote', appVersion: 'test', notebook: 'N.html' }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'agents') {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
  ws.close();
  const hub = frame.agents.find((agent) => agent.role === 'hub');
  assert.match(hub.label, /^unnamed-[0-9a-f]{8}$/);
  assert.equal(hub.named, false);
});
