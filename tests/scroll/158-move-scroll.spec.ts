/**
 * Test 158: move_scroll on a group-aware compactColumns
 * Covers: REQ-AGENT-054, REQ-HIER-022
 *
 * compactColumns used to filter/move by each node's own x and never touched
 * strokes. A diagram straddling a band edge would tear on reorder the same
 * way delete_scroll used to. Membership is now the frame-origin verdict for
 * every column operation (delete-keep, reorder, move); ungrouped strokes
 * shift with the band their first point falls in.
 */
import { test, expect } from '@playwright/test';
import {
  waitForCanvasReady,
  waitForBridgeReady,
  runBridge,
  runBridgeExpectingError,
  preloadModule,
} from '../helpers';

const LEFT_BLOCK = 'move-left-block';
const FRAME = 'move-frame';
const OVERHANG = 'move-overhang';
const MID_INK = 'move-mid-ink';
const GROUP_INK = 'move-group-ink';
const RIGHT_BLOCK = 'move-right-block';
const RIGHT_INK = 'move-right-ink';

const WIDE = 1200;

type Seed = {
  leftId: string;
  midId: string;
  rightId: string;
  left: number;
  mid: number;
  right: number;
};

async function seedThreeScrolls(
  page: import('@playwright/test').Page,
  opts: { widenMiddle?: boolean } = {},
): Promise<Seed> {
  await preloadModule(page, '/src/utils/pageLayout.ts');
  return page.evaluate(
    async ({ widenMiddle, wide, leftBlock, frame, overhang, midInk, groupInk, rightBlock, rightInk }) => {
      const layout = (window as any).__mods['/src/utils/pageLayout.ts'];
      const S = (window as any).__POWERNOTE_STORES__;
      const ws = S.workspace.getState();
      const pageId = ws.activePageId;
      const leftRec = ws.getActivePage().scrolls[0];
      ws.renameScroll(pageId, leftRec.id, 'Left');
      const midRec = ws.createScroll(pageId, 'Middle');
      const rightRec = ws.createScroll(pageId, 'Right');
      if (widenMiddle) {
        ws.replacePageScrolls(
          pageId,
          ws.getActivePage().scrolls.map((s: any) =>
            s.id === midRec.id ? { ...s, width: wide } : s,
          ),
        );
      }
      const scrolls = ws.getActivePage().scrolls;
      const left = layout.columnLeft(0, scrolls);
      const mid = layout.columnLeft(1, scrolls);
      const right = layout.columnLeft(2, scrolls);
      S.canvas.setState({
        nodes: [
          {
            id: leftBlock,
            type: 'text',
            x: left,
            y: 80,
            width: 200,
            height: 40,
            layer: 4,
            data: {
              text: 'left column',
              fontSize: 16,
              fontFamily: 'Inter',
              fontStyle: 'normal',
              fill: '#111',
            },
          },
          {
            id: frame,
            type: 'diagram',
            x: mid,
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
            id: rightBlock,
            type: 'text',
            x: right,
            y: 80,
            width: 200,
            height: 40,
            layer: 4,
            data: {
              text: 'right column',
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
            id: midInk,
            points: [mid + 10, 200, mid + 40, 220],
            color: '#14181A',
            strokeWidth: 2,
          },
          {
            id: groupInk,
            points: [right + 40, 160, right + 60, 180],
            color: '#14181A',
            strokeWidth: 2,
            groupId: frame,
          },
          {
            id: rightInk,
            points: [right + 10, 240, right + 30, 260],
            color: '#B4552D',
            strokeWidth: 2,
          },
        ],
        selectedStrokeIds: [],
      });
      S.workspace.getState().savePageNodes(S.canvas.getState().nodes);
      S.workspace.getState().savePageStrokes(S.draw.getState().strokes);
      return {
        leftId: leftRec.id,
        midId: midRec.id,
        rightId: rightRec.id,
        left,
        mid,
        right,
      };
    },
    {
      widenMiddle: !!opts.widenMiddle,
      wide: WIDE,
      leftBlock: LEFT_BLOCK,
      frame: FRAME,
      overhang: OVERHANG,
      midInk: MID_INK,
      groupInk: GROUP_INK,
      rightBlock: RIGHT_BLOCK,
      rightInk: RIGHT_INK,
    },
  );
}

async function snapshot(page: import('@playwright/test').Page) {
  await preloadModule(page, '/src/utils/pageLayout.ts');
  return page.evaluate(async () => {
    const layout = (window as any).__mods['/src/utils/pageLayout.ts'];
    const S = (window as any).__POWERNOTE_STORES__;
    const ws = S.workspace.getState();
    const pageRec = ws.getActivePage();
    const nodes = S.canvas.getState().nodes;
    const strokes = S.draw.getState().strokes;
    const byId = Object.fromEntries(nodes.map((n: any) => [n.id, n]));
    const strokeById = Object.fromEntries(strokes.map((s: any) => [s.id, s]));
    const scrolls = [...(pageRec?.scrolls ?? [])].sort((a: any, b: any) => a.column - b.column);
    return {
      nodeX: {
        left: byId['move-left-block']?.x,
        frame: byId['move-frame']?.x,
        overhang: byId['move-overhang']?.x,
        right: byId['move-right-block']?.x,
      },
      strokeX: {
        mid: strokeById['move-mid-ink']?.points?.[0],
        group: strokeById['move-group-ink']?.points?.[0],
        right: strokeById['move-right-ink']?.points?.[0],
      },
      strokeIds: strokes.map((s: any) => s.id).sort(),
      nodeIds: nodes.map((n: any) => n.id).sort(),
      scrolls: scrolls.map((s: any) => ({
        id: s.id,
        title: s.title,
        column: s.column,
        width: s.width,
      })),
      col: [0, 1, 2].map((c) => layout.columnLeft(c, pageRec?.scrolls)),
    };
  });
}

test.describe('158 - move_scroll is group-aware (REQ-AGENT-054, REQ-HIER-022)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await waitForBridgeReady(page);
  });

  test('reorder middle left: members, group ink and displaced content land in new bands', async ({
    page,
  }) => {
    const ids = await seedThreeScrolls(page);
    const before = await snapshot(page);
    const frameToOverhang = before.nodeX.overhang - before.nodeX.frame;
    const frameToGroupInk = before.strokeX.group - before.nodeX.frame;

    const result = await runBridge(page, 'move_scroll', {
      scrollId: ids.midId,
      direction: 'left',
    });
    expect(result.fromColumn).toBe(1);
    expect(result.toColumn).toBe(0);

    const after = await snapshot(page);
    // Middle is now leftmost; Left was displaced to column 1; Right stays 2.
    expect(after.scrolls.map((s) => s.title)).toEqual(['Middle', 'Left', 'Right']);
    expect(after.nodeX.frame).toBe(after.col[0]);
    expect(after.nodeX.left).toBe(after.col[1]);
    expect(after.nodeX.right).toBe(after.col[2]);

    // Group integrity: the overhang sat in the Right band, but it follows the
    // frame, not its own x — the whole diagram moved by the same delta.
    expect(after.nodeX.overhang - after.nodeX.frame).toBeCloseTo(frameToOverhang, 5);
    expect(after.strokeX.group - after.nodeX.frame).toBeCloseTo(frameToGroupInk, 5);
    expect(after.strokeX.mid).toBeCloseTo(ids.mid + 10 + (after.col[0] - ids.mid), 5);
    expect(after.strokeX.right).toBe(before.strokeX.right);

    // Without group-aware membership the overhang would have stayed in the
    // Right band (its own x) while the frame moved left.
    expect(after.nodeX.overhang).not.toBe(before.nodeX.overhang);
  });

  test('per-scroll width travels and offsets recompute for the third scroll', async ({
    page,
  }) => {
    const ids = await seedThreeScrolls(page, { widenMiddle: true });
    const before = await snapshot(page);
    expect(before.scrolls.find((s) => s.id === ids.midId)?.width).toBe(WIDE);

    const result = await runBridge(page, 'move_scroll', {
      scrollId: ids.midId,
      direction: 'right',
    });
    expect(result.fromColumn).toBe(1);
    expect(result.toColumn).toBe(2);

    const after = await snapshot(page);
    expect(after.scrolls.map((s) => s.title)).toEqual(['Left', 'Right', 'Middle']);
    const midRec = after.scrolls.find((s) => s.id === ids.midId);
    expect(midRec?.width).toBe(WIDE);
    expect(midRec?.column).toBe(2);

    // Third scroll is now the widened Middle — its content sits at the
    // recomputed left edge, not the pre-move column-2 origin.
    expect(after.nodeX.frame).toBe(after.col[2]);
    expect(after.nodeX.right).toBe(after.col[1]);
    expect(after.col[2]).not.toBe(before.col[2]);
    expect(after.nodeX.frame).not.toBe(before.nodeX.frame);
  });

  test('one undo restores nodes, strokes, order and widths', async ({ page }) => {
    await seedThreeScrolls(page, { widenMiddle: true });
    const before = await snapshot(page);
    const midId = before.scrolls.find((s) => s.title === 'Middle')!.id;

    await runBridge(page, 'move_scroll', { scrollId: midId, direction: 'right' });
    const moved = await snapshot(page);
    expect(moved.scrolls.map((s) => s.title)).toEqual(['Left', 'Right', 'Middle']);
    expect(moved.nodeX.frame).not.toBe(before.nodeX.frame);

    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.canvas.getState().undo();
    });

    const restored = await snapshot(page);
    expect(restored.nodeX).toEqual(before.nodeX);
    expect(restored.strokeX).toEqual(before.strokeX);
    expect(restored.scrolls).toEqual(before.scrolls);
  });

  test('edge refusals name the edge; unknown id is NOT_FOUND', async ({ page }) => {
    const ids = await seedThreeScrolls(page);

    const leftErr = await runBridgeExpectingError(page, 'move_scroll', {
      scrollId: ids.leftId,
      direction: 'left',
    });
    expect(leftErr.code).toBe('PRECONDITION');
    expect(leftErr.message.toLowerCase()).toContain('left');

    const rightErr = await runBridgeExpectingError(page, 'move_scroll', {
      scrollId: ids.rightId,
      direction: 'right',
    });
    expect(rightErr.code).toBe('PRECONDITION');
    expect(rightErr.message.toLowerCase()).toContain('right');

    const sameErr = await runBridgeExpectingError(page, 'move_scroll', {
      scrollId: ids.midId,
      toColumn: 1,
    });
    expect(sameErr.code).toBe('PRECONDITION');

    const unknown = await runBridgeExpectingError(page, 'move_scroll', {
      scrollId: 'no-such-scroll',
      direction: 'left',
    });
    expect(unknown.code).toBe('NOT_FOUND');
    expect(unknown.message).toContain('no-such-scroll');

    const after = await snapshot(page);
    expect(after.scrolls.map((s) => s.title)).toEqual(['Left', 'Middle', 'Right']);
  });

  test('delete_scroll keep-path shifts surviving strokes with their bands', async ({ page }) => {
    const ids = await seedThreeScrolls(page);
    const before = await snapshot(page);

    await runBridge(page, 'delete_scroll', {
      scrollId: ids.midId,
      content: 'keep',
      confirm: true,
    });

    const after = await snapshot(page);
    expect(after.scrolls.map((s) => s.title)).toEqual(['Left', 'Right']);
    // Right closed into column 1 — its ungrouped ink must have travelled
    // (this was the v0.53 hole: compactColumns never shifted strokes).
    expect(after.strokeX.right).toBeCloseTo(before.strokeX.right + (after.col[1] - before.col[2]), 5);
    expect(after.nodeX.right).toBe(after.col[1]);
    expect(after.strokeIds).toEqual(before.strokeIds);
  });

  test('bridge round trip via runBridge; header menu disables at the edges', async ({
    page,
  }) => {
    const ids = await seedThreeScrolls(page);

    await page.waitForFunction((name) => {
      const stage = (window as any).Konva?.stages?.[0];
      if (!stage) return false;
      return stage.find('Text').some((t: any) => t.text() === name);
    }, 'Left');

    await page.evaluate((name) => {
      const stage = (window as any).Konva.stages[0];
      const text = stage.find('Text').find((t: any) => t.text() === name);
      if (!text) throw new Error(`no title "${name}"`);
      text.getParent().fire('contextmenu', {
        evt: { preventDefault() {}, stopPropagation() {}, clientX: 80, clientY: 40 },
      });
    }, 'Left');

    const menu = page.locator('[data-testid="scroll-header-menu"]');
    await expect(menu).toBeVisible();
    await expect(page.locator('[data-testid="move-scroll-left"]')).toBeDisabled();
    await expect(page.locator('[data-testid="move-scroll-right"]')).toBeEnabled();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await page.evaluate((name) => {
      const stage = (window as any).Konva.stages[0];
      const text = stage.find('Text').find((t: any) => t.text() === name);
      if (!text) throw new Error(`no title "${name}"`);
      text.getParent().fire('contextmenu', {
        evt: { preventDefault() {}, stopPropagation() {}, clientX: 400, clientY: 40 },
      });
    }, 'Right');

    await expect(page.locator('[data-testid="scroll-header-menu"]')).toBeVisible();
    await expect(page.locator('[data-testid="move-scroll-left"]')).toBeEnabled();
    await expect(page.locator('[data-testid="move-scroll-right"]')).toBeDisabled();

    await page.keyboard.press('Escape');

    const viaColumn = await runBridge(page, 'move_scroll', {
      scrollId: ids.midId,
      toColumn: 0,
    });
    expect(viaColumn.fromColumn).toBe(1);
    expect(viaColumn.toColumn).toBe(0);
    expect(viaColumn.scrollId).toBe(ids.midId);

    const listed = await runBridge(page, 'list_scrolls');
    expect(listed.scrolls.map((s: { title: string }) => s.title)).toEqual([
      'Middle',
      'Left',
      'Right',
    ]);
  });
});
