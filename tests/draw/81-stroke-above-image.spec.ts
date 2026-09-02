/**
 * Test 81: Strokes render above nodes (REQ-DRAW-009)
 *
 * Konva stacks the Stage's child Layers bottom→top in render order. This
 * test pins that order: PageGuides → nodes → drawings → selection.
 *
 * When the user draws on top of a screenshot, the pen strokes must be
 * visually above the image regardless of the image's `layer` value.
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady, disableFSA } from '../helpers';

const RED_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

test.describe('81 - Strokes render above nodes (REQ-DRAW-009)', () => {
  test.beforeEach(async ({ page }) => {
    await disableFSA(page);
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  test('draw layer sits above node layer in the Konva stage', async ({ page }) => {
    const order = await page.evaluate(() => {
      // Konva keeps the Stage reachable via any node -> getStage()
      const stores = (window as any).__POWERNOTE_STORES__;
      const stage = stores.canvas.getState().stageRef ?? null;
      // Fall back to scanning <canvas> elements if stageRef is null
      const Konva = (window as any).Konva;
      const node = stage || (Konva && Konva.stages && Konva.stages[0]);
      if (!node) return null;
      const children = node.getChildren();
      return children.map((c: any, idx: number) => ({
        idx,
        name: c.name() || null,
        hasDrawGroup: !!c.findOne('.stroke-group') || !!c.findOne('.freehand-outline'),
      }));
    });

    expect(order).not.toBeNull();
    // Expect at least 4 layers (guides, nodes, drawings, selection)
    expect(order!.length).toBeGreaterThanOrEqual(4);
    const drawIdx = order!.findIndex((l) => l.name === 'draw-layer');
    expect(drawIdx).toBeGreaterThan(-1);
    // Draw layer must be above the first two layers (guides + nodes)
    expect(drawIdx).toBeGreaterThanOrEqual(2);
  });

  test('stroke remains visible when drawn over an image with max layer', async ({ page }) => {
    // Put the image on the topmost node layer (5) and a stroke on top —
    // the stroke must still be above it because drawings render on their
    // own Konva layer stacked after all node layers.
    await page.evaluate((src) => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.canvas.getState().addNode({
        id: 'img-top-layer',
        type: 'image',
        x: 200, y: 200,
        width: 200, height: 200,
        layer: 5,
        data: { src, alt: 'bg', naturalWidth: 1, naturalHeight: 1 },
      });
      stores.draw.getState().addStroke({
        id: 'stroke-over-image',
        points: [220, 220, 260, 260, 300, 240, 360, 300],
        color: '#ff00ff',
        strokeWidth: 4,
      });
    }, RED_PIXEL);

    await page.waitForTimeout(200);

    // Inspect the Konva tree: the stroke's outline node must exist on a
    // layer whose index is higher than any layer containing an Image.
    const indices = await page.evaluate(() => {
      const Konva = (window as any).Konva;
      const stage = Konva?.stages?.[0];
      if (!stage) return null;
      const layers: any[] = stage.getChildren().toArray
        ? stage.getChildren().toArray()
        : Array.from(stage.getChildren());
      let imageLayerIdx = -1;
      let strokeLayerIdx = -1;
      layers.forEach((layer, idx) => {
        if (layer.findOne('Image')) imageLayerIdx = Math.max(imageLayerIdx, idx);
        if (layer.findOne('.freehand-outline')) strokeLayerIdx = Math.max(strokeLayerIdx, idx);
      });
      return { imageLayerIdx, strokeLayerIdx };
    });

    expect(indices).not.toBeNull();
    expect(indices!.imageLayerIdx).toBeGreaterThan(-1);
    expect(indices!.strokeLayerIdx).toBeGreaterThan(-1);
    expect(indices!.strokeLayerIdx).toBeGreaterThan(indices!.imageLayerIdx);
  });

  test('stroke pixels show through on top of image', async ({ page }) => {
    await page.evaluate((src) => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.canvas.getState().addNode({
        id: 'img-pixel-test',
        type: 'image',
        x: 100, y: 100,
        width: 200, height: 200,
        layer: 5,
        data: { src, alt: 'bg', naturalWidth: 1, naturalHeight: 1 },
      });
      stores.draw.getState().addStroke({
        id: 'stroke-pixel-test',
        // Long horizontal magenta stroke dead-center on the image
        points: [120, 200, 280, 200],
        color: '#ff00ff',
        strokeWidth: 8,
      });
    }, RED_PIXEL);

    await page.waitForTimeout(300);

    // Sample the stage canvas at the stroke midpoint. Because the image
    // is a solid red pixel scaled up and the stroke is magenta, any
    // non-red reading at that spot proves the stroke rendered on top.
    const sample = await page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll(
        '[data-testid="canvas-container"] canvas',
      )) as HTMLCanvasElement[];
      const sampleAt = 200; // middle of stroke in stage coords ~= viewport coords at scale=1
      for (const c of canvases) {
        const ctx = c.getContext('2d');
        if (!ctx) continue;
        const px = ctx.getImageData(sampleAt, sampleAt, 1, 1).data;
        // If this canvas has a magenta-ish pixel there, we found the stroke.
        if (px[0] > 200 && px[2] > 200 && px[1] < 100) {
          return { r: px[0], g: px[1], b: px[2], a: px[3], matched: true };
        }
      }
      return { matched: false };
    });

    expect(sample.matched).toBe(true);
  });
});
