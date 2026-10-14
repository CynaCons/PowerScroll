/**
 * Test 161: insert_block + move_block (within-column content reflow)
 * Covers: REQ-AGENT-060, REQ-AGENT-061, REQ-AGENT-062
 *
 * A scroll is a stack. insert/move shove every top-level occupant of the
 * target band, including diagram frames. Members stay with the frame and
 * cannot be moved on their own. Guide style does not gate this.
 */
import { test, expect } from '@playwright/test';
import {
  waitForCanvasReady,
  waitForBridgeReady,
  runBridge,
  runBridgeExpectingError,
  stubBridgeUrl,
} from '../helpers';
import { BLOCK_GAP, BLOCK_TOP_INSET } from '../../src/bridge/blocks';

const SIMPLE_DIAGRAM = `@startuml
component A
component B
A --> B
@enduml`;

interface NodeSnap {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  groupId?: string | null;
  text?: string;
}

async function contentBlocks(page: import('@playwright/test').Page): Promise<NodeSnap[]> {
  return page.evaluate(() => {
    const nodes = (window as any).__POWERNOTE_STORES__.canvas.getState().nodes as any[];
    const diagramIds = new Set(nodes.filter((n) => n.type === 'diagram').map((n) => n.id));
    return nodes
      .filter((n) => n.type === 'text' && (!n.groupId || !diagramIds.has(n.groupId)))
      .map((n) => ({
        id: n.id,
        type: n.type,
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
        groupId: n.groupId,
        text: n.data?.text,
      }))
      .sort((a, b) => (Math.abs(a.y - b.y) > 20 ? a.y - b.y : a.x - b.x));
  });
}

async function nodeById(
  page: import('@playwright/test').Page,
  id: string,
): Promise<NodeSnap | null> {
  return page.evaluate((id) => {
    const n = (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.find((x: any) => x.id === id);
    if (!n) return null;
    return {
      id: n.id,
      type: n.type,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      groupId: n.groupId,
      text: n.data?.text,
    };
  }, id);
}

async function yMap(page: import('@playwright/test').Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const nodes = (window as any).__POWERNOTE_STORES__.canvas.getState().nodes as any[];
    const out: Record<string, number> = {};
    for (const n of nodes) out[n.id] = n.y;
    return out;
  });
}

async function undoOnce(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__POWERNOTE_STORES__.canvas.getState().undo();
  });
}

async function defaultScrollId(page: import('@playwright/test').Page): Promise<string> {
  const listed = await runBridge(page, 'list_scrolls');
  const first = listed.scrolls[0];
  expect(first?.scrollId).toBeTruthy();
  return first.scrollId;
}

function assertPacked(blocks: NodeSnap[], label: string): void {
  const sorted = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const b of sorted) {
    expect(Number.isFinite(b.y), `${label} ${b.id} y`).toBe(true);
    expect(Number.isFinite(b.height), `${label} ${b.id} height`).toBe(true);
    expect(Number.isNaN(b.y), `${label} ${b.id} NaN`).toBe(false);
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    expect(
      curr.y,
      `${label} ${curr.id} overlaps ${prev.id}`,
    ).toBeGreaterThanOrEqual(prev.y + prev.height);
    expect(
      curr.y - (prev.y + prev.height),
      `${label} gap ${prev.id}→${curr.id}`,
    ).toBeGreaterThanOrEqual(BLOCK_GAP);
  }
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test.describe('161 - insert_block / move_block (REQ-AGENT-060..062)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBridgeUrl(page);
    await page.goto('/');
    await waitForCanvasReady(page);
    await waitForBridgeReady(page);
  });

  test('insert after a middle block shifts only blocks below', async ({ page }) => {
    const scrollId = await defaultScrollId(page);
    const a = await runBridge(page, 'append_block', { markdown: 'Alpha', scrollId });
    const b = await runBridge(page, 'append_block', { markdown: 'Beta', scrollId });
    const c = await runBridge(page, 'append_block', { markdown: 'Gamma', scrollId });

    const before = {
      a: await nodeById(page, a.blockId),
      b: await nodeById(page, b.blockId),
      c: await nodeById(page, c.blockId),
    };
    expect(before.a && before.b && before.c).toBeTruthy();

    const inserted = await runBridge(page, 'insert_block', {
      scrollId,
      markdown: 'Inserted',
      after: b.blockId,
    });
    expect(inserted.blockId).toBeTruthy();
    expect(inserted.markdown).toBe('Inserted');
    expect(inserted.scrollId).toBe(scrollId);
    expect(inserted.displacedCount).toBe(1);

    const after = {
      a: await nodeById(page, a.blockId),
      b: await nodeById(page, b.blockId),
      c: await nodeById(page, c.blockId),
      n: await nodeById(page, inserted.blockId),
    };
    expect(after.n).toBeTruthy();
    expect(after.n!.y).toBe(before.b!.y + before.b!.height + BLOCK_GAP);
    expect(after.a!.y).toBe(before.a!.y);
    expect(after.b!.y).toBe(before.b!.y);
    const dy = after.n!.height + BLOCK_GAP;
    expect(after.c!.y).toBe(before.c!.y + dy);

    const read = await runBridge(page, 'read_page');
    expect(read.blocks.map((x: { markdown: string }) => x.markdown)).toEqual([
      'Alpha',
      'Beta',
      'Inserted',
      'Gamma',
    ]);
  });

  test('insert at index 0 lands at the column top (ceiling-clamped when armed)', async ({
    page,
  }) => {
    const scrollId = await defaultScrollId(page);
    await runBridge(page, 'rename_scroll', { scrollId, title: 'Armed' });

    const empty = await runBridge(page, 'insert_block', {
      scrollId,
      markdown: 'Top of empty',
      index: 0,
    });
    const first = await nodeById(page, empty.blockId);
    expect(first!.y).toBe(BLOCK_TOP_INSET);
    expect(first!.y).toBeGreaterThanOrEqual(0);

    const a = await runBridge(page, 'append_block', { markdown: 'A', scrollId });
    const b = await runBridge(page, 'append_block', { markdown: 'B', scrollId });
    const beforeA = await nodeById(page, a.blockId);
    const beforeB = await nodeById(page, b.blockId);

    const inserted = await runBridge(page, 'insert_block', {
      scrollId,
      markdown: 'New top',
      index: 0,
    });
    const top = await nodeById(page, inserted.blockId);
    const afterA = await nodeById(page, a.blockId);
    const afterB = await nodeById(page, b.blockId);
    const afterEmpty = await nodeById(page, empty.blockId);

    expect(top!.y).toBe(BLOCK_TOP_INSET);
    expect(top!.y).toBeGreaterThanOrEqual(0);
    const dy = top!.height + BLOCK_GAP;
    expect(afterEmpty!.y).toBe(first!.y + dy);
    expect(afterA!.y).toBe(beforeA!.y + dy);
    expect(afterB!.y).toBe(beforeB!.y + dy);

    const ceiling = await page.evaluate(() => {
      const S = (window as any).__POWERNOTE_STORES__;
      const nodes = S.canvas.getState().nodes;
      const strokes = S.draw.getState().strokes;
      const scrolls = S.workspace.getState().getActivePage()?.scrolls;
      let top = Infinity;
      for (const n of nodes) if (n.y < top) top = n.y;
      if (top === Infinity) return 0;
      return Math.min(0, top - 48);
    });
    expect(top!.y).toBeGreaterThanOrEqual(ceiling);
  });

  test('move within a column down and up; one undo restores both halves', async ({ page }) => {
    const scrollId = await defaultScrollId(page);
    const a = await runBridge(page, 'append_block', { markdown: 'A', scrollId });
    const b = await runBridge(page, 'append_block', { markdown: 'B', scrollId });
    const c = await runBridge(page, 'append_block', { markdown: 'C', scrollId });
    const d = await runBridge(page, 'append_block', { markdown: 'D', scrollId });

    const original = await yMap(page);
    const before = {
      a: (await nodeById(page, a.blockId))!,
      b: (await nodeById(page, b.blockId))!,
      c: (await nodeById(page, c.blockId))!,
      d: (await nodeById(page, d.blockId))!,
    };
    const spanBefore = before.d.y + before.d.height;

    const movedDown = await runBridge(page, 'move_block', {
      blockId: b.blockId,
      after: c.blockId,
    });
    expect(movedDown.blockId).toBe(b.blockId);
    expect(movedDown.displacedCount).toBeGreaterThan(0);

    const down = {
      a: (await nodeById(page, a.blockId))!,
      b: (await nodeById(page, b.blockId))!,
      c: (await nodeById(page, c.blockId))!,
      d: (await nodeById(page, d.blockId))!,
    };
    expect(down.a.y).toBe(before.a.y);
    expect(down.c.y).toBe(before.b.y);
    expect(down.b.y).toBe(down.c.y + down.c.height + BLOCK_GAP);
    expect(down.d.y + down.d.height).toBe(spanBefore);
    assertPacked([down.a, down.b, down.c, down.d], 'after move down');

    const readDown = await runBridge(page, 'read_page');
    expect(readDown.blocks.map((x: { markdown: string }) => x.markdown)).toEqual([
      'A',
      'C',
      'B',
      'D',
    ]);

    await undoOnce(page);
    expect(await yMap(page)).toEqual(original);

    const movedUp = await runBridge(page, 'move_block', {
      blockId: c.blockId,
      after: a.blockId,
    });
    expect(movedUp.blockId).toBe(c.blockId);

    const up = {
      a: (await nodeById(page, a.blockId))!,
      b: (await nodeById(page, b.blockId))!,
      c: (await nodeById(page, c.blockId))!,
      d: (await nodeById(page, d.blockId))!,
    };
    expect(up.a.y).toBe(before.a.y);
    expect(up.c.y).toBe(before.a.y + before.a.height + BLOCK_GAP);
    expect(up.b.y).toBe(up.c.y + up.c.height + BLOCK_GAP);
    expect(up.d.y + up.d.height).toBe(spanBefore);
    assertPacked([up.a, up.b, up.c, up.d], 'after move up');

    const readUp = await runBridge(page, 'read_page');
    expect(readUp.blocks.map((x: { markdown: string }) => x.markdown)).toEqual([
      'A',
      'C',
      'B',
      'D',
    ]);

    await undoOnce(page);
    expect(await yMap(page)).toEqual(original);
  });

  test('cross-scroll move closes the source and arrives id-addressed', async ({ page }) => {
    const leftId = await defaultScrollId(page);
    const right = await runBridge(page, 'create_scroll', { title: 'Right' });

    const l1 = await runBridge(page, 'append_block', { markdown: 'L1', scrollId: leftId });
    const l2 = await runBridge(page, 'append_block', { markdown: 'L2', scrollId: leftId });
    const l3 = await runBridge(page, 'append_block', { markdown: 'L3', scrollId: leftId });
    const r1 = await runBridge(page, 'append_block', { markdown: 'R1', scrollId: right.scrollId });

    const before = {
      l1: (await nodeById(page, l1.blockId))!,
      l2: (await nodeById(page, l2.blockId))!,
      l3: (await nodeById(page, l3.blockId))!,
      r1: (await nodeById(page, r1.blockId))!,
    };

    const moved = await runBridge(page, 'move_block', {
      blockId: l2.blockId,
      scrollId: right.scrollId,
      after: r1.blockId,
    });
    expect(moved.scrollId).toBe(right.scrollId);
    expect(moved.column).toBe(right.column);

    const after = {
      l1: (await nodeById(page, l1.blockId))!,
      l2: (await nodeById(page, l2.blockId))!,
      l3: (await nodeById(page, l3.blockId))!,
      r1: (await nodeById(page, r1.blockId))!,
    };

    expect(after.l1.y).toBe(before.l1.y);
    expect(after.l3.y).toBe(before.l3.y - (before.l2.height + BLOCK_GAP));
    expect(after.r1.y).toBe(before.r1.y);
    expect(after.l2.x).toBe(before.r1.x);
    expect(after.l2.y).toBe(after.r1.y + after.r1.height + BLOCK_GAP);

    const read = await runBridge(page, 'read_page');
    const leftMd = read.blocks
      .filter((b: { scrollId: string }) => b.scrollId === leftId)
      .map((b: { markdown: string }) => b.markdown);
    const rightMd = read.blocks
      .filter((b: { scrollId: string }) => b.scrollId === right.scrollId)
      .map((b: { markdown: string }) => b.markdown);
    expect(leftMd).toEqual(['L1', 'L3']);
    expect(rightMd).toEqual(['R1', 'L2']);
  });

  test('refusals: after mismatch, both/neither, unknown ids, non-blocks', async ({ page }) => {
    const leftId = await defaultScrollId(page);
    const right = await runBridge(page, 'create_scroll', { title: 'Other' });
    const leftBlock = await runBridge(page, 'append_block', { markdown: 'Left', scrollId: leftId });
    await runBridge(page, 'append_block', { markdown: 'Right', scrollId: right.scrollId });

    const notInScroll = await runBridgeExpectingError(page, 'insert_block', {
      scrollId: right.scrollId,
      markdown: 'nope',
      after: leftBlock.blockId,
    });
    expect(notInScroll.code).toBe('BAD_PARAMS');
    expect(notInScroll.message).toContain(leftBlock.blockId);
    expect(notInScroll.message).toContain(right.scrollId);

    const both = await runBridgeExpectingError(page, 'insert_block', {
      scrollId: leftId,
      markdown: 'nope',
      after: leftBlock.blockId,
      index: 0,
    });
    expect(both.code).toBe('BAD_PARAMS');
    expect(both.message.toLowerCase()).toMatch(/after/);
    expect(both.message.toLowerCase()).toMatch(/index/);

    const neither = await runBridgeExpectingError(page, 'insert_block', {
      scrollId: leftId,
      markdown: 'nope',
    });
    expect(neither.code).toBe('BAD_PARAMS');

    const badScroll = await runBridgeExpectingError(page, 'insert_block', {
      scrollId: 'no-such-scroll',
      markdown: 'nope',
      index: 0,
    });
    expect(badScroll.code).toBe('NOT_FOUND');
    expect(badScroll.message).toContain('no-such-scroll');

    const badAfter = await runBridgeExpectingError(page, 'insert_block', {
      scrollId: leftId,
      markdown: 'nope',
      after: 'no-such-block',
    });
    expect(badAfter.code).toBe('NOT_FOUND');

    const badMove = await runBridgeExpectingError(page, 'move_block', {
      blockId: 'no-such-block',
      index: 0,
    });
    expect(badMove.code).toBe('NOT_FOUND');

    const neitherMove = await runBridgeExpectingError(page, 'move_block', {
      blockId: leftBlock.blockId,
    });
    expect(neitherMove.code).toBe('BAD_PARAMS');

    await runBridge(page, 'rename_scroll', { scrollId: right.scrollId, title: '' });

    const drawn = await runBridge(page, 'create_diagram', {
      source: SIMPLE_DIAGRAM,
      title: 'Pinned',
      scrollId: leftId,
    });
    await page.waitForTimeout(150);
    const memberId = await page.evaluate((frameId) => {
      const nodes = (window as any).__POWERNOTE_STORES__.canvas.getState().nodes;
      const member = nodes.find((n: any) => n.groupId === frameId && n.id !== frameId);
      return member?.id ?? null;
    }, drawn.diagramId);
    expect(memberId).toBeTruthy();

    const moveMember = await runBridgeExpectingError(page, 'move_block', {
      blockId: memberId,
      index: 0,
    });
    expect(moveMember.code).toBe('UNSUPPORTED');
    expect(moveMember.message).toContain('Pinned');
    expect(moveMember.message).toContain(drawn.diagramId);

    const beforeFrame = await nodeById(page, drawn.diagramId);
    const moveFrame = await runBridge(page, 'move_block', {
      blockId: drawn.diagramId,
      index: 0,
    });
    expect(moveFrame.blockId).toBe(drawn.diagramId);
    const afterFrame = await nodeById(page, drawn.diagramId);
    expect(afterFrame!.y).not.toBe(beforeFrame!.y);

    const shapeId = await page.evaluate(() => {
      const canvas = (window as any).__POWERNOTE_STORES__.canvas;
      canvas.getState().addNode({
        id: 'free-shape',
        type: 'shape',
        x: 60,
        y: 800,
        width: 40,
        height: 40,
        layer: 3,
        data: {
          shapeType: 'rect',
          fill: 'transparent',
          stroke: '#111',
          strokeWidth: 1,
          strokeDash: [],
        },
      });
      return 'free-shape';
    });
    const moveShape = await runBridgeExpectingError(page, 'move_block', {
      blockId: shapeId,
      index: 0,
    });
    expect(moveShape.code).toBe('UNSUPPORTED');
    expect(moveShape.message).toContain('shape');
  });

  test('insert above a diagram moves the frame, its members, and loose marks', async ({ page }) => {
    const scrollId = await defaultScrollId(page);
    const a = await runBridge(page, 'append_block', { markdown: 'Above', scrollId });
    const drawn = await runBridge(page, 'create_diagram', {
      source: SIMPLE_DIAGRAM,
      title: 'Stay',
      scrollId,
    });
    await page.waitForTimeout(150);
    const below = await runBridge(page, 'append_block', { markdown: 'Below', scrollId });

    const planted = await page.evaluate(() => {
      const S = (window as any).__POWERNOTE_STORES__;
      S.canvas.getState().addNode({
        id: 'free-rect',
        type: 'shape',
        x: 80,
        y: 900,
        width: 30,
        height: 30,
        layer: 3,
        data: {
          shapeType: 'rect',
          fill: 'transparent',
          stroke: '#222',
          strokeWidth: 1,
          strokeDash: [],
        },
      });
      const strokes = S.draw.getState().strokes;
      S.draw.setState({
        strokes: [
          ...strokes,
          { id: 'free-ink', points: [70, 940, 110, 960], color: '#000', strokeWidth: 2 },
        ],
      });
      S.workspace.getState().savePageNodes(S.canvas.getState().nodes);
      S.workspace.getState().savePageStrokes(S.draw.getState().strokes);
      return { shapeY: 900, strokeY: 940 };
    });

    const before = await page.evaluate((frameId) => {
      const nodes = (window as any).__POWERNOTE_STORES__.canvas.getState().nodes as any[];
      const frame = nodes.find((n) => n.id === frameId);
      const members = nodes
        .filter((n) => n.groupId === frameId)
        .map((n) => ({ id: n.id, y: n.y }));
      const shape = nodes.find((n) => n.id === 'free-rect');
      const stroke = (window as any).__POWERNOTE_STORES__.draw
        .getState()
        .strokes.find((s: any) => s.id === 'free-ink');
      return {
        frameY: frame?.y,
        members,
        shapeY: shape?.y,
        strokeY: stroke?.points[1],
      };
    }, drawn.diagramId);

    const beforeBelow = await nodeById(page, below.blockId);
    const beforeA = await nodeById(page, a.blockId);

    const inserted = await runBridge(page, 'insert_block', {
      scrollId,
      markdown: 'Between',
      after: a.blockId,
    });
    await page.waitForTimeout(150);
    const neu = await nodeById(page, inserted.blockId);
    const afterBelow = await nodeById(page, below.blockId);
    const afterA = await nodeById(page, a.blockId);

    const dy = neu!.height + BLOCK_GAP;
    expect(afterA!.y).toBe(beforeA!.y);
    expect(neu!.y).toBe(beforeA!.y + beforeA!.height + BLOCK_GAP);
    expect(afterBelow!.y).toBe(beforeBelow!.y + dy);

    const after = await page.evaluate((frameId) => {
      const nodes = (window as any).__POWERNOTE_STORES__.canvas.getState().nodes as any[];
      const frame = nodes.find((n) => n.id === frameId);
      const members = nodes
        .filter((n) => n.groupId === frameId)
        .map((n) => ({ id: n.id, y: n.y }));
      const shape = nodes.find((n) => n.id === 'free-rect');
      const stroke = (window as any).__POWERNOTE_STORES__.draw
        .getState()
        .strokes.find((s: any) => s.id === 'free-ink');
      return {
        frameY: frame?.y,
        members,
        shapeY: shape?.y,
        strokeY: stroke?.points[1],
      };
    }, drawn.diagramId);

    expect(after.frameY).toBe(before.frameY + dy);
    expect(after.members.length).toBe(before.members.length);
    for (const m of before.members) {
      const moved = after.members.find((x: { id: string }) => x.id === m.id);
      expect(moved?.y).toBe(m.y + dy);
    }
    expect(after.shapeY).toBe(planted.shapeY + dy);
    expect(after.strokeY).toBe(planted.strokeY + dy);
  });

  test('stress: 60-block insert at 0, then 20 random moves undo exactly', async ({ page }) => {
    // 60 bridge inserts with reflow take 27–33 s on a loaded machine, on the old
    // header and the new one alike (measured 2026-09-05). The default 30 s budget
    // fails correct-but-slow runs, which the config says it must not.
    test.setTimeout(60_000);
    const scrollId = await defaultScrollId(page);

    await page.evaluate(() => {
      const nodes = [];
      for (let i = 0; i < 60; i++) {
        nodes.push({
          id: `stress-${i}`,
          type: 'text',
          x: 60,
          y: 48 + i * 44,
          width: 794,
          height: 32,
          layer: 3,
          data: {
            text: `B${i}`,
            fontSize: 16,
            fontFamily: 'Inter',
            fontStyle: 'normal',
            fill: '#111',
          },
        });
      }
      const canvas = (window as any).__POWERNOTE_STORES__.canvas;
      canvas.setState({ nodes });
      (window as any).__POWERNOTE_STORES__.workspace.getState().savePageNodes(nodes);
    });

    const inserted = await runBridge(page, 'insert_block', {
      scrollId,
      markdown: 'HEAD',
      index: 0,
    });
    const head = await nodeById(page, inserted.blockId);
    expect(head!.y).toBe(BLOCK_TOP_INSET);
    expect(inserted.displacedCount).toBe(60);

    const afterInsert = await contentBlocks(page);
    expect(afterInsert).toHaveLength(61);
    expect(afterInsert[0].id).toBe(inserted.blockId);
    expect(afterInsert.slice(1).map((b) => b.id)).toEqual(
      Array.from({ length: 60 }, (_, i) => `stress-${i}`),
    );
    const dy = head!.height + BLOCK_GAP;
    for (let i = 0; i < 60; i++) {
      expect(afterInsert[i + 1].y).toBe(48 + i * 44 + dy);
    }
    assertPacked(afterInsert, 'after insert at 0');

    const originalYs = await yMap(page);
    const ids = afterInsert.map((b) => b.id);
    const rand = mulberry32(161);

    for (let step = 0; step < 20; step++) {
      const blockId = ids[Math.floor(rand() * ids.length)];
      if (rand() < 0.6) {
        let after = ids[Math.floor(rand() * ids.length)];
        if (after === blockId) after = ids[(ids.indexOf(after) + 1) % ids.length];
        await runBridge(page, 'move_block', { blockId, after });
      } else {
        const others = ids.filter((id) => id !== blockId);
        const index = Math.floor(rand() * (others.length + 1));
        await runBridge(page, 'move_block', { blockId, index });
      }
      const now = await contentBlocks(page);
      expect(now).toHaveLength(61);
      assertPacked(now, `after move ${step}`);
    }

    for (let i = 0; i < 20; i++) await undoOnce(page);
    expect(await yMap(page)).toEqual(originalYs);
  });
});
