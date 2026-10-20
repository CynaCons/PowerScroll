import { createContext, useContext } from 'react';
import { labelColor, type LabelColor } from './boardUi';

/** The open board's label colours, provided by BoardView. */
export const LabelColorsContext = createContext<Map<string, LabelColor> | undefined>(undefined);

export function useLabelColor(): (label: string) => LabelColor {
  const colors = useContext(LabelColorsContext);
  return (label) => labelColor(label, colors);
}
