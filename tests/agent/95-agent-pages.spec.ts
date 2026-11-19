/**
 * Test 95: Agent Page & Section Creation
 * Covers: REQ-AGENT-004, REQ-AGENT-005, REQ-AGENT-006 — An agent can discover
 * the notebook structure and create sections and titled pages.
 *
 * Verifies list_pages reports structure accurately, create_section produces a
 * section with an initial page, and create_page both titles the page and puts
 * a matching H1 block on the canvas.
 */
import { test, expect } from '@playwright/test';
import {
  waitForCanvasReady,
  waitForBridgeReady,
  runBridge,
  getWorkspaceStore,
  getCanvasStore,
} from '../helpers';

test.describe('95 - Agent Pages (REQ-AGENT-004, REQ-AGENT-005, REQ-AGENT-006)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForCanvasReady(page);
    await waitForBridgeReady(page);
  });

  test('list_pages reports sections, pages and the active page', async ({ page }) => {
    const result = await runBridge(page, 'list_pages');

    expect(result.notebook).toBeTruthy();
    expect(Array.isArray(result.pages)).toBe(true);
    expect(result.pages.length).toBeGreaterThan(0);

    const first = result.pages[0];
    expect(first).toHaveProperty('sectionId');
    expect(first).toHaveProperty('pageId');
    expect(first).toHaveProperty('title');
    expect(first).toHaveProperty('blockCount');

    // Exactly one page is active.
    expect(result.pages.filter((p: any) => p.isActive)).toHaveLength(1);
  });

  test('create_section adds a section with an initial page', async ({ page }) => {
    const before = await runBridge(page, 'list_pages');
    const beforeSections = new Set(before.pages.map((p: any) => p.sectionId)).size;

    const created = await runBridge(page, 'create_section', { title: 'Research' });
    expect(created.sectionId).toBeTruthy();
    expect(created.title).toBe('Research');
    expect(created.pageId).toBeTruthy();

    const after = await runBridge(page, 'list_pages');
    expect(new Set(after.pages.map((p: any) => p.sectionId)).size).toBe(beforeSections + 1);

    const { workspace } = await getWorkspaceStore(page);
    const section = workspace.sections.find((s: any) => s.id === created.sectionId);
    expect(section.title).toBe('Research');
    expect(section.pages.length).toBe(1);
  });

  test('create_page titles the page and writes an H1 block onto the canvas', async ({ page }) => {
    const created = await runBridge(page, 'create_page', { title: 'Sprint Plan' });

    expect(created.title).toBe('Sprint Plan');
    expect(created.headingBlockId).toBeTruthy();

    // The owner stays on their page (REQ-AGENT-011); the new page carries the heading block.
    const ws = await getWorkspaceStore(page);
    expect(ws.activePageId).not.toBe(created.pageId);

    const created0 = ws.workspace.sections
      .flatMap((s: any) => s.pages)
      .find((p: any) => p.id === created.pageId);
    const heading = created0.nodes.find((n: any) => n.id === created.headingBlockId);
    expect(heading).toBeTruthy();
    expect(heading.type).toBe('text');
    expect(heading.data.text).toBe('# Sprint Plan');

    // Title also shows in the hierarchy (page.title), not only on the canvas.
    const section = ws.workspace.sections.find((s: any) => s.id === created.sectionId);
    const newPage = section.pages.find((p: any) => p.id === created.pageId);
    expect(newPage.title).toBe('Sprint Plan');
  });

  test('create_page with withHeading:false leaves the canvas empty', async ({ page }) => {
    const created = await runBridge(page, 'create_page', {
      title: 'Bare Page',
      withHeading: false,
    });

    expect(created.headingBlockId).toBeUndefined();
    const canvas = await getCanvasStore(page);
    expect(canvas.nodes).toHaveLength(0);
  });

  test('create_page targets an explicit section', async ({ page }) => {
    const section = await runBridge(page, 'create_section', { title: 'Archive' });
    const created = await runBridge(page, 'create_page', {
      title: 'Old Notes',
      sectionId: section.sectionId,
    });

    expect(created.sectionId).toBe(section.sectionId);

    const { workspace } = await getWorkspaceStore(page);
    const target = workspace.sections.find((s: any) => s.id === section.sectionId);
    expect(target.pages.map((p: any) => p.title)).toContain('Old Notes');
  });
});
