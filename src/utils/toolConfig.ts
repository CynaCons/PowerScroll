/**
 * Centralized tool state machine configuration.
 *
 * Defines what each tool mode allows: selection, dragging, canvas click behavior,
 * and cursor style. Components import from here instead of doing ad-hoc checks.
 */

export type ToolType = 'select' | 'hand' | 'text' | 'draw' | 'shape' | 'lasso' | 'image' | 'gantt' | 'diagram';

interface ToolModeConfig {
  /** Can the user click to select/deselect existing nodes? */
  allowNodeSelection: boolean;
  /** Can the user drag existing nodes to move them? */
  allowNodeDrag: boolean;
  /** Should nodes show hover highlights? */
  allowNodeHover: boolean;
  /** CSS cursor class for the canvas area */
  cursorClass: string;
  /** Does clicking the canvas background create something? */
  canvasClickAction: 'none' | 'placeText' | 'startShape' | 'startDraw' | 'startLasso';
}

const TOOL_CONFIG: Record<ToolType, ToolModeConfig> = {
  select: {
    allowNodeSelection: true,
    allowNodeDrag: true,
    allowNodeHover: true,
    cursorClass: '',
    canvasClickAction: 'none',
  },
  hand: {
    allowNodeSelection: false,
    allowNodeDrag: false,
    allowNodeHover: false,
    cursorClass: 'infinite-canvas--grab',
    canvasClickAction: 'none',
  },
  text: {
    allowNodeSelection: true,
    allowNodeDrag: true,
    allowNodeHover: true,
    cursorClass: '',
    canvasClickAction: 'placeText',
  },
  draw: {
    allowNodeSelection: false,
    allowNodeDrag: false,
    allowNodeHover: false,
    cursorClass: 'infinite-canvas--none',
    canvasClickAction: 'startDraw',
  },
  shape: {
    allowNodeSelection: false,
    allowNodeDrag: false,
    allowNodeHover: false,
    cursorClass: '',
    canvasClickAction: 'startShape',
  },
  lasso: {
    allowNodeSelection: false,
    allowNodeDrag: false,
    allowNodeHover: false,
    cursorClass: 'infinite-canvas--crosshair',
    canvasClickAction: 'startLasso',
  },
  image: {
    allowNodeSelection: true,
    allowNodeDrag: true,
    allowNodeHover: true,
    cursorClass: '',
    canvasClickAction: 'none',
  },
  gantt: {
    allowNodeSelection: true,
    allowNodeDrag: true,
    allowNodeHover: true,
    cursorClass: '',
    canvasClickAction: 'placeText', // reuses the text-placement handler that branches on 'gantt'
  },
  diagram: {
    allowNodeSelection: true,
    allowNodeDrag: true,
    allowNodeHover: true,
    cursorClass: '',
    canvasClickAction: 'placeText', // same placement handler, branches on 'diagram'
  },
};

/** Get the full config for a tool mode */
export function getToolConfig(tool: ToolType): ToolModeConfig {
  return TOOL_CONFIG[tool];
}

/** Check if nodes are interactive (selectable + draggable) in the current tool mode */
export function isNodeInteractive(tool: ToolType): boolean {
  const config = TOOL_CONFIG[tool];
  return config.allowNodeSelection && config.allowNodeDrag;
}

/** Get the toggle target: clicking an active tool returns to 'select' */
export function getToolToggle(current: ToolType, clicked: ToolType): ToolType {
  return current === clicked ? 'select' : clicked;
}
