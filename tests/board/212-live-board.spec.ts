/**
 * Covers: REQ-BOARD-018, REQ-BOARD-019, REQ-BOARD-020, REQ-BOARD-021, REQ-BOARD-023
 */
import { expect, test } from '@playwright/test';
import {
  runBridge,
  sendServerFrame,
  stubBridgeUrl,
  waitForBridgeReady,
  waitForCanvasReady,
} from '../helpers';

const PALETTE = ['#2563eb', '#0f766e', '#7c3aed', '#c2410c', '#0e7490', '#a21caf', '#4d7c0f'];

function avatarColor(name: string): string {
  const hash = Array.from(name).reduce((total, character) => total + character.charCodeAt(0), 0);
  return PALETTE[hash % PALETTE.length];
}

async function openBoardWithCard(page: import('@playwright/test').Page) {
  await stubBridgeUrl(page);
  await page.goto('/');
  await waitForCanvasReady(page);
  await waitForBridgeReady(page);
  await page.getByTestId('nav-hierarchy').click();
  await page.getByTestId('add-board-btn').click();
  await expect(page.getByTestId('board-view')).toBeVisible();
  const { workspace } = await page.evaluate(() => {
    const state = (window as any).__POWERNOTE_STORES__.workspace.getState();
    return { workspace: state.workspace, activePageId: state.activePageId };
  });
  const boardId = workspace.sections.flatMap((section: { pages: Array<{ id: string; kind?: string }> }) => section.pages)
    .find((item: { kind?: string }) => item.kind === 'board')?.id as string;
  await runBridge(page, 'card_create', {
    boardId,
    title: 'Live ticket',
    actor: 'feature-1',
  });
  return boardId;
}

test('agents frame, active highlight, reduced motion, flash and needs-me badge', async ({ page }) => {
  const boardId = await openBoardWithCard(page);
  const color = avatarColor('feature-1');

  await sendServerFrame(page, {
    v: 1,
    type: 'agents',
    agents: [{ label: 'feature-1', role: 'peer', connectedAt: Date.now() }],
  });
  await expect(page.getByTestId('board-agent-feature-1')).toBeVisible();
  await expect(page.getByTestId('board-activity-live')).toBeVisible();

  await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'feature-1' });
  const card = page.getByTestId('board-card-1');
  await expect(card).toHaveAttribute('data-active', 'true');
  await expect(card).toContainText('working now');
  await expect(page.getByTestId('board-agent-feature-1')).toHaveAttribute('data-active', 'true');

  const ring = await card.evaluate((element) => getComputedStyle(element).getPropertyValue('--agent-color').trim());
  expect(ring.toLowerCase()).toBe(color.toLowerCase());

  await expect(page.getByTestId('board-filter-needs-me')).not.toContainText('1');
  await expect(card).not.toHaveClass(/board-card--flash/, { timeout: 2500 });

  await runBridge(page, 'card_move', {
    boardId,
    card: 1,
    to: 'waiting',
    question: 'Need a look',
    actor: 'feature-1',
  });
  await expect(page.getByTestId('board-needs-me-count')).toHaveText('1');
  await expect(card).toHaveClass(/board-card--flash/);
  await expect(card).not.toHaveClass(/board-card--flash/, { timeout: 2500 });

  await runBridge(page, 'card_note', {
    boardId,
    card: 1,
    text: 'owner comment',
    actor: 'you',
  });
  await page.waitForTimeout(250);
  await expect(card).not.toHaveClass(/board-card--flash/);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const animation = await card.evaluate((element) => getComputedStyle(element).animationName);
  expect(animation === 'none' || animation === '').toBeTruthy();

  await page.evaluate(() => {
    const store = (window as any).__POWERNOTE_AGENT_PRESENCE__;
    const at = store.getState().actors['feature-1'].lastActionAt;
    store.getState().setNow(at + 61_000);
  });
  await expect(card).toHaveAttribute('data-active', 'false');
  await expect(card).not.toContainText('working now');
});

test('a card lights up for the me name even when the process label differs, and goes dark when every agent leaves', async ({ page }) => {
  const boardId = await openBoardWithCard(page);
  // The MCP process is called agent-1a2b3c4d; the agent works as feature-2.
  await sendServerFrame(page, {
    v: 1,
    type: 'agents',
    agents: [{ label: 'agent-1a2b3c4d', role: 'hub', connectedAt: Date.now() }],
  });
  await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'feature-2' });
  const card = page.getByTestId('board-card-1');
  await expect(card).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('board-agent-feature-2')).toHaveAttribute('data-active', 'true');

  await sendServerFrame(page, { v: 1, type: 'agents', agents: [] });
  await expect(card).toHaveAttribute('data-active', 'false');
});
