import { ArrowUpRight, Circle, Diamond, Minus, Square, Triangle } from 'lucide-react';
import type { ShapeType } from '../../types/data';

/** The floating shape bar's canonical ordering, shared with its digit shortcuts. */
export const SHAPE_TYPES: { type: ShapeType; icon: typeof Square; label: string }[] = [
  { type: 'rect', icon: Square, label: 'Rectangle' },
  { type: 'circle', icon: Circle, label: 'Circle' },
  { type: 'triangle', icon: Triangle, label: 'Triangle' },
  { type: 'diamond', icon: Diamond, label: 'Diamond' },
  { type: 'arrow', icon: ArrowUpRight, label: 'Arrow' },
  { type: 'line', icon: Minus, label: 'Line' },
];

/** Digit-to-shape mapping derived from the order rendered in the floating bar. */
export const SHAPE_KEYS: Readonly<Record<string, ShapeType>> = Object.fromEntries(
  SHAPE_TYPES.map(({ type }, index) => [String(index + 1), type]),
);
