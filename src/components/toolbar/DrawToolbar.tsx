import { Eraser, PenLine } from 'lucide-react';
import { useToolStore } from '../../stores/useToolStore';
import { ColorPopover } from './ColorPopover';
import { SizePopover } from './SizePopover';
import { EraserPopover } from './EraserPopover';
import { OpacitySlider } from './OpacitySlider';
import { useDrawStore } from '../../stores/useDrawStore';
import './BottomToolbar.css';

export function DrawToolbar() {
  const activeTool = useToolStore((s) => s.activeTool);
  const setTool = useToolStore((s) => s.setTool);
  const drawOptions = useToolStore((s) => s.drawOptions);
  const setDrawOptions = useToolStore((s) => s.setDrawOptions);
  const isDrawActive = activeTool === 'draw';

  const handlePenClick = () => {
    setDrawOptions({ isErasing: false });
    if (!isDrawActive) setTool('draw');
  };

  const handleEraserClick = () => {
    setDrawOptions({ isErasing: true });
    if (!isDrawActive) setTool('draw');
  };

  const applyDrawStyle = (updates: Partial<typeof drawOptions>) => {
    setDrawOptions(updates);
    const ids = useDrawStore.getState().selectedStrokeIds;
    if (ids.length === 0) return;
    const patch: { color?: string; strokeWidth?: number; opacity?: number } = {};
    if (updates.color !== undefined) patch.color = updates.color;
    if (updates.strokeWidth !== undefined) patch.strokeWidth = updates.strokeWidth;
    if (updates.opacity !== undefined) patch.opacity = updates.opacity;
    if (Object.keys(patch).length > 0) useDrawStore.getState().updateStrokes(ids, patch);
  };

  return (
    <div className="text-toolbar" data-testid="draw-toolbar">
      {/* Pen section */}
      <button
        className={`text-toolbar__btn ${isDrawActive && !drawOptions.isErasing ? 'text-toolbar__btn--active' : ''}`}
        onClick={handlePenClick}
        title="Pen"
        data-testid="draw-pen-btn"
      >
        <PenLine size={16} />
      </button>

      {!drawOptions.isErasing && (
        <>
          <SizePopover
            value={drawOptions.strokeWidth}
            onChange={(strokeWidth) => applyDrawStyle({ strokeWidth })}
            min={1}
            max={24}
            step={1}
            label="Stroke Width"
            icon="stroke"
            unit="px"
          />

          <div className="text-toolbar__divider" />

          <ColorPopover
            value={drawOptions.color}
            onChange={(color) => applyDrawStyle({ color })}
            label="Pen Color"
          />

          <OpacitySlider
            value={drawOptions.opacity ?? 1}
            onChange={(opacity) => applyDrawStyle({ opacity })}
          />
        </>
      )}

      <div className="text-toolbar__divider" />

      {/* Eraser section */}
      <button
        className={`text-toolbar__btn ${isDrawActive && drawOptions.isErasing ? 'text-toolbar__btn--active' : ''}`}
        onClick={handleEraserClick}
        title="Eraser"
        data-testid="draw-eraser-btn"
      >
        <Eraser size={16} />
      </button>

      {drawOptions.isErasing && (
        <EraserPopover
          mode={drawOptions.eraserMode}
          size={drawOptions.eraserSize}
          onModeChange={(eraserMode) => setDrawOptions({ eraserMode })}
          onSizeChange={(eraserSize) => setDrawOptions({ eraserSize })}
        />
      )}
    </div>
  );
}
