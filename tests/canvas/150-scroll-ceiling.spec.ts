/**
 * Test 150: Scrolls share a ceiling
 * Covers: REQ-HIER-017, REQ-CANVAS-030
 *
 * On a page with ≥1 scroll the workspace top is y=0 by convention (derived,
 * never stored). The camera cannot pan above the ceiling, placement lands on
 * it, and titled scrolls rest as one aligned row at it. Pages with no scroll
 * records stay fully infinite.
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady, clickCanvas, preloadModule } from '../helpers';

/** Dispatch a pointer stroke on the Konva canvas (same path as T135). */
async function pointerStroke(
  page: import('@playwright/test').Page,
  opts: {
    pointerType: 'pen' | 'mouse' | 'touch';
    pointerId?: number;
    from: { x: number; y: number };
    to: { x: number; y: number };
    steps?: number;
  },
) {
  await page.evaluate((o) => {
    const canvas = document.querySelector(
      '[data-testid="canvas-container"] canvas',
    ) as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const steps = o.steps ?? 8;
    const id = o.pointerId ?? 100;
    const ev = (type: string, x: number, y: number, buttons: number) =>
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: id,
        pointerType: o.pointerType,
        isPrimary: true,
        clientX: rect.left + x,
        clientY: rect.top + y,
        pressure: 0.5,
        buttons,
      });
    canvas.dispatchEvent(ev('pointerdown', o.from.x, o.from.y, 1));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      canvas.dispatchEvent(
        ev(
          'pointermove',
          o.from.x + (o.to.x - o.from.x) * t,
          o.from.y + (o.to.y - o.from.y) * t,
          1,
        ),
      );
    }
    canvas.dispatchEvent(ev('pointerup', o.to.x, o.to.y, 0));
  }, opts);
}

async function touchEvent(
  page: import('@playwright/test').Page,
  type: 'touchstart' | 'touchmove' | 'touchend',
  points: { x: number; y: number }[],
  lifted: { x: number; y: number }[] = [],
) {
  await page.evaluate(
    ({ type, points, lifted }) => {
      const canvas = document.querySelector(
        '[data-testid="canvas-container"] canvas',
      ) as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const mk = (p: { x: number; y: number }, i: number) =>
        new Touch({
          identifier: i + 1,
          target: canvas,
          clientX: rect.left + p.x,
          clientY: rect.top + p.y,
        });
      const touches = points.map(mk);
      const changed = (lifted.length > 0 ? lifted : points).map(mk);
      canvas.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          touches,
          targetTouches: touches,
          changedTouches: changed,
        }),
      );
    },
    { type, points, lifted },
  );
}

async function stagePos(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const Konva = (window as any).Konva;
    const stage = Konva.stages[0];
    const vp = (window as any).__POWERNOTE_STORES__.canvas.getState().viewport;
    return { stageY: stage.y(), stageX: stage.x(), scale: stage.scaleX(), storeY: vp.y, storeScale: vp.scale };
  });
}

/** Wipe scroll records so the page is fully infinite (the no-clamp case). */
async function clearScrolls(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace;
    const state = ws.getState();
    const pageId = state.activePageId;
    ws.setState({
      workspace: {
        ...state.workspace,
        sections: state.workspace.sections.map((sec: any) => ({
          ...sec,
          pages: sec.pages.map((p: any) =>
            p.id === pageId ? { ...p, scrolls: [] } : p,
          ),
        })),
      },
    });
  });
}

/**
 * Park the camera above y=0 while there are no scrolls, then put a scroll
 * back. The next click/stroke at a mid-viewport screen y aims above the
 * ceiling without the camera clamp fighting the setup.
 */
async function parkCameraAboveThenRestoreScroll(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const S = (window as any).__POWERNOTE_STORES__;
    const ws = S.workspace;
    const state = ws.getState();
    const pageId = state.activePageId;
    ws.setState({
      workspace: {
        ...state.workspace,
        sections: state.workspace.sections.map((sec: any) => ({
          ...sec,
          pages: sec.pages.map((p: any) =>
            p.id === pageId ? { ...p, scrolls: [] } : p,
          ),
        })),
      },
    });
    S.canvas.getState().setViewport({ x: 0, y: 250, scale: 1 });
    ws.getState().createScroll(pageId, 'Ceiling');
  });
}

const SIMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20">
  <rect x="0" y="0" width="40" height="20" fill="#eef1f0"/>
</svg>`;

test.describe('150 - Scroll ceiling (REQ-HIER-017, REQ-CANVAS-030)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await preloadModule(page, '/src/utils/scrollCeiling.ts');
  });

  test('pageCeiling: null without scrolls, 0 by default, adapts to legacy negative y', async ({
    page,
  }) => {
    const r = await page.evaluate(() => {
      const { pageCeiling, CEILING_PAD } = (window as any).__mods[
        '/src/utils/scrollCeiling.ts'
      ];
      const titled = { id: 's', title: 'S' };
      return {
        none: pageCeiling([], [], []),
        // Every page is BORN with one untitled scroll (agent append target),
        // so the gate is titled scrolls — presence alone must not clamp.
        untitled: pageCeiling([{ y: 120 }], [], [{ id: 's', title: '' }]),
        empty: pageCeiling([], [], [titled]),
        below: pageCeiling([{ y: 120 }], [], [titled]),
        legacy: pageCeiling([{ y: -400 }], [], [titled]),
        stroke: pageCeiling([], [{ points: [10, -200, 20, -180] }], [titled]),
        pad: CEILING_PAD,
      };
    });
    expect(r.none).toBeNull();
    expect(r.untitled).toBeNull();
    expect(r.empty).toBe(0);
    expect(r.below).toBe(0);
    expect(r.legacy).toBe(-400 - r.pad);
    expect(r.stroke).toBe(-200 - r.pad);
  });

  test('page with a scroll: wheel / setViewport / pinch cannot pan above the ceiling', async ({
    page,
  }) => {
    // The birth scroll is untitled and must not clamp — title it to arm the
    // ceiling. The camera leaves the 64px screen-space card strip above it.
    await page.evaluate(() => {
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
      ws.renameScroll(ws.activePageId, ws.getActivePage().scrolls[0].id, 'Main');
    });
    const HEADROOM = 64;
    const before = await stagePos(page);
    expect(before.stageY).toBeCloseTo(0, 5);

    const canvas = page.locator('[data-testid="canvas-container"]');
    await canvas.hover({ position: { x: 400, y: 300 } });
    // Scroll-up (negative deltaY) is the wheel that tries to raise stage.y.
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(80);

    const afterWheel = await stagePos(page);
    expect(afterWheel.stageY).toBeLessThanOrEqual(HEADROOM + 0.5);
    expect(afterWheel.storeY).toBeLessThanOrEqual(HEADROOM + 0.5);

    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ y: 600 });
    });
    const afterSet = await stagePos(page);
    expect(afterSet.stageY).toBeLessThanOrEqual(HEADROOM + 0.5);
    expect(afterSet.storeY).toBeLessThanOrEqual(HEADROOM + 0.5);

    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: 0, scale: 1 });
    });
    // Two fingers translating downward raise stage.y (canvas follows the hand).
    await touchEvent(page, 'touchstart', [
      { x: 300, y: 280 },
      { x: 500, y: 280 },
    ]);
    await touchEvent(page, 'touchmove', [
      { x: 300, y: 280 },
      { x: 500, y: 280 },
    ]);
    await touchEvent(page, 'touchmove', [
      { x: 300, y: 380 },
      { x: 500, y: 380 },
    ]);
    await touchEvent(page, 'touchend', [], [
      { x: 300, y: 380 },
      { x: 500, y: 380 },
    ]);
    const afterPinch = await stagePos(page);
    expect(afterPinch.stageY).toBeLessThanOrEqual(64 + 0.5);
  });

  test('page without scrolls pans freely upward (regression)', async ({ page }) => {
    await clearScrolls(page);
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: 0, scale: 1 });
    });

    const canvas = page.locator('[data-testid="canvas-container"]');
    await canvas.hover({ position: { x: 400, y: 300 } });
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(80);

    const after = await stagePos(page);
    expect(after.stageY).toBeGreaterThan(50);
    expect(after.storeY).toBeGreaterThan(50);

    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ y: 800 });
    });
    const set = await stagePos(page);
    expect(set.storeY).toBeCloseTo(800, 5);
    expect(set.stageY).toBeCloseTo(800, 5);
  });

  test('legacy node at y=-400 stays reachable; ceiling adapts', async ({ page }) => {
    const derived = await page.evaluate(() => {
      const S = (window as any).__POWERNOTE_STORES__;
      const ws0 = S.workspace.getState();
      ws0.renameScroll(ws0.activePageId, ws0.getActivePage().scrolls[0].id, 'Main');
      S.canvas.getState().addNode({
        id: 'legacy-above',
        type: 'text',
        x: 80,
        y: -400,
        width: 120,
        height: 30,
        layer: 4,
        data: { text: 'legacy', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#1a1a1a' },
      });
      const { pageCeiling, CEILING_PAD } = (window as any).__mods[
        '/src/utils/scrollCeiling.ts'
      ];
      const ws = S.workspace.getState();
      const ceiling = pageCeiling(
        S.canvas.getState().nodes,
        S.draw.getState().strokes,
        ws.getActivePage()?.scrolls,
      );
      S.canvas.getState().setViewport({ x: 0, y: 400, scale: 1 });
      const vp = S.canvas.getState().viewport;
      return { ceiling, pad: CEILING_PAD, y: vp.y };
    });

    expect(derived.ceiling).not.toBeNull();
    expect(derived.ceiling!).toBeLessThanOrEqual(-400 - derived.pad);
    // Camera can sit such that y=-400 is in view.
    expect(derived.y).toBeGreaterThanOrEqual(400 - 1);
  });

  test('placement clamp: pen stroke, text click, and drop land at the ceiling', async ({
    page,
  }) => {
    await parkCameraAboveThenRestoreScroll(page);
    const ceiling = await page.evaluate(() => {
      const { pageCeiling } = (window as any).__mods[
        '/src/utils/scrollCeiling.ts'
      ];
      const S = (window as any).__POWERNOTE_STORES__;
      return pageCeiling(
        S.canvas.getState().nodes,
        S.draw.getState().strokes,
        S.workspace.getState().getActivePage()?.scrolls,
      );
    });
    expect(ceiling).toBe(0);

    // Pen: screen y=80 with stage.y=250 → canvas y=-170, must clamp to 0.
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setTool('draw');
    });
    await pointerStroke(page, {
      pointerType: 'pen',
      from: { x: 300, y: 80 },
      to: { x: 420, y: 110 },
      steps: 8,
    });
    const strokeYs = await page.evaluate(() => {
      const strokes = (window as any).__POWERNOTE_STORES__.draw.getState().strokes;
      const ys: number[] = [];
      for (const s of strokes) {
        for (let i = 1; i < s.points.length; i += 2) ys.push(s.points[i]);
      }
      return ys;
    });
    expect(strokeYs.length).toBeGreaterThan(0);
    expect(Math.min(...strokeYs)).toBeGreaterThanOrEqual(ceiling!);

    // A committed stroke at the ceiling adapts the derived top (0 − PAD).
    // Capture the live ceiling immediately before each later placement.
    const ceilingBeforeText = await page.evaluate(() => {
      const { pageCeiling } = (window as any).__mods[
        '/src/utils/scrollCeiling.ts'
      ];
      const S = (window as any).__POWERNOTE_STORES__;
      return pageCeiling(
        S.canvas.getState().nodes,
        S.draw.getState().strokes,
        S.workspace.getState().getActivePage()?.scrolls,
      );
    });

    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setTool('text');
    });
    await clickCanvas(page, 500, 90);
    await page.waitForTimeout(150);
    const textY = await page.evaluate(() => {
      const nodes = (window as any).__POWERNOTE_STORES__.canvas.getState().nodes;
      const text = [...nodes].reverse().find((n: any) => n.type === 'text');
      return text?.y ?? null;
    });
    expect(textY).not.toBeNull();
    expect(textY!).toBeGreaterThanOrEqual(ceilingBeforeText!);
    // Unclamped screen y=90 with stage.y=250 is canvas y=-160. Must not stay there.
    expect(textY!).toBeGreaterThan(-100);

    const ceilingBeforeDrop = await page.evaluate(() => {
      const { pageCeiling } = (window as any).__mods[
        '/src/utils/scrollCeiling.ts'
      ];
      const S = (window as any).__POWERNOTE_STORES__;
      return pageCeiling(
        S.canvas.getState().nodes,
        S.draw.getState().strokes,
        S.workspace.getState().getActivePage()?.scrolls,
      );
    });
    const beforeIds = await page.evaluate(() =>
      (window as any).__POWERNOTE_STORES__.canvas.getState().nodes.map((n: any) => n.id),
    );
    await page.evaluate(
      ({ svg, offset }) => {
        const container = document.querySelector(
          '[data-testid="canvas-container"]',
        ) as HTMLElement;
        const rect = container.getBoundingClientRect();
        const f = new File([svg], 'above.svg', { type: 'image/svg+xml' });
        const dt = new DataTransfer();
        dt.items.add(f);
        const ev = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + offset.x,
          clientY: rect.top + offset.y,
        });
        Object.defineProperty(ev, 'dataTransfer', { value: dt });
        container.dispatchEvent(ev);
      },
      { svg: SIMPLE_SVG, offset: { x: 280, y: 70 } },
    );
    await page.waitForFunction(
      (ids: string[]) =>
        (window as any).__POWERNOTE_STORES__.canvas
          .getState()
          .nodes.some((n: any) => !ids.includes(n.id)),
      beforeIds,
    );
    const dropY = await page.evaluate((ids: string[]) => {
      const nodes = (window as any).__POWERNOTE_STORES__.canvas.getState().nodes;
      const added = nodes.find((n: any) => !ids.includes(n.id));
      return added?.y ?? null;
    }, beforeIds);
    expect(dropY).not.toBeNull();
    expect(dropY!).toBeGreaterThanOrEqual(ceilingBeforeDrop!);
    expect(dropY!).toBeGreaterThan(-100);
  });

  test('two scroll title cards rest on the same ceiling row', async ({ page }) => {
    await page.evaluate(() => {
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
      const pageRec = ws.getActivePage();
      const first = pageRec.scrolls[0];
      ws.renameScroll(ws.activePageId, first.id, 'Alpha');
      ws.createScroll(ws.activePageId, 'Beta');
      (window as any).__POWERNOTE_STORES__.canvas.getState().setViewport({ x: 0, y: 0, scale: 1 });
    });

    const cards = page.getByTestId('scroll-header-card');
    await expect(cards).toHaveCount(2);
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.y).toBeCloseTo(second!.y, 1);
    expect(first!.height).toBe(44);
  });

  test('clamp is zoom-aware at scale 0.5 and 2.0', async ({ page }) => {
    const result = await page.evaluate(() => {
      const S = (window as any).__POWERNOTE_STORES__;
      const ws0 = S.workspace.getState();
      ws0.renameScroll(ws0.activePageId, ws0.getActivePage().scrolls[0].id, 'Main');
      S.canvas.getState().addNode({
        id: 'zoom-legacy',
        type: 'text',
        x: 80,
        y: -400,
        width: 120,
        height: 30,
        layer: 4,
        data: { text: 'legacy', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#1a1a1a' },
      });
      const { pageCeiling, clampStageY } = (window as any).__mods[
        '/src/utils/scrollCeiling.ts'
      ];
      const ceiling = pageCeiling(
        S.canvas.getState().nodes,
        S.draw.getState().strokes,
        S.workspace.getState().getActivePage()?.scrolls,
      );

      const Konva = (window as any).Konva;
      S.canvas.getState().setViewport({ x: 0, y: 0, scale: 0.5 });
      S.canvas.getState().setViewport({ y: 9999 });
      const atHalf = S.canvas.getState().viewport;
      const halfExpected = clampStageY({ y: () => 9999, scaleX: () => 0.5 }, ceiling);
      const halfStageY = Konva.stages[0].y();

      S.canvas.getState().setViewport({ x: 0, y: 0, scale: 2 });
      S.canvas.getState().setViewport({ y: 9999 });
      const atDouble = S.canvas.getState().viewport;
      const doubleExpected = clampStageY({ y: () => 9999, scaleX: () => 2 }, ceiling);
      const doubleStageY = Konva.stages[0].y();

      return {
        ceiling,
        atHalf: { y: atHalf.y, scale: atHalf.scale, expected: halfExpected, stageY: halfStageY },
        atDouble: { y: atDouble.y, scale: atDouble.scale, expected: doubleExpected, stageY: doubleStageY },
      };
    });

    const HEADROOM = 64;
    expect(result.ceiling).not.toBeNull();
    expect(result.atHalf.y).toBeCloseTo(result.atHalf.expected, 5);
    expect(result.atHalf.y).toBeCloseTo(
      HEADROOM - (result.ceiling as number) * 0.5,
      5,
    );
    expect(result.atHalf.stageY).toBeCloseTo(result.atHalf.expected, 5);
    expect(result.atDouble.y).toBeCloseTo(result.atDouble.expected, 5);
    expect(result.atDouble.stageY).toBeCloseTo(result.atDouble.expected, 5);
    expect(result.atDouble.y).toBeCloseTo(
      HEADROOM - (result.ceiling as number) * 2,
      5,
    );
    // The ceiling's canvas distance still scales, while the card strip does not.
    expect(result.atDouble.y).toBeGreaterThan(result.atHalf.y);
  });
});
