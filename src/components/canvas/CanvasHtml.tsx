/**
 * HTML on the canvas that pans and zooms with one shared layer (REQ-CANVAS-046).
 *
 * react-konva-utils' Html writes a fresh CSS transform on every block's div
 * on every pan frame, so a page with hundreds of blocks moves hundreds of
 * elements per frame. Here every block's div sits in one layer that carries
 * the stage transform; a block's own div only moves when the block itself
 * moves (drag, layout), never when the camera does.
 *
 * Same contract as Html otherwise: a separate React root rendered after the
 * commit (queueMicrotask + flushSync), the div appended to the stage container.
 */
import { useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Group } from 'react-konva';
import type Konva from 'konva';

const layers = new WeakMap<Konva.Stage, HTMLDivElement>();

/** The stage's shared overlay layer, created on first use and kept in step with the camera. */
function htmlLayer(stage: Konva.Stage): HTMLDivElement {
  const existing = layers.get(stage);
  if (existing && existing.parentNode) return existing;
  const container = stage.container();
  const pos = window.getComputedStyle(container).position;
  if (pos !== 'absolute' && pos !== 'relative') container.style.position = 'relative';
  const layer = document.createElement('div');
  layer.className = 'powernote-html-layer';
  Object.assign(layer.style, {
    position: 'absolute', top: '0px', left: '0px', width: '0px', height: '0px',
    transformOrigin: 'top left', zIndex: '1', pointerEvents: 'none',
  });
  const sync = () => {
    layer.style.transform = `translate(${stage.x()}px, ${stage.y()}px) scale(${stage.scaleX()}, ${stage.scaleY()})`;
  };
  sync();
  stage.on('xChange.htmllayer yChange.htmllayer scaleXChange.htmllayer scaleYChange.htmllayer', sync);
  container.appendChild(layer);
  layers.set(stage, layer);
  return layer;
}

interface CanvasHtmlProps {
  children: ReactNode;
  divProps?: HTMLAttributes<HTMLDivElement> & { className?: string };
}

export function CanvasHtml({ children, divProps }: CanvasHtmlProps) {
  const groupRef = useRef<Konva.Group>(null);
  const [div] = useState(() => document.createElement('div'));
  const root = useMemo(() => ReactDOM.createRoot(div), [div]);
  const last = useRef('');

  useLayoutEffect(() => {
    const group = groupRef.current;
    const stage = group?.getStage();
    if (!group || !stage) return;
    const place = () => {
      // Relative to the stage: the layer already carries the camera.
      const t = group.getAbsoluteTransform(stage).decompose();
      const next = `translate(${t.x}px, ${t.y}px) rotate(${t.rotation}deg) scale(${t.scaleX}, ${t.scaleY})`;
      if (next === last.current) return;
      last.current = next;
      div.style.transform = next;
    };
    Object.assign(div.style, { position: 'absolute', top: '0px', left: '0px', transformOrigin: 'top left' });
    htmlLayer(stage).appendChild(div);
    group.on('absoluteTransformChange', place);
    place();
    return () => {
      group.off('absoluteTransformChange', place);
      div.parentNode?.removeChild(div);
    };
  }, [div]);

  useLayoutEffect(() => {
    const { style, ...rest } = divProps ?? {};
    Object.assign(div.style, style);
    Object.assign(div, rest);
  }, [div, divProps]);

  useLayoutEffect(() => {
    queueMicrotask(() => {
      flushSync(() => root.render(children));
    });
  });

  useLayoutEffect(() => () => {
    setTimeout(() => root.unmount());
  }, [root]);

  return <Group ref={groupRef} />;
}
