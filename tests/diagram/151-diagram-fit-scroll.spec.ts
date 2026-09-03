/**
 * Test 151: Diagrams fit the scroll they land in
 * Covers: REQ-DIAG-136..139, REQ-HIER-018
 *
 * A diagram created into a scroll band is scaled at placement so it does
 * not spill into the neighbouring band. Below the 0.45× floor it places at
 * the floor and warns. Out-of-band placement is untouched. Redraw refits.
 * "Fit scroll to content" on the header is the explicit inverse.
 */
import { test, expect } from '@playwright/test';
import {
  getCanvasStore,
  getWorkspaceStore,
  waitForCanvasReady,
  waitForBridgeReady,
  runBridge,
  preloadModule,
} from '../helpers';

function mxfile(cells: string): string {
  return `<mxfile host="app.diagrams.net">
  <diagram name="Page-1" id="page1">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cells}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}

function vertex(
  id: string,
  geo: { x: number; y: number; w: number; h: number },
  value: string,
): string {
  return `<mxCell id="${id}" value="${value}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
    <mxGeometry x="${geo.x}" y="${geo.y}" width="${geo.w}" height="${geo.h}" as="geometry"/>
  </mxCell>`;
}

/** Wide enough to scale on an A4 band, still above the 0.45 floor. */
const WIDE = mxfile(
  vertex('a', { x: 0, y: 0, w: 160, h: 60 }, 'Left') +
    vertex('b', { x: 1000, y: 0, w: 160, h: 60 }, 'Right'),
);

/** Far past the floor: 0.45 × this still overflows an A4 band. */
const ABSURD = mxfile(
  vertex('a', { x: 0, y: 0, w: 160, h: 60 }, 'Left') +
    vertex('b', { x: 8000, y: 0, w: 160, h: 60 }, 'Right'),
);

async function nameDefaultScroll(page: import('@playwright/test').Page, title: string) {
  await page.evaluate((name) => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const scroll = ws.getActivePage()?.scrolls?.[0];
    if (!scroll) throw new Error('no default scroll');
    ws.renameScroll(ws.activePageId, scroll.id, name);
  }, title);
}

function bandRight(members: { x: number; width: number }[], frame: { x: number; width: number }) {
  let right = frame.x + frame.width;
  for (const m of members) right = Math.max(right, m.x + Math.abs(m.width || 0));
  return right;
}

test.describe('151 - Diagrams fit the scroll they land in (REQ-DIAG-136..139, REQ-HIER-018)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await waitForBridgeReady(page);
  });

  test('create_diagram in a band scales members to the band x-range and warns', async ({ page }) => {
    await nameDefaultScroll(page, 'Backend');

    // render:'nodes' — the member-scaling contract under test predates the
    // v0.64 snapshot default (snapshot fit is covered by T179).
    const result = await runBridge(page, 'create_diagram', {
      source: WIDE,
      title: 'Wide pipeline',
      format: 'drawio',
      render: 'nodes',
    });

    expect(result.warnings?.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('Backend');
    expect(result.warnings[0]).toMatch(/scaled to /);

    const store = await getCanvasStore(page);
    const frame = store.nodes.find((n: any) => n.id === result.diagramId);
    const members = store.nodes.filter((n: any) => n.groupId === result.diagramId && n.id !== frame.id);
    expect(members.length).toBeGreaterThan(0);

    await preloadModule(page, '/src/utils/pageLayout.ts');
    const layout = await page.evaluate(async () => {
      const m = (window as any).__mods['/src/utils/pageLayout.ts'];
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
      const scrolls = ws.getActivePage()?.scrolls;
      return {
        left: m.columnLeft(0, scrolls),
        width: m.columnWidth(0, scrolls),
      };
    });
    const right = layout.left + layout.width;
    expect(frame.x).toBeGreaterThanOrEqual(layout.left - 0.5);
    expect(frame.x + frame.width).toBeLessThanOrEqual(right + 0.5);
    expect(bandRight(members, frame)).toBeLessThanOrEqual(right + 0.5);
  });

  test('below-floor places at 0.45 and names scroll + scale + requested width', async ({ page }) => {
    await nameDefaultScroll(page, 'Backend');

    const result = await runBridge(page, 'create_diagram', {
      source: ABSURD,
      title: 'Too wide',
      format: 'drawio',
      render: 'nodes',
    });

    expect(result.warnings?.length).toBeGreaterThan(0);
    const warning = result.warnings[0] as string;
    expect(warning).toContain('Backend');
    expect(warning).toContain('0.45');
    expect(warning).toMatch(/requested width \d+px/);

    const store = await getCanvasStore(page);
    const frame = store.nodes.find((n: any) => n.id === result.diagramId);
    await preloadModule(page, '/src/diagram/canvasOps.ts');
    const raw = await page.evaluate(async ({ source }) => {
      const ops = (window as any).__mods['/src/diagram/canvasOps.ts'];
      const built = ops.rebuildDiagram(
        { id: 'probe', type: 'diagram', x: 60, y: 48, width: 260, height: 120, layer: 2, groupId: 'probe', data: { source, title: 'probe' } },
        source,
        'drawio',
      );
      return built.frame.width;
    }, { source: ABSURD });
    expect(frame.width).toBeCloseTo(raw * 0.45, 0);
  });

  test('diagram placed outside any band is left unfitted', async ({ page }) => {
    await preloadModule(page, '/src/diagram/canvasOps.ts');
    await preloadModule(page, '/src/utils/pageLayout.ts');
    const compared = await page.evaluate(async ({ source }) => {
      const ops = (window as any).__mods['/src/diagram/canvasOps.ts'];
      const layout = (window as any).__mods['/src/utils/pageLayout.ts'];
      const farX = layout.columnLeft(4);
      const frame = {
        id: 'out',
        type: 'diagram' as const,
        x: farX,
        y: 80,
        width: 260,
        height: 120,
        layer: 2,
        groupId: 'out',
        data: { source, title: 'Out of band' },
      };
      const raw = ops.rebuildDiagram(frame, source, 'drawio');
      const placed = ops.placeDiagramOnCanvas({
        x: farX,
        y: 80,
        source,
        title: 'Out of band',
        format: 'drawio',
      });
      const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
      const live = canvas.nodes.find((n: any) => n.id === placed.frameId);
      return {
        placed: placed.placed,
        warning: placed.warning ?? null,
        rawWidth: raw.frame.width,
        liveWidth: live?.width,
        rawCount: raw.contents.length,
        liveCount: placed.elementCount,
      };
    }, { source: WIDE });

    expect(compared.placed).toBe(true);
    expect(compared.warning).toBeNull();
    expect(compared.liveWidth).toBe(compared.rawWidth);
    expect(compared.liveCount).toBe(compared.rawCount);
  });

  test('redraw (rebuildDiagram) refits a frame sitting in a band', async ({ page }) => {
    await nameDefaultScroll(page, 'Backend');

    await preloadModule(page, '/src/diagram/canvasOps.ts');
    await preloadModule(page, '/src/utils/pageLayout.ts');
    const outcome = await page.evaluate(async ({ source }) => {
      const ops = (window as any).__mods['/src/diagram/canvasOps.ts'];
      const layout = (window as any).__mods['/src/utils/pageLayout.ts'];
      const canvas = (window as any).__POWERNOTE_STORES__.canvas;
      const x = layout.columnLeft(0);
      const frame = {
        id: 'legacy',
        type: 'diagram' as const,
        x,
        y: 80,
        width: 260,
        height: 120,
        layer: 2,
        groupId: 'legacy',
        data: { source, title: 'Legacy' },
      };
      const raw = ops.rebuildDiagram(frame, source, 'drawio');
      canvas.getState().addNode({ ...frame, width: raw.frame.width, height: raw.frame.height });
      for (const n of raw.contents) canvas.getState().addNode(n);

      const beforeWidth = raw.frame.width;
      const fitted = ops.applyDiagramScrollFit(frame, raw);
      for (const m of ops.diagramMembers(canvas.getState().nodes, 'legacy')) {
        canvas.getState().deleteNode(m.id);
      }
      for (const n of fitted.contents) canvas.getState().addNode(n);
      canvas.getState().updateNode('legacy', { width: fitted.frame.width, height: fitted.frame.height });

      const bandW = layout.columnWidth(0);
      return {
        beforeWidth,
        afterWidth: fitted.frame.width,
        scale: fitted.scale,
        warning: fitted.warning ?? null,
        bandW,
      };
    }, { source: WIDE });

    expect(outcome.beforeWidth).toBeGreaterThan(outcome.bandW);
    expect(outcome.afterWidth).toBeLessThanOrEqual(outcome.bandW);
    expect(outcome.scale).toBeLessThan(1);
    expect(outcome.warning).toContain('Backend');
  });

  test('Fit scroll to content widens the band, shifts the right-hand scroll, one undo restores both', async ({ page }) => {
    await nameDefaultScroll(page, 'Backend');
    await page.evaluate(() => {
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
      ws.createScroll(ws.activePageId, 'Frontend');
    });

    await preloadModule(page, '/src/utils/pageLayout.ts');
    const before = await page.evaluate(async () => {
      const layout = (window as any).__mods['/src/utils/pageLayout.ts'];
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
      const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
      const scrolls = ws.getActivePage().scrolls;
      const left = layout.columnLeft(0, scrolls);
      const rightLeft = layout.columnLeft(1, scrolls);
      canvas.addNode({
        id: 'legacy-frame',
        type: 'diagram',
        x: left,
        y: 80,
        width: 1400,
        height: 200,
        layer: 2,
        groupId: 'legacy-frame',
        data: { source: '', title: 'Legacy overflow' },
      });
      canvas.addNode({
        id: 'legacy-member',
        type: 'shape',
        x: left + 1200,
        y: 120,
        width: 160,
        height: 60,
        layer: 3,
        groupId: 'legacy-frame',
        data: { shapeType: 'rect', fill: '#eef1f0', stroke: '#14181a', strokeWidth: 1.6, strokeDash: [] },
      });
      canvas.addNode({
        id: 'front-block',
        type: 'text',
        x: rightLeft,
        y: 80,
        width: 200,
        height: 40,
        layer: 4,
        data: { text: 'Frontend notes', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#111' },
      });
      return {
        pageId: ws.activePageId,
        backendId: scrolls.find((s: any) => s.column === 0).id,
        frontX: rightLeft,
        bandW: layout.columnWidth(0, scrolls),
      };
    });

    await preloadModule(page, '/src/utils/scrollOps.ts');
    await preloadModule(page, '/src/utils/pageLayout.ts');
    const fitted = await page.evaluate(async ({ pageId, backendId }) => {
      const ops = (window as any).__mods['/src/utils/scrollOps.ts'];
      const layout = (window as any).__mods['/src/utils/pageLayout.ts'];
      const result = ops.fitScrollToContent(pageId, backendId);
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
      const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
      const scrolls = ws.getActivePage().scrolls;
      const front = canvas.nodes.find((n: any) => n.id === 'front-block');
      const backend = scrolls.find((s: any) => s.id === backendId);
      return {
        result,
        backendWidth: backend?.width,
        frontX: front?.x,
        col1Left: layout.columnLeft(1, scrolls),
      };
    }, before);

    expect(fitted.result).not.toBeNull();
    expect(fitted.result!.delta).toBeGreaterThan(0);
    expect(fitted.backendWidth).toBe(fitted.result!.width);
    expect(fitted.backendWidth).toBeGreaterThan(before.bandW);
    expect(fitted.frontX).toBeCloseTo(before.frontX + fitted.result!.delta, 5);
    expect(fitted.col1Left).toBeCloseTo(before.frontX + fitted.result!.delta, 5);

    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.canvas.getState().undo();
    });

    await preloadModule(page, '/src/utils/pageLayout.ts');
    const restored = await page.evaluate(async ({ backendId }) => {
      const layout = (window as any).__mods['/src/utils/pageLayout.ts'];
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
      const canvas = (window as any).__POWERNOTE_STORES__.canvas.getState();
      const scrolls = ws.getActivePage().scrolls;
      const backend = scrolls.find((s: any) => s.id === backendId);
      const front = canvas.nodes.find((n: any) => n.id === 'front-block');
      return {
        backendWidth: backend?.width,
        frontX: front?.x,
        col1Left: layout.columnLeft(1, scrolls),
      };
    }, before);

    expect(restored.backendWidth === undefined || restored.backendWidth === 794).toBe(true);
    expect(restored.frontX).toBeCloseTo(before.frontX, 5);
    expect(restored.col1Left).toBeCloseTo(before.frontX, 5);
  });
});
