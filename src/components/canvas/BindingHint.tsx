import { Circle, Rect } from 'react-konva';
import type { CanvasNode } from '../../types/data';
import type { Point } from '../../utils/arrowBinding';

interface BindingHintProps {
  target: CanvasNode;
  point: Point;
  scale: number;
  /** Canvas position of this hint's parent group. */
  offset: Point;
}

/** Candidate target outline and the precise point an endpoint will bind to. */
export function BindingHint({ target, point, scale, offset }: BindingHintProps) {
  const rotation = (target.data as { rotation?: number }).rotation ?? 0;
  const x = target.x - offset.x;
  const y = target.y - offset.y;

  return <>
    <Rect
      name="binding-hint-rect"
      x={rotation ? x + target.width / 2 : x}
      y={rotation ? y + target.height / 2 : y}
      width={target.width}
      height={target.height}
      rotation={rotation}
      offsetX={rotation ? target.width / 2 : 0}
      offsetY={rotation ? target.height / 2 : 0}
      stroke="#2563eb"
      strokeWidth={1 / scale}
      dash={[5 / scale, 4 / scale]}
      fill="transparent"
      listening={false}
    />
    <Circle
      name="binding-hint-anchor"
      x={point.x - offset.x}
      y={point.y - offset.y}
      radius={5 / scale}
      fill="#2563eb"
      stroke="#ffffff"
      strokeWidth={1.5 / scale}
      listening={false}
    />
  </>;
}
