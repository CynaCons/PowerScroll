import { useEffect, useRef, useState } from 'react';
import { Html } from 'react-konva-utils';
import Konva from 'konva';
import type { CanvasNode, ShapeNodeData } from '../../types/data';
import { defaultTextOptions } from '../../utils/defaults';

export interface ShapeLabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The usable, unrotated label box for each closed shape. */
export function shapeLabelBox(node: CanvasNode): ShapeLabelBox | null {
  const shapeType = (node.data as ShapeNodeData).shapeType;
  const { width: w, height: h } = node;
  if (shapeType === 'rect') return { x: 8, y: 8, width: Math.max(1, w - 16), height: Math.max(1, h - 16) };
  if (shapeType === 'circle') return { x: w * (1 - 1 / Math.sqrt(2)) / 2, y: h * (1 - 1 / Math.sqrt(2)) / 2, width: w / Math.sqrt(2), height: h / Math.sqrt(2) };
  if (shapeType === 'diamond') return { x: w / 4, y: h / 4, width: w / 2, height: h / 2 };
  if (shapeType === 'triangle') return { x: w / 4, y: h / 2, width: w / 2, height: h / 2 };
  return null;
}

export function isClosedLabelShape(node: CanvasNode): boolean {
  return shapeLabelBox(node) !== null;
}

export function shapeLabelFontSize(data: ShapeNodeData): number {
  return data.label?.fontSize ?? defaultTextOptions.fontSize;
}

/** Match Konva's word wrapping so a commit can grow the node when needed. */
export function measureShapeLabelHeight(text: string, width: number, data: ShapeNodeData): number {
  return new Konva.Text({
    text,
    width: Math.max(1, width),
    fontSize: shapeLabelFontSize(data),
    fontFamily: defaultTextOptions.fontFamily,
    wrap: 'word',
    lineHeight: 1.2,
  }).height();
}

interface ShapeLabelEditorProps {
  node: CanvasNode;
  onFinish: (text: string) => void;
  onCancel: () => void;
}

/**
 * HTML editing overlay kept inside ShapeNode's Group, so react-konva-utils
 * applies the same stage pan/zoom and shape rotation as the rendered label.
 */
export function ShapeLabelEditor({ node, onFinish, onCancel }: ShapeLabelEditorProps) {
  const data = node.data as ShapeNodeData;
  const box = shapeLabelBox(node)!;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const paddingFor = (text: string) => Math.max(0, (box.height - measureShapeLabelHeight(text, box.width, data)) / 2);
  const [paddingTop, setPaddingTop] = useState(() => paddingFor(data.label?.text ?? ''));

  useEffect(() => {
    const focus = () => {
      const textarea = textareaRef.current;
      if (!textarea) return false;
      textarea.focus();
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
      return document.activeElement === textarea;
    };
    if (focus()) return;
    const t1 = setTimeout(focus, 10);
    const t2 = setTimeout(focus, 50);
    const t3 = setTimeout(focus, 150);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  return (
    <Html groupProps={{ x: box.x, y: box.y }} divProps={{ style: {} }}>
      <textarea
        ref={textareaRef}
        data-testid="shape-label-editor"
        defaultValue={data.label?.text ?? ''}
        onKeyDown={(e) => {
          // TextEditor lets Enter (including Ctrl/Cmd+Enter) insert a newline.
          // Escape closes first; its following blur retains TextEditor's commit behavior.
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
          e.stopPropagation();
        }}
        onBlur={() => onFinish(textareaRef.current?.value ?? '')}
        onInput={(event) => setPaddingTop(paddingFor(event.currentTarget.value))}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: box.width,
          height: box.height,
          padding: `${paddingTop}px 0 0`,
          margin: 0,
          border: 'none',
          outline: 'none',
          resize: 'none',
          overflow: 'auto',
          boxSizing: 'border-box',
          background: 'transparent',
          color: data.stroke,
          fontSize: shapeLabelFontSize(data),
          fontFamily: defaultTextOptions.fontFamily,
          fontStyle: 'normal',
          fontWeight: 'normal',
          lineHeight: '1.2',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          wordWrap: 'break-word',
        }}
      />
    </Html>
  );
}
