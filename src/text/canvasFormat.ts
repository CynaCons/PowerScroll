/**
 * Formatting of selected text blocks from the canvas (no editor open):
 * the toolbar's Bold/Italic/Underline/Strike and Ctrl+B/I/U (REQ-TEXT-050).
 */
import { useCanvasStore, undoBatchStart, undoBatchEnd } from '../stores/useCanvasStore';
import type { CanvasNode, TextNodeData } from '../types/data';
import type { FormatKind } from './schema';
import { toggleBlockFormat } from './blockFormat';

/** The selected text blocks, in canvas order. */
export function selectedTextBlocks(): CanvasNode[] {
  const canvas = useCanvasStore.getState();
  return canvas.nodes.filter((node) => node.type === 'text' && canvas.selectedNodeIds.includes(node.id));
}

/** Toggle a format over all the text of every selected block. False when none is selected. */
export function formatSelectedTextBlocks(kind: FormatKind): boolean {
  if (kind === 'code') return false;
  const blocks = selectedTextBlocks();
  if (blocks.length === 0) return false;
  const next = toggleBlockFormat(blocks.map((b) => b.data as TextNodeData), kind);
  const canvas = useCanvasStore.getState();
  undoBatchStart(canvas.nodes);
  blocks.forEach((block, i) => {
    canvas.updateNode(block.id, { data: { ...(block.data as TextNodeData), text: next[i].text, fontStyle: next[i].fontStyle } });
  });
  undoBatchEnd();
  return true;
}
