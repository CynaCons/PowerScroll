/**
 * Test 139: Double-tap opens text editing on touch
 *
 * Covers: REQ-TEXT-032 — a Konva 'dbltap' (touch double-tap) on a text
 * block enters inline edit mode, the same as a desktop double-click
 * (REQ-TEXT-003).
 *
 * Konva only synthesizes 'dbltap' from real TouchEvents (touchstart/
 * touchend) — a PointerEvent with pointerType 'touch' resolves through
 * Konva's separate 'pointer' event family ('pointerdblclick'), which
 * TextNode does not listen for. So this dispatches actual TouchEvents,
 * mirroring tests/draw/136-touch-palm-rejection.spec.ts's touchEvent
 * helper, with each touchstart/touchend in its own page.evaluate call so
 * React re-renders between them.
 */
import { test, expect } from '@playwright/test';
import { textEditor, waitForCanvasReady, disableFSA } from '../helpers';

type Pt = { x: number; y: number };

/** Dispatch a single touchstart or touchend at a canvas-relative position. */
async function touchTap(
  page: import('@playwright/test').Page,
  type: 'touchstart' | 'touchend',
  pos: Pt,
  identifier = 1,
) {
  await page.evaluate(
    ({ type, pos, identifier }) => {
      const canvas = document.querySelector(
        '[data-testid="canvas-container"] canvas',
      ) as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const touch = new Touch({
        identifier,
        target: canvas,
        clientX: rect.left + pos.x,
        clientY: rect.top + pos.y,
      });
      const touches = type === 'touchstart' ? [touch] : [];
      canvas.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          touches,
          targetTouches: touches,
          changedTouches: [touch],
        }),
      );
    },
    { type, pos, identifier },
  );
}

/** One finger tap: touchstart immediately followed by touchend. */
async function tap(page: import('@playwright/test').Page, pos: Pt) {
  await touchTap(page, 'touchstart', pos);
  await touchTap(page, 'touchend', pos);
}

test.describe('139 - Double-tap text edit (REQ-TEXT-032)', () => {
  test.use({ viewport: { width: 900, height: 700 }, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await disableFSA(page);
    await page.goto('/');
    await waitForCanvasReady(page);
    // Text node at a known position so the tap coordinates are predictable
    // (default viewport is x:0, y:0, scale:1 — see useCanvasStore).
    await page.evaluate(() => {
      const stores = (window as any).__POWERNOTE_STORES__;
      stores.canvas.getState().addNode({
        id: 'dbltap-text-node',
        type: 'text',
        x: 200,
        y: 200,
        width: 120,
        height: 30,
        layer: 3,
        data: { text: 'Tap me', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#1a1a1a' },
      });
      stores.tool.getState().setTool('select');
    });
    await page.waitForTimeout(100);
  });

  test('double-tap on a text node opens the editor overlay', async ({ page }) => {
    await expect(textEditor(page)).toHaveCount(0);

    // Center of the node's hit area: Group at (200,200), invisible Rect
    // padded -4..width+4/-4..height+4 (see TextNode.tsx).
    await tap(page, { x: 260, y: 215 });
    await tap(page, { x: 260, y: 215 });

    await expect(textEditor(page)).toBeVisible();

    const selected = await page.evaluate(
      () => (window as any).__POWERNOTE_STORES__.canvas.getState().selectedNodeIds,
    );
    expect(selected).toContain('dbltap-text-node');
  });

  test('two taps far apart in time do not open the editor (not a double-tap)', async ({ page }) => {
    await tap(page, { x: 260, y: 215 });
    // Outside Konva's dblClickWindow (400ms)
    await page.waitForTimeout(600);
    await tap(page, { x: 260, y: 215 });

    await expect(textEditor(page)).toHaveCount(0);
  });

  test('a single tap selects but does not open the editor', async ({ page }) => {
    await tap(page, { x: 260, y: 215 });
    await page.waitForTimeout(100);

    await expect(textEditor(page)).toHaveCount(0);
    const selected = await page.evaluate(
      () => (window as any).__POWERNOTE_STORES__.canvas.getState().selectedNodeIds,
    );
    expect(selected).toContain('dbltap-text-node');
  });
});
