/**
 * Covers: REQ-BOARD-024, REQ-BOARD-025, REQ-AGENT-076
 */
import { expect, test } from '@playwright/test';
import {
  runBridge,
  sendServerFrame,
  stubBridgeUrl,
  waitForBridgeReady,
  waitForCanvasReady,
} from '../helpers';

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
    return { workspace: state.workspace };
  });
  const boardId = workspace.sections
    .flatMap((section: { pages: Array<{ id: string; kind?: string }> }) => section.pages)
    .find((item: { kind?: string }) => item.kind === 'board')?.id as string;
  return boardId;
}

test('a connected-but-silent label gets no chip; acting creates one', async ({ page }) => {
  const boardId = await openBoardWithCard(page);
  await sendServerFrame(page, {
    v: 1,
    type: 'agents',
    agents: [{ label: 'silent-bot', role: 'peer', connectedAt: Date.now() }],
  });
  await expect(page.getByTestId('board-agent-silent-bot')).toHaveCount(0);
  await expect(page.getByTestId('board-agents')).toHaveCount(0);

  await runBridge(page, 'card_create', {
    boardId,
    title: 'Live ticket',
    actor: 'feature-1',
  });
  await expect(page.getByTestId('board-agent-feature-1')).toBeVisible();
  await expect(page.getByTestId('board-agent-silent-bot')).toHaveCount(0);
});

test('agent_leave removes the chip and its card active state; acting again restores it', async ({ page }) => {
  const boardId = await openBoardWithCard(page);
  await runBridge(page, 'card_create', {
    boardId,
    title: 'Live ticket',
    actor: 'feature-1',
  });
  await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'feature-1' });
  const card = page.getByTestId('board-card-1');
  await expect(page.getByTestId('board-agent-feature-1')).toBeVisible();
  await expect(card).toHaveAttribute('data-active', 'true');

  await runBridge(page, 'agent_leave', {
    me: 'feature-1',
    boardId,
    note: 'wrapping up',
  });
  await expect(page.getByTestId('board-agent-feature-1')).toHaveCount(0);
  await expect(card).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('board-view')).toContainText('feature-1 left');

  await runBridge(page, 'card_note', {
    boardId,
    card: 1,
    text: 'back on it',
    actor: 'feature-1',
  });
  await expect(page.getByTestId('board-agent-feature-1')).toBeVisible();
  await expect(card).toHaveAttribute('data-active', 'true');
});

test('a frame without the label marks it left', async ({ page }) => {
  const boardId = await openBoardWithCard(page);
  await runBridge(page, 'card_create', {
    boardId,
    title: 'Live ticket',
    actor: 'feature-1',
  });
  await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'feature-1' });
  await sendServerFrame(page, {
    v: 1,
    type: 'agents',
    agents: [
      { label: 'feature-1', role: 'peer', connectedAt: Date.now() },
      { label: 'other-bot', role: 'peer', connectedAt: Date.now() },
    ],
  });
  const card = page.getByTestId('board-card-1');
  await expect(page.getByTestId('board-agent-feature-1')).toBeVisible();
  await expect(card).toHaveAttribute('data-active', 'true');

  await sendServerFrame(page, {
    v: 1,
    type: 'agents',
    agents: [{ label: 'other-bot', role: 'peer', connectedAt: Date.now() }],
  });
  await expect(page.getByTestId('board-agent-feature-1')).toHaveCount(0);
  await expect(card).toHaveAttribute('data-active', 'false');
});

test('dismiss × removes the chip', async ({ page }) => {
  const boardId = await openBoardWithCard(page);
  await runBridge(page, 'card_create', {
    boardId,
    title: 'Live ticket',
    actor: 'feature-1',
  });
  await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'feature-1' });
  await expect(page.getByTestId('board-agent-feature-1')).toBeVisible();
  await expect(page.getByTestId('board-card-1')).toHaveAttribute('data-active', 'true');

  await page.getByTestId('board-agent-dismiss-feature-1').click();
  await expect(page.getByTestId('board-agent-feature-1')).toHaveCount(0);
  await expect(page.getByTestId('board-card-1')).toHaveAttribute('data-active', 'false');
});

test('silence over 30 minutes hides the chip', async ({ page }) => {
  const boardId = await openBoardWithCard(page);
  await runBridge(page, 'card_create', {
    boardId,
    title: 'Live ticket',
    actor: 'feature-1',
  });
  await expect(page.getByTestId('board-agent-feature-1')).toBeVisible();

  await page.evaluate(() => {
    const store = (window as any).__POWERNOTE_AGENT_PRESENCE__;
    const at = store.getState().actors['feature-1'].lastActionAt;
    store.getState().setNow(at + 30 * 60_000 + 1);
  });
  await expect(page.getByTestId('board-agent-feature-1')).toHaveCount(0);
});
