import { Square, Circle, Triangle, Diamond, ArrowUpRight, Minus, Ban } from 'lucide-react';
import type { ShapeOptions, ShapeType } from '../../types/data';
import { useToolStore } from '../../stores/useToolStore';
import { ColorPopover } from './ColorPopover';
import { SizePopover } from './SizePopover';
import { OpacitySlider } from './OpacitySlider';
import './BottomToolbar.css';

interface ShapeToolbarProps {
  options: ShapeOptions;
  onChange: (updates: Partial<ShapeOptions>) => void;
  hasSelectedShape?: boolean; // true when a shape node is selected
}

const SHAPE_TYPES: { type: ShapeType; icon: typeof Square; label: string }[] = [
  { type: 'rect', icon: Square, label: 'Rectangle' },
  { type: 'circle', icon: Circle, label: 'Circle' },
  { type: 'triangle', icon: Triangle, label: 'Triangle' },
  { type: 'diamond', icon: Diamond, label: 'Diamond' },
  { type: 'arrow', icon: ArrowUpRight, label: 'Arrow' },
  { type: 'line', icon: Minus, label: 'Line' },
];

const DASH_PRESETS: { dash: number[]; label: string }[] = [
  { dash: [], label: 'Solid' },
  { dash: [8, 4], label: 'Dashed' },
  { dash: [2, 2], label: 'Dotted' },
];

export function ShapeToolbar({ options, onChange, hasSelectedShape: _hasSelectedShape }: ShapeToolbarProps) {
  const activeTool = useToolStore((s) => s.activeTool);
  const setTool = useToolStore((s) => s.setTool);
  const setShapeOptions = useToolStore((s) => s.setShapeOptions);
  const isShapeToolActive = activeTool === 'shape';
  const hasFill = options.fill !== 'transparent';

  const handleShapeTypeClick = (type: ShapeType) => {
    // Shape type buttons ALWAYS set the tool option for next creation
    // and switch to shape mode — never convert the selected shape
    setShapeOptions({ shapeType: type });
    setTool('shape');
  };

  return (
    <div className="text-toolbar" data-testid="shape-toolbar">
      {/* Shape type selector — only highlight when shape tool is active */}
      <div className="shape-toolbar__types">
        {SHAPE_TYPES.map(({ type, icon: Icon, label }) => (
          <button
            key={type}
            className={`text-toolbar__btn ${isShapeToolActive && options.shapeType === type ? 'text-toolbar__btn--active' : ''}`}
            onClick={() => handleShapeTypeClick(type)}
            title={label}
            data-testid={`shape-type-${type}`}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>

      <div className="text-toolbar__divider" />

      {/* Fill toggle + color */}
      <button
        className={`text-toolbar__btn ${!hasFill ? 'text-toolbar__btn--active' : ''}`}
        onClick={() => onChange({ fill: hasFill ? 'transparent' : '#dbeafe' })}
        title={hasFill ? 'Remove fill' : 'Add fill'}
        data-testid="shape-fill-toggle"
      >
        <Ban size={14} />
      </button>

      {hasFill && (
        <ColorPopover
          value={options.fill}
          onChange={(fill) => onChange({ fill })}
          label="Fill Color"
        />
      )}

      <div className="text-toolbar__divider" />

      {/* Stroke color */}
      <ColorPopover
        value={options.stroke}
        onChange={(stroke) => onChange({ stroke })}
        label="Stroke Color"
      />

      {/* Stroke width */}
      <SizePopover
        value={options.strokeWidth}
        onChange={(strokeWidth) => onChange({ strokeWidth })}
        min={1}
        max={10}
        label="Stroke Width"
        icon="stroke"
        unit="px"
      />

      <div className="text-toolbar__divider" />

      <OpacitySlider
        value={options.opacity ?? 1}
        onChange={(opacity) => onChange({ opacity })}
      />

      <div className="text-toolbar__divider" />

      {/* Dash style */}
      <div className="shape-toolbar__dashes">
        {DASH_PRESETS.map(({ dash, label }) => (
          <button
            key={label}
            className={`text-toolbar__btn ${JSON.stringify(options.strokeDash) === JSON.stringify(dash) ? 'text-toolbar__btn--active' : ''}`}
            onClick={() => onChange({ strokeDash: dash })}
            title={label}
          >
            <svg width="20" height="4" viewBox="0 0 20 4">
              {dash.length === 0 ? (
                <line x1="0" y1="2" x2="20" y2="2" stroke="currentColor" strokeWidth="2" />
              ) : (
                <line x1="0" y1="2" x2="20" y2="2" stroke="currentColor" strokeWidth="2"
                  strokeDasharray={dash.join(',')} />
              )}
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
