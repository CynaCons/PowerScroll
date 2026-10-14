import { create } from 'zustand';
import type { ToolType, TextOptions, DrawOptions, ShapeOptions } from '../types/data';
import { defaultTextOptions, defaultShapeOptions } from '../utils/defaults';

export interface ShapePreview {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShapeBindingHint {
  targetId: string;
  point: { x: number; y: number };
}

const TOUCH_DRAW_KEY = 'powernote-touch-draw';
const SNAP_TO_OBJECTS_KEY = 'powernote-snap-to-objects';

/** Device preference, not notebook content — survives across notebooks. */
function loadTouchDraw(): DrawOptions['touchDraw'] {
  try {
    const v = localStorage.getItem(TOUCH_DRAW_KEY);
    return v === 'always' || v === 'never' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Device preference, not notebook content — defaults on for existing users. */
function loadSnapToObjects(): boolean {
  try {
    return localStorage.getItem(SNAP_TO_OBJECTS_KEY) !== 'false';
  } catch {
    return true;
  }
}

const defaultDrawOptions: DrawOptions = {
  color: '#1a1a1a',
  strokeWidth: 3,
  eraserMode: 'stroke',
  eraserSize: 12,
  isErasing: false,
  touchDraw: loadTouchDraw(),
  snapToObjects: loadSnapToObjects(),
  opacity: 1,
};

interface ToolState {
  activeTool: ToolType;
  textOptions: TextOptions;
  drawOptions: DrawOptions;
  shapeOptions: ShapeOptions;
  /** Transient geometry rendered by the canvas overlay while creating a shape. */
  shapePreview: ShapePreview | null;
  shapeBindingHint: ShapeBindingHint | null;
  /**
   * True once any stylus contact has been seen this session. With
   * `touchDraw: 'auto'` this is the moment fingers stop drawing and start
   * panning — the pen proves palms will be landing on the screen.
   */
  penDetected: boolean;
  /** Space is held — pointer drags pan instead of marquee/draw. */
  spaceHeld: boolean;

  setTool: (tool: ToolType) => void;
  setTextOptions: (options: Partial<TextOptions>) => void;
  setDrawOptions: (options: Partial<DrawOptions>) => void;
  setShapeOptions: (options: Partial<ShapeOptions>) => void;
  setShapePreview: (preview: ShapePreview | null) => void;
  setShapeBindingHint: (hint: ShapeBindingHint | null) => void;
  setPenDetected: (detected: boolean) => void;
  setSpaceHeld: (held: boolean) => void;
}

export const useToolStore = create<ToolState>((set) => ({
  activeTool: 'select',
  textOptions: { ...defaultTextOptions },
  drawOptions: { ...defaultDrawOptions },
  shapeOptions: { ...defaultShapeOptions },
  shapePreview: null,
  shapeBindingHint: null,
  penDetected: false,
  spaceHeld: false,

  setTool: (tool) => set({ activeTool: tool }),

  setTextOptions: (options) =>
    set((state) => ({
      textOptions: { ...state.textOptions, ...options },
    })),

  setDrawOptions: (options) => {
    if (options.touchDraw) {
      try {
        localStorage.setItem(TOUCH_DRAW_KEY, options.touchDraw);
      } catch {
        // private mode — the in-memory value still applies
      }
    }
    if ('snapToObjects' in options) {
      try {
        localStorage.setItem(SNAP_TO_OBJECTS_KEY, String(options.snapToObjects));
      } catch {
        // private mode — the in-memory value still applies
      }
    }
    set((state) => ({
      drawOptions: { ...state.drawOptions, ...options },
    }));
  },

  setShapeOptions: (options) =>
    set((state) => ({
      shapeOptions: { ...state.shapeOptions, ...options },
    })),

  setShapePreview: (shapePreview) => set({ shapePreview }),
  setShapeBindingHint: (shapeBindingHint) => set({ shapeBindingHint }),

  setPenDetected: (detected) => set({ penDetected: detected }),
  setSpaceHeld: (held) => set({ spaceHeld: held }),
}));
