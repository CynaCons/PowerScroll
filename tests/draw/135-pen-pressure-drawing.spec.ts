/**
 * Test 135: Pen input — pointer pipeline, pressure ink, stylus eraser
 *
 * Covers: REQ-DRAW-010 (pointer events carry pen/mouse/touch into the draw
 * tools, one stroke per contact), REQ-DRAW-011 (stylus pressure recorded
 * per point and rendered as a variable-width outline; mouse strokes use
 * simulated pressure), REQ-DRAW-014 (the stylus eraser end erases while held).
 *
 * Strokes are driven by dispatching PointerEvents at the Konva content —
 * Konva 10 routes DOM pointer events through its own event system
 * (Konva.pointerEventsEnabled defaults to true), so a synthetic pen event
 * exercises exactly the path a real S Pen / Surface pen takes.
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady, disableFSA } from '../helpers';

/** Dispatch a full pointer stroke (down → moves → up) inside the page. */
async function pointerStroke(
  page: import('@playwright/test').Page,
  opts: {
    pointerType: 'pen' | 'mouse' | 'touch';
    pointerId?: number;
    from: { x: number; y: number };
    to: { x: number; y: number };
    steps?: number;
    pressures?: number[];
    buttons?: number;
  },
) {
  await page.evaluate((o) => {
    const canvas = document.querySelector(
      '[data-testid="canvas-container"] canvas',
    ) as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const steps = o.steps ?? 10;
    const id = o.pointerId ?? 100;
    const buttons = o.buttons ?? 1;
    const ev = (type: string, x: number, y: number, pressure: number, b: number) =>
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: id,
        pointerType: o.pointerType,
        isPrimary: true,
        clientX: rect.left + x,
        clientY: rect.top + y,
        pressure,
        buttons: b,
      });
    const pAt = (i: number) =>
      o.pressures ? o.pressures[Math.min(i, o.pressures.length - 1)] : 0.5;
    canvas.dispatchEvent(ev('pointerdown', o.from.x, o.from.y, pAt(0), buttons));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      canvas.dispatchEvent(
        ev(
          'pointermove',
          o.from.x + (o.to.x - o.from.x) * t,
          o.from.y + (o.to.y - o.from.y) * t,
          pAt(i),
          buttons,
        ),
      );
    }
    canvas.dispatchEvent(ev('pointerup', o.to.x, o.to.y, 0, 0));
  }, opts);
}

test.describe('135 - Pen pressure drawing (REQ-DRAW-010/011/014)', () => {
  test.beforeEach(async ({ page }) => {
    await disableFSA(page);
    await page.goto('/');
    await waitForCanvasReady(page);
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setTool('draw');
    });
  });

  test('a pen stroke records per-point pressure and marks the pen as seen', async ({ page }) => {
    await pointerStroke(page, {
      pointerType: 'pen',
      from: { x: 300, y: 300 },
      to: { x: 460, y: 340 },
      steps: 12,
      pressures: [0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.85, 0.7, 0.5, 0.4],
    });

    const result = await page.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      const strokes = stores.draw.getState().strokes;
      return {
        count: strokes.length,
        points: strokes[0]?.points.length,
        pressures: strokes[0]?.pressures,
        penDetected: stores.tool.getState().penDetected,
      };
    });

    expect(result.count).toBe(1);
    expect(result.pressures).toBeDefined();
    // One pressure per point, and the values actually vary — a flat array
    // would mean the ribbon renders but pressure was never read.
    expect(result.pressures.length * 2).toBe(result.points);
    expect(Math.max(...result.pressures) - Math.min(...result.pressures)).toBeGreaterThan(0.2);
    expect(result.penDetected).toBe(true);
  });

  test('a pressure stroke renders as a filled freehand outline', async ({ page }) => {
    await pointerStroke(page, {
      pointerType: 'pen',
      from: { x: 300, y: 300 },
      to: { x: 460, y: 300 },
      steps: 10,
      pressures: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.9, 0.8],
    });
    await page.waitForTimeout(100);

    const outline = await page.evaluate(() => {
      const Konva = (window as any).Konva;
      const stage = Konva?.stages?.[0];
      if (!stage) return null;
      const drawLayer = stage.getChildren().find((l: any) => l.name() === 'draw-layer');
      if (!drawLayer) return null;
      return drawLayer.find('.freehand-outline').map((node: any) => ({
        kind: node.getClassName(),
        hasFill: !!node.fill(),
      }));
    });

    expect(outline).not.toBeNull();
    expect(outline!.some((node: any) => node.kind === 'Shape' && node.hasFill)).toBe(true);
  });

  test('a mouse stroke records no pressures', async ({ page }) => {
    await pointerStroke(page, {
      pointerType: 'mouse',
      from: { x: 300, y: 300 },
      to: { x: 420, y: 360 },
      steps: 8,
    });

    const result = await page.evaluate(() => {
      const strokes = (window as any).__POWERNOTE_STORES__.draw.getState().strokes;
      return { count: strokes.length, pressures: strokes[0]?.pressures ?? null };
    });
    expect(result.count).toBe(1);
    expect(result.pressures).toBeNull();
  });

  test('a stray compatibility mousedown does not start a second stroke', async ({ page }) => {
    // Browsers follow a pen contact with synthesized mouse events; the draw
    // pipeline listens to pointer events only, so the compat mousedown must
    // fall on deaf ears rather than opening a second stroke.
    await page.evaluate(() => {
      const canvas = document.querySelector(
        '[data-testid="canvas-container"] canvas',
      ) as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const pe = (type: string, x: number, y: number, pressure: number, buttons: number) =>
        new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true,
          pointerId: 7, pointerType: 'pen', isPrimary: true,
          clientX: rect.left + x, clientY: rect.top + y, pressure, buttons,
        });
      const me = (type: string, x: number, y: number) =>
        new MouseEvent(type, {
          bubbles: true, cancelable: true, composed: true,
          clientX: rect.left + x, clientY: rect.top + y, buttons: 1,
        });
      canvas.dispatchEvent(pe('pointerdown', 200, 200, 0.5, 1));
      canvas.dispatchEvent(me('mousedown', 200, 200)); // compat event
      for (let i = 1; i <= 6; i++) {
        canvas.dispatchEvent(pe('pointermove', 200 + i * 10, 200, 0.5, 1));
        canvas.dispatchEvent(me('mousemove', 200 + i * 10, 200));
      }
      canvas.dispatchEvent(pe('pointerup', 260, 200, 0, 0));
      canvas.dispatchEvent(me('mouseup', 260, 200));
    });

    const count = await page.evaluate(
      () => (window as any).__POWERNOTE_STORES__.draw.getState().strokes.length,
    );
    expect(count).toBe(1);
  });

  test('the stylus eraser end erases while held (REQ-DRAW-014)', async ({ page }) => {
    // Draw with the pen tip…
    await pointerStroke(page, {
      pointerType: 'pen',
      from: { x: 300, y: 300 },
      to: { x: 400, y: 300 },
      steps: 8,
    });
    let count = await page.evaluate(
      () => (window as any).__POWERNOTE_STORES__.draw.getState().strokes.length,
    );
    expect(count).toBe(1);

    // …then flip to the eraser end (buttons bit 32) and rub across it.
    await pointerStroke(page, {
      pointerType: 'pen',
      pointerId: 101,
      from: { x: 340, y: 290 },
      to: { x: 360, y: 310 },
      steps: 6,
      buttons: 32,
    });

    count = await page.evaluate(
      () => (window as any).__POWERNOTE_STORES__.draw.getState().strokes.length,
    );
    // The rubbed stroke is gone, no new ink was laid, and the tool did not
    // flip to eraser mode for the next tip contact.
    expect(count).toBe(0);
    const isErasing = await page.evaluate(
      () => (window as any).__POWERNOTE_STORES__.tool.getState().drawOptions.isErasing,
    );
    expect(isErasing).toBe(false);
  });
});
