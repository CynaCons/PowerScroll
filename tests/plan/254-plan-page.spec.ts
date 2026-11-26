/**
 * Test 254: plan pages - a PLAN.md beside your boards.
 * Covers: REQ-PLAN-001, REQ-PLAN-002, REQ-PLAN-003, REQ-PLAN-004, REQ-PLAN-005, REQ-PLAN-006,
 *         REQ-PLAN-007, REQ-PLAN-008, REQ-PLAN-009
 *
 * Owner request 2026-11-26: plans in PowerScroll as a page type like boards, drawn as the
 * iteration rail. The linked file is faked with a stand-in handle from showOpenFilePicker,
 * so the test can change its text and watch the page follow.
 */
import { expect, test, type Page } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

const PLAN = `# Demo - Implementation Plan

**Goal:** Ship the demo.

## v0.1 — Foundations

### v0.1.0 — Scaffold (COMPLETE)
**Goal:** App boots.
- [x] Vite app [agent: claude]
- [x] CI

### v0.1.1 — Docs (COMPLETE)
- [x] README

## v0.2 — Features

### v0.2.0 — Search (current) (ACTIVE)
**Goal:** Find anything.
- [x] Index pages [agent: sonnet]
- [ ] Owner request 2026-11-20: search inside boards
- [ ] Results panel [agent: sonnet]
  - [ ] indented lines are not tasks

### v0.2.1 — Export
- [ ] PNG export

## Current Status
- [ ] not a task, the major was closed by this header

## Backlog
- PDF export
- Plugin system
`;

async function addPlanPage(page: Page) {
  await page.goto('/');
  await waitForCanvasReady(page);
  await page.getByTestId('nav-hierarchy').click();
  await page.getByTestId('add-plan-btn').first().click();
  await expect(page.getByTestId('plan-view')).toBeVisible();
}

/** Stand-in for showOpenFilePicker: one handle whose text the test can change. */
async function stubPicker(page: Page, text: string) {
  await page.addInitScript((initial) => {
    const state = { text: initial, modified: 1_700_000_000_000, reads: 0, permission: 'granted' as PermissionState };
    (window as any).__planFile = state;
    const handle = {
      kind: 'file',
      name: 'PLAN.md',
      async getFile() {
        state.reads++;
        return new File([state.text], 'PLAN.md', { type: 'text/markdown', lastModified: state.modified });
      },
      async queryPermission() { return state.permission; },
      async requestPermission() { state.permission = 'granted'; return 'granted'; },
    };
    (window as any).showOpenFilePicker = async () => [handle];
  }, text);
}

const setFile = (page: Page, text: string) =>
  page.evaluate((next) => {
    const state = (window as any).__planFile;
    state.text = next;
    state.modified += 1000;
  }, text);

test('Add plan makes a plan page with its own icon and no scrolls, and asks for a file', async ({ page }) => {
  await addPlanPage(page);
  await expect(page.getByTestId('plan-empty')).toBeVisible();
  await expect(page.getByTestId('plan-open-empty')).toBeVisible();
  const active = await page.evaluate(() => {
    const state = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const p = state.workspace.sections.flatMap((s: any) => s.pages).find((x: any) => x.id === state.activePageId);
    return { kind: p.kind, scrolls: p.scrolls.length, source: p.plan.source };
  });
  expect(active).toEqual({ kind: 'plan', scrolls: 0, source: '' });
  await expect(page.locator('.konvajs-content')).toHaveCount(0);
});

test('a linked PLAN.md draws majors, iterations, the current checklist and the owner checks', async ({ page }) => {
  await stubPicker(page, PLAN);
  await addPlanPage(page);
  await page.getByTestId('plan-open').click();

  await expect(page.getByTestId('plan-title')).toHaveText('Demo');
  await expect(page.getByTestId('plan-link')).toHaveText('PLAN.md · linked');
  await expect(page.getByTestId('plan-major-v0.1')).toContainText('Foundations');
  await expect(page.getByTestId('plan-major-v0.1')).toContainText('100%');
  await expect(page.getByTestId('plan-major-v0.2')).toContainText('25%');

  const search = page.getByTestId('plan-it-v0.2.0');
  await expect(search).toHaveAttribute('data-done', '1');
  await expect(search).toHaveAttribute('data-total', '3');
  await expect(search).toHaveClass(/plan-it--current/);
  await expect(search).toHaveClass(/plan-it--need/);
  await expect(page.getByTestId('plan-it-v0.1.0')).not.toHaveClass(/plan-it--need/);
  // The unversioned "## Current Status" header closes the major: its checkbox is no task.
  await expect(page.getByTestId('plan-it-v0.2.1')).toHaveAttribute('data-total', '1');

  const detail = page.getByTestId('plan-detail');
  await expect(detail).toHaveAttribute('data-version', 'v0.2.0');
  await expect(detail).toContainText('Find anything.');
  await expect(detail).toContainText('current');
  const tasks = detail.getByTestId('plan-task');
  await expect(tasks).toHaveCount(3);
  await expect(tasks.nth(0)).toHaveAttribute('data-done', 'true');
  await expect(tasks.nth(0)).toContainText('sonnet');
  await expect(tasks.nth(1)).toContainText('needs you');
  await expect(tasks.nth(1)).toHaveClass(/plan-task--need/);

  await expect(page.getByTestId('plan-need')).toHaveText('1 needs you');
  await page.getByTestId('plan-need').click();
  await expect(page.getByTestId('plan-needs')).toContainText('search inside boards');

  // Clicking another block shows its checklist.
  await page.getByTestId('plan-it-v0.1.0').click();
  await expect(detail).toHaveAttribute('data-version', 'v0.1.0');
  await expect(detail).toContainText('App boots.');

  await page.getByTestId('plan-backlog').getByRole('button').click();
  await expect(page.getByTestId('plan-backlog')).toContainText('Plugin system');
});

test('the page follows the file as it changes, and never writes it', async ({ page }) => {
  await stubPicker(page, PLAN);
  await addPlanPage(page);
  await page.getByTestId('plan-open').click();
  await expect(page.getByTestId('plan-it-v0.2.0')).toHaveAttribute('data-done', '1');

  await setFile(page, PLAN.replace('- [ ] Results panel', '- [x] Results panel').replace('- [ ] Owner request 2026-11-20', '- [x] Owner request 2026-11-20'));
  await expect(page.getByTestId('plan-it-v0.2.0')).toHaveAttribute('data-done', '3', { timeout: 8000 });
  await expect(page.getByTestId('plan-need')).toHaveCount(0);
  // powerplan marks the next iteration current once this one is done.
  const saved = await page.evaluate(() => {
    const state = (window as any).__POWERNOTE_STORES__.workspace.getState();
    const p = state.workspace.sections.flatMap((s: any) => s.pages).find((x: any) => x.id === state.activePageId);
    return p.plan.source as string;
  });
  expect(saved).toContain('- [x] Results panel');

  // An unchanged file is looked at but not read again.
  const reads = await page.evaluate(() => (window as any).__planFile.reads);
  await page.waitForTimeout(3500);
  const after = await page.evaluate(() => (window as any).__planFile.reads);
  expect(after - reads).toBeLessThanOrEqual(2);
  const source = await page.evaluate(() => (window as any).__planFile.text);
  expect(source).toContain('- [x] Results panel');

  // Permission lost: the page says so and Reconnect brings it back.
  await page.evaluate(() => { (window as any).__planFile.permission = 'prompt'; });
  await expect(page.getByTestId('plan-reconnect')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId('plan-link')).toHaveText('PLAN.md · paused');
  await page.getByTestId('plan-reconnect').click();
  await expect(page.getByTestId('plan-link')).toHaveText('PLAN.md · linked');
});

test('without the File System Access API the file is read once as a snapshot', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker; });
  await addPlanPage(page);
  await page.getByTestId('plan-file-input').setInputFiles({ name: 'PLAN.md', mimeType: 'text/markdown', buffer: Buffer.from(PLAN) });
  await expect(page.getByTestId('plan-link')).toHaveText('PLAN.md · snapshot');
  await expect(page.getByTestId('plan-it-v0.2.0')).toHaveClass(/plan-it--current/);
});

test('only the newest six majors show until asked, and the snapshot survives a page switch', async ({ page }) => {
  const majors = Array.from({ length: 8 }, (_, index) => `## v0.${index + 1} — Group ${index + 1}\n\n### v0.${index + 1}.0 — Step ${index + 1}\n- [x] done\n`).join('\n');
  await stubPicker(page, `# Long\n\n${majors}`);
  await addPlanPage(page);
  await page.getByTestId('plan-open').click();
  await expect(page.locator('.plan-major')).toHaveCount(6);
  await expect(page.getByTestId('plan-major-v0.1')).toHaveCount(0);
  await page.getByTestId('plan-show-all').click();
  await expect(page.locator('.plan-major')).toHaveCount(8);

  // Go to the canvas page and back: the plan still shows from the notebook copy.
  await page.getByTestId('page-title').first().click();
  await expect(page.getByTestId('plan-view')).toHaveCount(0);
  await page.getByTestId('page-title').last().click();
  await expect(page.getByTestId('plan-major-v0.8')).toBeVisible();
});

test('search finds plan iterations by task text and opens the iteration', async ({ page }) => {
  await stubPicker(page, PLAN);
  await addPlanPage(page);
  await page.getByTestId('plan-open').click();
  await expect(page.getByTestId('plan-detail')).toHaveAttribute('data-version', 'v0.2.0');
  await page.keyboard.press('Control+Shift+F');
  await page.getByTestId('search-input').fill('PNG export');
  const result = page.getByTestId('search-result').first();
  await expect(result).toContainText('Plan v0.2.1');
  await result.click();
  await expect(page.getByTestId('plan-detail')).toHaveAttribute('data-version', 'v0.2.1');
});
