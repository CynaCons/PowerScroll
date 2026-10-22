/**
 * Test 156: delete_scroll removes the band's content, group-aware
 * Covers: REQ-AGENT-052, REQ-HIER-021
 *
 * Scroll deletion already compacted columns, but it filtered nodes per-x
 * (a diagram straddling the band edge lost its frame and kept the overhang)
 * and never touched strokes. Content now follows the frame's band, ink goes
 * with the band, and `content` is required on a non-empty band — there is
 * no default, because flipping keep→delete would silently destroy callers.
 */
import { test, expect } from '@playwright/test';
import {
  waitForCanvasReady,
  waitForBridgeReady,
  runBridge,
  runBridgeExpectingError,
  preloadModule,
} from '../helpers';

const FRAME = 'band-frame';
const OVERHANG = 'band-overhang';
const SURVIVOR = 'band-survivor';
const GROUP_INK = 'band-group-ink';
const BAND_INK = 'band-loose-ink';
const KEEP_INK = 'band-keep-ink';

const LAYOUT = '/src/utils/pageLayout.ts';

async function seedTwoScrolls(page: import('@playwright/test').Page) {
  // preloadModule, never `await import()` inside evaluate (see helpers.ts):
  // the pending-import promise can be collected and the run fails with
  // "Execution context was destroyed".
  await preloadModule(page, LAYOUT);
  return page.evaluate(
    async ({ frame, overhang, survivor, groupInk, bandInk, keepInk }) => {
      const layout = (window as any).__mods['/src/utils/pageLayout.ts'];
      const S = (window as any).__POWERNOTE_STORES__;
      const ws = S.workspace.getState();
      const created = ws.createScroll(ws.activePageId, 'Neighbour');
      const scrolls = ws.getActivePage().scrolls;
      const left = layout.columnLeft(0, scrolls);
      const right = layout.columnLeft(1, scrolls);
      S.canvas.setState({
        nodes: [
          {
            id: frame,
            type: 'diagram',
            x: left,
            y: 80,
            width: 260,
            height: 160,
            layer: 2,
            groupId: frame,
            data: { source: '', title: 'Straddle' },
          },
          {
            id: overhang,
            type: 'shape',
            x: right + 20,
            y: 120,
            width: 80,
            height: 40,
            layer: 3,
            groupId: frame,
            data: {
              shapeType: 'rect',
              fill: '#eef1f0',
              stroke: '#14181a',
              strokeWidth: 1.6,
              strokeDash: [],
            },
          },
          {
            id: survivor,
            type: 'text',
            x: right,
            y: 80,
            width: 200,
            height: 40,
            layer: 4,
            data: {
              text: 'stays in neighbour',
              fontSize: 16,
              fontFamily: 'Inter',
              fontStyle: 'normal',
              fill: '#111',
            },
          },
        ],
        selectedNodeIds: [],
      });
      S.draw.setState({
        strokes: [
          {
            id: groupInk,
            points: [right + 40, 160, right + 60, 180],
            color: '#14181A',
            strokeWidth: 2,
            groupId: frame,
          },
          {
            id: bandInk,
            points: [left + 10, 200, left + 40, 220],
            color: '#14181A',
            strokeWidth: 2,
          },
          {
            id: keepInk,
            points: [right + 10, 240, right + 30, 260],
            color: '#B4552D',
            strokeWidth: 2,
          },
        ],
        selectedStrokeIds: [],
      });
      S.workspace.getState().savePageNodes(S.canvas.getState().nodes);
      S.workspace.getState().savePageStrokes(S.draw.getState().strokes);
      const owner = scrolls.find((s: any) => s.column === 0);
      return {
        ownerId: owner.id,
        neighbourId: created.id,
        left,
        right,
      };
    },
    { frame: FRAME, overhang: OVERHANG, survivor: SURVIVOR, groupInk: GROUP_INK, bandInk: BAND_INK, keepInk: KEEP_INK },
  );
}

async function live(page: import('@playwright/test').Page) {
  await preloadModule(page, LAYOUT);
  return page.evaluate(async () => {
    const layout = (window as any).__mods['/src/utils/pageLayout.ts'];
    const S = (window as any).__POWERNOTE_STORES__;
    const ws = S.workspace.getState();
    const pageRec = ws.getActivePage();
    return {
      nodeIds: S.canvas.getState().nodes.map((n: any) => n.id).sort(),
      strokeIds: S.draw.getState().strokes.map((s: any) => s.id).sort(),
      scrollTitles: (pageRec?.scrolls ?? []).map((s: any) => s.title).sort(),
      survivorX: S.canvas.getState().nodes.find((n: any) => n.id === 'band-survivor')?.x,
      col0: layout.columnLeft(0, pageRec?.scrolls),
    };
  });
}

test.describe('156 - delete_scroll content is group-aware (REQ-AGENT-052)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await waitForBridgeReady(page);
  });

  test('content delete takes the whole straddling group, its ink, and band ink; survivors shift', async ({
    page,
  }) => {
    const ids = await seedTwoScrolls(page);

    const result = await runBridge(page, 'delete_scroll', {
      scrollId: ids.ownerId,
      content: 'delete',
      confirm: true,
    });
    expect(result.deleted).toBe('scroll');
    expect(result.blocksRemoved).toBeGreaterThanOrEqual(2);

    const after = await live(page);
    expect(after.nodeIds).toEqual([SURVIVOR]);
    expect(after.strokeIds).toEqual([KEEP_INK]);
    expect(after.scrollTitles).toEqual(['Neighbour']);
    expect(after.survivorX).toBe(after.col0);
  });

  test('content keep preserves nodes and ink while the band closes', async ({ page }) => {
    const ids = await seedTwoScrolls(page);

    const result = await runBridge(page, 'delete_scroll', {
      scrollId: ids.ownerId,
      content: 'keep',
      confirm: true,
    });
    expect(result.blocksRemoved).toBe(0);

    const after = await live(page);
    expect(after.nodeIds).toEqual([FRAME, OVERHANG, SURVIVOR].sort());
    expect(after.strokeIds).toEqual([BAND_INK, GROUP_INK, KEEP_INK].sort());
    expect(after.scrollTitles).toEqual(['Neighbour']);
  });

  test('deleting the neighbour leaves a group that only overhangs into it', async ({ page }) => {
    const ids = await seedTwoScrolls(page);

    await runBridge(page, 'delete_scroll', {
      scrollId: ids.neighbourId,
      content: 'delete',
      confirm: true,
    });

    const after = await live(page);
    expect(after.nodeIds.sort()).toEqual([FRAME, OVERHANG].sort());
    expect(after.strokeIds.sort()).toEqual([BAND_INK, GROUP_INK].sort());
    expect(after.nodeIds).not.toContain(SURVIVOR);
  });

  test('one undo restores the band, the group, and the ink', async ({ page }) => {
    const ids = await seedTwoScrolls(page);
    const before = await live(page);

    await runBridge(page, 'delete_scroll', {
      scrollId: ids.ownerId,
      content: 'delete',
      confirm: true,
    });
    expect((await live(page)).nodeIds).toEqual([SURVIVOR]);

    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.canvas.getState().undo();
    });

    const restored = await live(page);
    expect(restored.nodeIds).toEqual(before.nodeIds);
    expect(restored.strokeIds).toEqual(before.strokeIds);
    expect(restored.scrollTitles).toEqual(before.scrollTitles);
    expect(restored.survivorX).toBe(before.survivorX);
  });

  test('missing content on a non-empty scroll is BAD_PARAMS naming the counts', async ({
    page,
  }) => {
    const ids = await seedTwoScrolls(page);

    const err = await runBridgeExpectingError(page, 'delete_scroll', {
      scrollId: ids.ownerId,
      confirm: true,
    });
    expect(err.code).toBe('BAD_PARAMS');
    expect(err.message).toContain('2 nodes');
    expect(err.message).toContain('1 group member');
    expect(err.message).toContain('2 strokes');
    expect(err.message).toContain('content:"delete"');
    expect(err.message).toContain('content:"keep"');

    const after = await live(page);
    expect(after.nodeIds).toEqual([FRAME, OVERHANG, SURVIVOR].sort());
    expect(after.strokeIds).toEqual([BAND_INK, GROUP_INK, KEEP_INK].sort());
    expect(after.scrollTitles).toHaveLength(2);
    expect(after.scrollTitles).toContain('Neighbour');
  });

  test('missing content on an empty scroll succeeds', async ({ page }) => {
    const created = await runBridge(page, 'create_scroll', { title: 'Empty neighbour' });

    const result = await runBridge(page, 'delete_scroll', {
      scrollId: created.scrollId,
      confirm: true,
    });
    expect(result.deleted).toBe('scroll');
    expect(result.blocksRemoved).toBe(0);

    const listed = await runBridge(page, 'list_scrolls');
    expect(listed.scrolls).toHaveLength(1);
    expect(listed.scrolls.map((s: { title: string }) => s.title)).not.toContain('Empty neighbour');
  });
});
