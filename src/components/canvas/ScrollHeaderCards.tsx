import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollText } from 'lucide-react';
import type { BackgroundMode, CanvasBgColor, ScrollRecord } from '../../types/data';
import {
  A4_HEIGHT,
  MAX_SCROLL_WIDTH,
  MIN_SCROLL_WIDTH,
  columnAt,
  columnLeft,
  columnWidth,
  SCROLL_TITLE_RESTING_Y,
} from '../../utils/pageLayout';
import { CEILING_HEADROOM, pageCeiling } from '../../utils/scrollCeiling';
import {
  deleteScroll,
  fitScrollToContent,
  liveScrollDeleteInfo,
  moveScroll,
  renameScroll,
  resizeScroll,
} from '../../utils/scrollOps';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useDrawStore } from '../../stores/useDrawStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { scrollPageRange } from './PageGuides';
import { ScrollDeleteChoices } from './ScrollDeleteChoices';

interface ScrollHeaderCardsProps {
  mode: BackgroundMode;
  scrolls: ScrollRecord[];
  pageId: string;
  bgColor: CanvasBgColor;
  onResizePreviewChange?: (preview: { scrollId: string; width: number } | null) => void;
}

const CARD_HEIGHT = 44;
const BODY_GAP = 6;
const PIN_TOP = 8;
const REST_CLEARANCE = CEILING_HEADROOM - PIN_TOP - CARD_HEIGHT - BODY_GAP;

/**
 * The lowest content y of every band, in one pass over the page. Per frame of a
 * pan this used to be one pass per scroll, which on a page with 40 scrolls was
 * 40 walks over every block and stroke point on each wheel tick.
 */
function bandContentBottoms(
  nodes: Array<{ x: number; y: number; height?: number }>,
  strokes: Array<{ points: readonly number[] }>,
  scrolls: ScrollRecord[],
): Map<number, number> {
  const bottoms = new Map<number, number>();
  const lower = (column: number, y: number) => {
    const current = bottoms.get(column);
    if (current === undefined || y > current) bottoms.set(column, y);
  };
  for (const node of nodes) lower(columnAt(node.x, scrolls), node.y + (node.height || 30));
  for (const stroke of strokes) {
    const column = columnAt(stroke.points[0] ?? 0, scrolls);
    for (let i = 1; i < stroke.points.length; i += 2) lower(column, stroke.points[i]);
  }
  return bottoms;
}

/** Screen-space title cards deliberately sit above every page-content canvas/HTML layer. */
export function ScrollHeaderCards({
  mode,
  scrolls,
  pageId,
  bgColor,
  onResizePreviewChange,
}: ScrollHeaderCardsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resizePreview, setResizePreview] = useState<{
    scrollId: string;
    width: number;
  } | null>(null);
  const [menu, setMenu] = useState<{
    scrollId: string;
    x: number;
    y: number;
    confirm?: boolean;
  } | null>(null);
  const drag = useRef<{
    scrollId: string;
    pointerX: number;
    width: number;
    scale: number;
  } | null>(null);
  const setActiveScroll = useWorkspaceStore((s) => s.setActiveScroll);
  const activeScrollId = useWorkspaceStore((s) => s.activeScrollId);
  const viewport = useCanvasStore((s) => s.viewport);
  const nodes = useCanvasStore((s) => s.nodes);
  const strokes = useDrawStore((s) => s.strokes);
  const ceiling = useMemo(() => pageCeiling(nodes, strokes, scrolls), [nodes, strokes, scrolls]);

  const setLiveResizePreview = (next: { scrollId: string; width: number } | null) => {
    setResizePreview(next);
    onResizePreviewChange?.(next);
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (!current) return;
      const width = Math.max(
        MIN_SCROLL_WIDTH,
        Math.min(
          MAX_SCROLL_WIDTH,
          current.width + (event.clientX - current.pointerX) / current.scale,
        ),
      );
      setLiveResizePreview({ scrollId: current.scrollId, width });
    };
    const onUp = (event: PointerEvent) => {
      const current = drag.current;
      if (!current) return;
      const width = Math.max(
        MIN_SCROLL_WIDTH,
        Math.min(
          MAX_SCROLL_WIDTH,
          current.width + (event.clientX - current.pointerX) / current.scale,
        ),
      );
      drag.current = null;
      setLiveResizePreview(null);
      resizeScroll(pageId, current.scrollId, width);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [pageId]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (
        !(
          event.target instanceof Element &&
          event.target.closest('[data-testid="scroll-header-menu"]')
        )
      ) {
        setMenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menu]);

  const displayScrolls = useMemo(() => (resizePreview
    ? scrolls.map((scroll) =>
        scroll.id === resizePreview.scrollId
          ? { ...scroll, width: resizePreview.width }
          : scroll,
      )
    : scrolls), [scrolls, resizePreview]);
  const contentBottoms = useMemo(
    () => bandContentBottoms(nodes, strokes, displayScrolls),
    [nodes, strokes, displayScrolls],
  );
  const pageRange = useMemo(() => scrollPageRange(nodes, displayScrolls), [nodes, displayScrolls]);

  if (mode !== 'scroll' && mode !== 'pages') return null;
  const orderedScrolls = [...displayScrolls].sort((a, b) => a.column - b.column);
  // The card rests on the page's top row: the derived ceiling, or the legacy
  // 12-unit inset on pages without one. (scrollTitleY would report its pinned
  // value here whenever the ceiling is negative.)
  const restRow = ceiling ?? SCROLL_TITLE_RESTING_Y;
  const scale = Math.max(viewport.scale || 1, 0.1);
  const viewportTop = -viewport.y / scale;
  const stageHeight = (
    globalThis as { Konva?: { stages?: Array<{ height: () => number }> } }
  ).Konva?.stages?.[0]?.height() ?? 800;
  const viewportHeight = stageHeight / scale;
  const pageCount = pageRange.lastRow - pageRange.firstRow + 1;
  const pageAtTop = Math.max(
    1,
    Math.min(
      pageCount,
      Math.floor(viewportTop / A4_HEIGHT) - pageRange.firstRow + 1,
    ),
  );
  const menuIndex = menu
    ? orderedScrolls.findIndex((scroll) => scroll.id === menu.scrollId)
    : -1;
  const menuDelete = menu ? liveScrollDeleteInfo(pageId, menu.scrollId) : null;
  const canvasColor = bgColor === 'paper' ? '#f5f0e8' : bgColor;

  return (
    <div
      className={`scroll-header-cards ${
        bgColor === 'paper' ? 'scroll-header-cards--paper' : ''
      }`}
      aria-hidden={false}
    >
      {displayScrolls.map((scroll) => {
        if (!scroll.title && editingId !== scroll.id) return null;

        const x = columnLeft(scroll.column, displayScrolls);
        const bandW = columnWidth(scroll.column, displayScrolls);
        const screenX = viewport.x + x * scale;
        const screenW = bandW * scale;
        const restingTop =
          viewport.y +
          restRow * scale -
          CARD_HEIGHT -
          BODY_GAP -
          REST_CLEARANCE;
        // Half a pixel of slack: at the camera clamp restingTop is PIN_TOP up to
        // floating-point error, and that is still the resting card.
        const holding = restingTop < PIN_TOP - 0.5;
        const top = holding ? PIN_TOP : restingTop;
        const isActive =
          (activeScrollId ??
            orderedScrolls.find((candidate) => candidate.title)?.id) === scroll.id;
        const contentBottom = contentBottoms.get(scroll.column) ?? null;
        const progress =
          contentBottom == null
            ? 0
            : Math.max(
                0,
                Math.min(
                  1,
                  (viewportTop - restRow) /
                    Math.max(1, contentBottom - restRow - viewportHeight),
                ),
              );
        const bodyTop = top + CARD_HEIGHT + BODY_GAP;
        const commit = (value: string) => {
          const next = value.trim();
          if (next !== scroll.title) renameScroll(pageId, scroll.id, next);
          setEditingId(null);
        };

        return (
          <div
            key={scroll.id}
            className="scroll-header-card-wrap"
            style={{ left: screenX, width: screenW }}
          >
            {holding && (
              <div
                className="scroll-header-mask"
                data-testid="scroll-header-mask"
                style={{ height: bodyTop, backgroundColor: canvasColor }}
              />
            )}
            <div
              className={`scroll-header-card ${
                isActive ? 'scroll-header-card--active' : ''
              } ${holding ? 'scroll-header-card--pinned' : ''}`}
              data-testid="scroll-header-card"
              data-scroll-id={scroll.id}
              data-pinned={holding ? 'true' : 'false'}
              data-progress={progress.toFixed(4)}
              style={{ top }}
              onClick={() => setActiveScroll(scroll.id)}
              onDoubleClick={() => setEditingId(scroll.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setActiveScroll(scroll.id);
                setMenu({
                  scrollId: scroll.id,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              <ScrollText
                className="scroll-header-card__icon"
                size={16}
                strokeWidth={2}
                aria-hidden="true"
              />
              {editingId === scroll.id ? (
                <input
                  autoFocus
                  className="scroll-header-card__input"
                  data-testid="scroll-rename-input"
                  defaultValue={scroll.title}
                  onBlur={(event) => commit(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commit(event.currentTarget.value);
                    if (event.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <span
                  className="scroll-title-strip scroll-header-card__title"
                  data-testid="scroll-title-strip"
                >
                  {scroll.title}
                </span>
              )}
              <span className="scroll-header-card__counter">
                page {pageAtTop} of {pageCount}
              </span>
              {resizePreview?.scrollId === scroll.id && (
                <span
                  className="scroll-resize-width-text"
                  data-testid="scroll-resize-width-text"
                >
                  {Math.round(bandW)} px
                </span>
              )}
              <button
                type="button"
                className="scroll-resize-handle"
                data-testid="scroll-resize-handle"
                aria-label={`Resize ${
                  scroll.title || 'scroll'
                }; double-click resets to ${Math.round(bandW)}px`}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  drag.current = null;
                  setLiveResizePreview(null);
                  resizeScroll(pageId, scroll.id, undefined);
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  drag.current = {
                    scrollId: scroll.id,
                    pointerX: event.clientX,
                    width: bandW,
                    scale,
                  };
                  setActiveScroll(scroll.id);
                }}
              />
              <span
                className="scroll-header-card__progress"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        );
      })}
      {menu && (
        <div
          className="context-menu scroll-header-menu"
          data-testid="scroll-header-menu"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.confirm ? (
            <ScrollDeleteChoices
              onKeep={() => {
                deleteScroll(pageId, menu.scrollId, false);
                setMenu(null);
              }}
              onDelete={() => {
                deleteScroll(pageId, menu.scrollId, true);
                setMenu(null);
              }}
            />
          ) : (
            <>
              <button
                type="button"
                className="context-menu__item"
                data-testid="move-scroll-left"
                disabled={menuIndex <= 0}
                onClick={() => {
                  moveScroll(pageId, menu.scrollId, { direction: 'left' });
                  setMenu(null);
                }}
              >
                Move left
              </button>
              <button
                type="button"
                className="context-menu__item"
                data-testid="move-scroll-right"
                disabled={
                  menuIndex < 0 || menuIndex >= orderedScrolls.length - 1
                }
                onClick={() => {
                  moveScroll(pageId, menu.scrollId, { direction: 'right' });
                  setMenu(null);
                }}
              >
                Move right
              </button>
              <button
                type="button"
                className="context-menu__item"
                data-testid="fit-scroll-to-content"
                onClick={() => {
                  fitScrollToContent(pageId, menu.scrollId);
                  setMenu(null);
                }}
              >
                Fit scroll to content
              </button>
              <button
                type="button"
                className="context-menu__item context-menu__item--danger"
                data-testid="delete-scroll"
                disabled={menuDelete?.isLast}
                onClick={() => {
                  if (menuDelete?.empty) {
                    deleteScroll(pageId, menu.scrollId, false);
                    setMenu(null);
                    return;
                  }
                  setMenu((current) =>
                    current ? { ...current, confirm: true } : current,
                  );
                }}
              >
                Delete scroll
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
