/**
 * Shared undo/redo entry points for keyboard and toolbar controls.
 */

import { useHistoryStore } from '../stores/useHistoryStore';

export function undoActive(): void {
  useHistoryStore.getState().undo();
}

export function redoActive(): void {
  useHistoryStore.getState().redo();
}

export function canUndoActive(): boolean {
  return useHistoryStore.getState().canUndo;
}

export function canRedoActive(): boolean {
  return useHistoryStore.getState().canRedo;
}
