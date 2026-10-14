import { useEffect, useRef, useState } from 'react';
import { Group, Line, Rect, Text } from 'react-konva';
import { Html } from 'react-konva-utils';
import type { BackgroundMode, ScrollRecord } from '../../types/data';
import { A4_WIDTH, MAX_SCROLL_WIDTH, MIN_SCROLL_WIDTH, SCROLL_TITLE_ACTIVE_TICK, SCROLL_TITLE_HAIRLINE, SCROLL_TITLE_HAIRLINE_WIDTH, SCROLL_TITLE_HELD_FADE_SCREEN_HEIGHT, SCROLL_TITLE_HELD_FILL, SCROLL_TITLE_HELD_FONT_SIZE_SCREEN, SCROLL_TITLE_HELD_FONT_STYLE, SCROLL_TITLE_HELD_HEIGHT_SCREEN, SCROLL_TITLE_INK, SCROLL_TITLE_PROGRESS_SCREEN_HEIGHT, SCROLL_TITLE_RESTING_FONT_SIZE, SCROLL_TITLE_RESTING_FONT_STYLE, SCROLL_TITLE_RESTING_HEIGHT, SCROLL_TITLE_RESTING_LETTER_SPACING, SCROLL_TITLE_PIN_INSET, columnAt, columnLeft, columnWidth, scrollTitleY } from '../../utils/pageLayout';
import { pageCeiling } from '../../utils/scrollCeiling';
import { deleteScroll, fitScrollToContent, liveScrollDeleteInfo, moveScroll, renameScroll, resizeScroll } from '../../utils/scrollOps';
import { ScrollDeleteChoices } from './ScrollDeleteChoices';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useDrawStore } from '../../stores/useDrawStore';
import './ContextMenu.css';

interface ScrollHeadersProps { mode: BackgroundMode; scrolls: ScrollRecord[]; pageId: string; onResizePreviewChange?: (preview: { scrollId: string; width: number } | null) => void; }
const TITLE_INSET = 16, RESIZE_HIT_SCREEN_WIDTH = 20, RESIZE_HIT_SCREEN_HEIGHT = 24, RESIZE_BADGE_SCREEN_WIDTH = 68, RESIZE_BADGE_SCREEN_HEIGHT = 21, GRIP_SCREEN_WIDTH = 3, GRIP_SCREEN_HEIGHT = 16;

function bandContentBottom(scroll: ScrollRecord, nodes: Array<{ x: number; y: number; height?: number }>, strokes: Array<{ points: readonly number[] }>, scrolls: ScrollRecord[]): number | null {
  let bottom: number | null = null;
  for (const node of nodes) if (columnAt(node.x, scrolls) === scroll.column) bottom = Math.max(bottom ?? -Infinity, node.y + (node.height || 30));
  for (const stroke of strokes) {
    if (columnAt(stroke.points[0] ?? 0, scrolls) !== scroll.column) continue;
    for (let i = 1; i < stroke.points.length; i += 2) bottom = Math.max(bottom ?? -Infinity, stroke.points[i]);
  }
  return bottom;
}

/** Named-scroll canvas chrome. Held controls divide by viewport scale so their screen size does not change with zoom. */
export function ScrollHeaders({ mode, scrolls, pageId, onResizePreviewChange }: ScrollHeadersProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resizePreview, setResizePreview] = useState<{ scrollId: string; width: number } | null>(null);
  const [hoveredResizeId, setHoveredResizeId] = useState<string | null>(null);
  const resizeDrag = useRef<{ scrollId: string; pointerX: number; width: number } | null>(null);
  const [menu, setMenu] = useState<{ scrollId: string; x: number; y: number; confirm?: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const setActiveScroll = useWorkspaceStore((s) => s.setActiveScroll);
  const activeScrollId = useWorkspaceStore((s) => s.activeScrollId);
  const viewport = useCanvasStore((s) => s.viewport);
  const nodes = useCanvasStore((s) => s.nodes);
  const strokes = useDrawStore((s) => s.strokes);
  const ceiling = pageCeiling(nodes, strokes, scrolls);

  useEffect(() => { if (editingId && !scrolls.some((s) => s.id === editingId)) setEditingId(null); if (menu && !scrolls.some((s) => s.id === menu.scrollId)) setMenu(null); }, [editingId, menu, scrolls]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => { if (!(event.target instanceof Element && event.target.closest('[data-testid="scroll-header-menu"]'))) setMenu(null); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [menu]);
  useEffect(() => { if (editingId && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editingId]);
  if (mode !== 'scroll' && mode !== 'pages') return null;

  const displayScrolls = resizePreview ? scrolls.map((scroll) => scroll.id === resizePreview.scrollId ? { ...scroll, width: resizePreview.width } : scroll) : scrolls;
  const orderedScrolls = [...displayScrolls].sort((a, b) => a.column - b.column);
  const menuIndex = menu ? orderedScrolls.findIndex((s) => s.id === menu.scrollId) : -1;
  const menuDelete = menu ? liveScrollDeleteInfo(pageId, menu.scrollId) : null;
  const restRow = scrollTitleY({ y: 0, scale: 1 }, ceiling).y;
  const scale = Math.max(viewport.scale || 1, 0.1);
  const viewportTop = -viewport.y / scale;
  const viewportHeight = ((globalThis as { Konva?: { stages?: Array<{ height: () => number }> } }).Konva?.stages?.[0]?.height() ?? 800) / scale;
  const commit = (scroll: ScrollRecord) => { const value = inputRef.current?.value.trim(); if (value !== undefined && value !== scroll.title) renameScroll(pageId, scroll.id, value); setEditingId(null); };
  const setLiveResizePreview = (preview: { scrollId: string; width: number } | null) => { setResizePreview(preview); onResizePreviewChange?.(preview); };
  const dragWidth = (event: { target: { getStage: () => import('konva/lib/Stage').Stage | null } }) => { const drag = resizeDrag.current, stage = event.target.getStage(), pointerX = stage?.getPointerPosition()?.x; return !drag || pointerX == null ? null : Math.max(MIN_SCROLL_WIDTH, Math.min(MAX_SCROLL_WIDTH, drag.width + (pointerX - drag.pointerX) / (stage?.scaleX() || 1))); };
  const setResizeCursor = (event: { target: { getStage: () => import('konva/lib/Stage').Stage | null } }, cursor: '' | 'col-resize') => { const container = event.target.getStage()?.container(); if (container) container.style.cursor = cursor; };
  const runDelete = (scrollId: string, withBlocks: boolean) => { deleteScroll(pageId, scrollId, withBlocks); setMenu(null); };
  const requestDelete = (scrollId: string) => { const info = liveScrollDeleteInfo(pageId, scrollId); if (!info || info.isLast) return; if (info.empty) return runDelete(scrollId, false); setMenu((current) => current ? { ...current, confirm: true } : current); };

  return <Group>
    {displayScrolls.map((scroll) => {
      if (!scroll.title && editingId !== scroll.id) return null;
      const x = columnLeft(scroll.column, displayScrolls), bandW = columnWidth(scroll.column, displayScrolls);
      const { y: heldY, holding } = scrollTitleY(viewport, ceiling);
      const stripY = holding ? heldY - SCROLL_TITLE_PIN_INSET : restRow;
      const stripH = holding ? SCROLL_TITLE_HELD_HEIGHT_SCREEN / scale : SCROLL_TITLE_RESTING_HEIGHT;
      const fontSize = holding ? SCROLL_TITLE_HELD_FONT_SIZE_SCREEN / scale : SCROLL_TITLE_RESTING_FONT_SIZE;
      const fontStyle = holding ? SCROLL_TITLE_HELD_FONT_STYLE : SCROLL_TITLE_RESTING_FONT_STYLE;
      const textY = stripY + (stripH - fontSize) / 2;
      const badgeW = RESIZE_BADGE_SCREEN_WIDTH / scale, isResizing = resizePreview?.scrollId === scroll.id;
      const titleW = Math.max(0, bandW - TITLE_INSET * 2 - (isResizing ? badgeW + 18 / scale : 12 / scale));
      const contentBottom = bandContentBottom(scroll, nodes, strokes, displayScrolls);
      const progress = contentBottom == null ? 1 : Math.max(0, Math.min(1, (viewportTop - restRow) / Math.max(1, contentBottom - restRow - viewportHeight)));
      const isActive = (activeScrollId ?? orderedScrolls.find((candidate) => candidate.title)?.id) === scroll.id; // REQ-SCROLL-011: null resolves to the leftmost named scroll
      const gripX = x + bandW - 6 / scale - GRIP_SCREEN_WIDTH / scale;
      const gripY = stripY + stripH - (holding ? 8 : 12) / scale - GRIP_SCREEN_HEIGHT / scale;
      return <Group key={`scroll-header-${scroll.id}`} name={`scroll-header-${scroll.id}`} onDblClick={() => setEditingId(scroll.id)} onDblTap={() => setEditingId(scroll.id)} onClick={() => setActiveScroll(scroll.id)} onTap={() => setActiveScroll(scroll.id)} onContextMenu={(event) => { event.cancelBubble = true; event.evt.preventDefault(); setActiveScroll(scroll.id); setMenu({ scrollId: scroll.id, x: event.evt.clientX, y: event.evt.clientY }); }}>
        {isActive && <Rect name="scroll-active-spine" x={x} y={restRow} width={SCROLL_TITLE_ACTIVE_TICK} height={Math.max(1000, (contentBottom ?? restRow) - restRow)} fill={SCROLL_TITLE_INK} listening={false} />}
        <Rect name="scroll-title-backing" x={x} y={stripY} width={bandW} height={stripH} fill={SCROLL_TITLE_HELD_FILL} shadowEnabled={holding} shadowColor="rgba(20,24,26,0.08)" shadowBlur={8 / scale} shadowOffsetY={3 / scale} listening={false} />
        <Rect name="scroll-title-hit" x={x} y={stripY} width={bandW} height={stripH} fill="rgba(0,0,0,0.001)" />
        {isActive && <Rect name="scroll-title-active-tick" x={x} y={stripY} width={SCROLL_TITLE_ACTIVE_TICK} height={stripH} fill={SCROLL_TITLE_INK} listening={false} />}
        <Text name="scroll-title-text" x={x + TITLE_INSET} y={textY} width={titleW} text={scroll.title} fontSize={fontSize} fontStyle={fontStyle} fontFamily="Inter, system-ui, sans-serif" fill={SCROLL_TITLE_INK} ellipsis wrap="none" opacity={0} listening={false} />
        <Line name="scroll-title-hairline" points={[x, stripY + stripH, x + bandW, stripY + stripH]} stroke={SCROLL_TITLE_HAIRLINE} strokeWidth={SCROLL_TITLE_HAIRLINE_WIDTH / (holding ? scale : 1)} listening={false} />
        {holding && <><Rect name="scroll-title-fade" x={x} y={stripY + stripH} width={bandW} height={SCROLL_TITLE_HELD_FADE_SCREEN_HEIGHT / scale} fillLinearGradientStartPoint={{ x: 0, y: 0 }} fillLinearGradientEndPoint={{ x: 0, y: SCROLL_TITLE_HELD_FADE_SCREEN_HEIGHT / scale }} fillLinearGradientColorStops={[0, SCROLL_TITLE_HELD_FILL, 1, 'rgba(255,255,255,0)']} listening={false} /><Rect name="scroll-title-progress" x={x} y={stripY + stripH - SCROLL_TITLE_PROGRESS_SCREEN_HEIGHT / scale} width={bandW * progress} height={SCROLL_TITLE_PROGRESS_SCREEN_HEIGHT / scale} fill={SCROLL_TITLE_INK} listening={false} /></>}
        <Html groupProps={{ x, y: stripY }} divProps={{ style: { pointerEvents: 'auto', zIndex: 6 } }}>{editingId === scroll.id ? <input ref={inputRef} className="scroll-header__input" defaultValue={scroll.title} data-testid="scroll-rename-input" style={{ marginLeft: TITLE_INSET, marginTop: textY - stripY, width: titleW, height: fontSize * 1.1, fontSize, fontWeight: fontStyle, letterSpacing: holding ? 0 : `${SCROLL_TITLE_RESTING_LETTER_SPACING}em` }} onBlur={() => commit(scroll)} onKeyDown={(event) => { if (event.key === 'Enter') commit(scroll); if (event.key === 'Escape') setEditingId(null); event.stopPropagation(); }} /> : <div className="scroll-title-strip" data-testid="scroll-title-strip" data-scroll-id={scroll.id} onDoubleClick={() => setEditingId(scroll.id)} onClick={() => setActiveScroll(scroll.id)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setActiveScroll(scroll.id); setMenu({ scrollId: scroll.id, x: event.clientX, y: event.clientY }); }} style={{ marginLeft: TITLE_INSET, marginTop: textY - stripY, width: titleW, height: fontSize * 1.1, fontSize, fontWeight: fontStyle, letterSpacing: holding ? 0 : `${SCROLL_TITLE_RESTING_LETTER_SPACING}em`, lineHeight: 1.1 }}>{scroll.title}</div>}</Html>
        {isResizing && <><Rect name="scroll-resize-width-badge" x={x + bandW - badgeW - 18 / scale} y={stripY + (stripH - RESIZE_BADGE_SCREEN_HEIGHT / scale) / 2} width={badgeW} height={RESIZE_BADGE_SCREEN_HEIGHT / scale} fill={SCROLL_TITLE_HELD_FILL} stroke={SCROLL_TITLE_HAIRLINE} strokeWidth={1 / scale} cornerRadius={3 / scale} listening={false} /><Text name="scroll-resize-width-text" x={x + bandW - badgeW - 18 / scale} y={stripY + (stripH - 11 / scale) / 2} width={badgeW} text={`${Math.round(bandW)} px`} align="center" fontSize={11 / scale} fontFamily="ui-monospace, Consolas, monospace" fill={SCROLL_TITLE_INK} listening={false} /><Line name="scroll-resize-preview-line" points={[x + bandW, -100000, x + bandW, 100000]} stroke={SCROLL_TITLE_INK} strokeWidth={1.5 / scale} dash={[6 / scale, 4 / scale]} listening={false} /></>}
        <Line name="scroll-resize-grip" points={[gripX + GRIP_SCREEN_WIDTH / (2 * scale), gripY, gripX + GRIP_SCREEN_WIDTH / (2 * scale), gripY + GRIP_SCREEN_HEIGHT / scale]} stroke={isResizing ? '#2563EB' : hoveredResizeId === scroll.id ? SCROLL_TITLE_INK : SCROLL_TITLE_HAIRLINE} strokeWidth={GRIP_SCREEN_WIDTH / scale} lineCap="round" listening={false} />
        <Rect name="scroll-resize-handle" x={x + bandW - RESIZE_HIT_SCREEN_WIDTH / (2 * scale)} y={stripY + (stripH - Math.max(stripH, RESIZE_HIT_SCREEN_HEIGHT / scale)) / 2} width={RESIZE_HIT_SCREEN_WIDTH / scale} height={Math.max(stripH, RESIZE_HIT_SCREEN_HEIGHT / scale)} fill="rgba(0,0,0,0.001)" draggable onMouseEnter={(event) => { setHoveredResizeId(scroll.id); setResizeCursor(event, 'col-resize'); }} onMouseLeave={(event) => { setHoveredResizeId(null); if (!resizeDrag.current) setResizeCursor(event, ''); }} onMouseDown={(event) => { const pointerX = event.target.getStage()?.getPointerPosition()?.x; if (pointerX != null) resizeDrag.current = { scrollId: scroll.id, pointerX, width: bandW }; }} onTouchStart={(event) => { const pointerX = event.target.getStage()?.getPointerPosition()?.x; if (pointerX != null) resizeDrag.current = { scrollId: scroll.id, pointerX, width: bandW }; }} onDragStart={(event) => { event.cancelBubble = true; setActiveScroll(scroll.id); setResizeCursor(event, 'col-resize'); }} onDragMove={(event) => { event.cancelBubble = true; const width = dragWidth(event); if (width != null) setLiveResizePreview({ scrollId: scroll.id, width }); }} onDragEnd={(event) => { event.cancelBubble = true; const width = dragWidth(event); resizeDrag.current = null; setLiveResizePreview(null); setResizeCursor(event, ''); if (width != null) resizeScroll(pageId, scroll.id, width); }} onDblClick={(event) => { event.cancelBubble = true; resizeDrag.current = null; setLiveResizePreview(null); resizeScroll(pageId, scroll.id, undefined); }} onDblTap={(event) => { event.cancelBubble = true; resizeDrag.current = null; setLiveResizePreview(null); resizeScroll(pageId, scroll.id, undefined); }} aria-label={`Resize ${scroll.title || 'scroll'}; double-click resets to ${A4_WIDTH}px`} />
      </Group>;
    })}
    {menu && <Html groupProps={{ x: 0, y: 0 }} divProps={{ style: { pointerEvents: 'auto' } }}><div className="context-menu" data-testid="scroll-header-menu" style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 100 }}>{menu.confirm ? <ScrollDeleteChoices onKeep={() => runDelete(menu.scrollId, false)} onDelete={() => runDelete(menu.scrollId, true)} /> : <><button type="button" className="context-menu__item" data-testid="move-scroll-left" disabled={menuIndex <= 0} onClick={() => { moveScroll(pageId, menu.scrollId, { direction: 'left' }); setMenu(null); }}>Move left</button><button type="button" className="context-menu__item" data-testid="move-scroll-right" disabled={menuIndex < 0 || menuIndex >= orderedScrolls.length - 1} onClick={() => { moveScroll(pageId, menu.scrollId, { direction: 'right' }); setMenu(null); }}>Move right</button><button type="button" className="context-menu__item" data-testid="fit-scroll-to-content" onClick={() => { fitScrollToContent(pageId, menu.scrollId); setMenu(null); }}>Fit scroll to content</button><button type="button" className="context-menu__item context-menu__item--danger" data-testid="delete-scroll" disabled={menuDelete?.isLast} title={menuDelete?.isLast ? "Can't delete the last scroll — clear the name instead" : 'Delete this scroll'} onClick={() => requestDelete(menu.scrollId)}>Delete scroll</button></>}</div></Html>}
  </Group>;
}
