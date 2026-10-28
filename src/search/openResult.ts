import { useCanvasStore } from '../stores/useCanvasStore';
import { useDrawStore } from '../stores/useDrawStore';
import { useSearchStore } from '../stores/useSearchStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import type { SearchEntry } from './searchIndex';

/**
 * Take the user to what a result found (REQ-SEARCH-019..021): switch page the
 * way the hierarchy panel does, then leave a reveal for the canvas (block) or
 * the board (card) to act on once it shows that page.
 */
export function openSearchResult(entry: SearchEntry): void {
  const ws = useWorkspaceStore.getState();
  const search = useSearchStore.getState();
  search.close();
  if (!entry.pageId) return;

  if (entry.pageId !== ws.activePageId) {
    const canvas = useCanvasStore.getState();
    ws.savePageNodes(canvas.nodes);
    ws.savePageStrokes(useDrawStore.getState().strokes);
    ws.setActivePage(entry.sectionId, entry.pageId);
    const page = useWorkspaceStore.getState().workspace.sections
      .find((s) => s.id === entry.sectionId)?.pages.find((p) => p.id === entry.pageId);
    canvas.loadPageNodes(page?.nodes ?? []);
    useDrawStore.getState().loadPageStrokes(page?.strokes ?? []);
  }

  if (!entry.targetId) return;
  if (entry.kind === 'card') search.setReveal({ kind: 'card', pageId: entry.pageId, id: entry.targetId });
  else if (entry.kind !== 'scroll') search.setReveal({ kind: 'node', pageId: entry.pageId, id: entry.targetId });
}
