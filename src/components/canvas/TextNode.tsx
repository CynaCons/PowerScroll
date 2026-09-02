import { useRef, useState, useEffect, useMemo } from 'react';
import { Group, Rect } from 'react-konva';
import { Html } from 'react-konva-utils';
import type Konva from 'konva';
import type { CanvasNode, TextNodeData } from '../../types/data';
import { undoBatchEnd, undoBatchStart } from '../../stores/useCanvasStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useDrawStore } from '../../stores/useDrawStore';
import { useToolStore } from '../../stores/useToolStore';
import { isNodeInteractive } from '../../utils/toolConfig';
import { generateId } from '../../utils/ids';
import {
  MIN_TEXT_WIDTH,
  MAX_TEXT_WIDTH,
  MIN_TEXT_HEIGHT,
  columnLeft,
  columnWidth,
} from '../../utils/pageLayout';
import { multiDragStart, multiDragMove, multiDragEnd } from '../../utils/multiDrag';
import { TextEditor } from './TextEditor';
import { calculateSnap, calculateScrollSnap, type SnapLine } from './SnapGuides';
import { markdownToHtml, markdownBoxStyle } from '../../utils/renderMarkdown';
import { reflowAfterHeightChange } from '../../utils/columnReflow';

// Handle powernote:// internal links
function handleInternalLink(href: string) {
  // Format: powernote://section-id/page-id
  const match = href.match(/^powernote:\/\/([^/]+)\/(.+)$/);
  if (!match) return;
  const [, sectionId, pageId] = match;
  const ws = useWorkspaceStore.getState();
  const canvas = useCanvasStore.getState();

  // Save current page nodes + strokes before navigating
  ws.savePageNodes(canvas.nodes);
  ws.savePageStrokes(useDrawStore.getState().strokes);
  ws.setActivePage(sectionId, pageId);

  const section = ws.workspace.sections.find((s) => s.id === sectionId);
  const page = section?.pages.find((p) => p.id === pageId);
  canvas.loadPageNodes(page?.nodes ?? []);
  useDrawStore.getState().loadPageStrokes(page?.strokes ?? []);
}

// Toggle a checkbox in raw markdown text by its index
function toggleCheckbox(text: string, checkboxIndex: number): string {
  let count = 0;
  return text.replace(/- \[([ x])\]/g, (match, state) => {
    if (count === checkboxIndex) {
      count++;
      return state === 'x' ? '- [ ]' : '- [x]';
    }
    count++;
    return match;
  });
}

interface TextNodeProps {
  node: CanvasNode;
  isSelected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  stageScale: number;
  autoEdit?: boolean;
  onSnapChange: (lines: SnapLine[]) => void;
}

export function TextNode({ node, isSelected, onSelect, stageScale, autoEdit, onSnapChange }: TextNodeProps) {
  const data = node.data as TextNodeData;
  const groupRef = useRef<Konva.Group>(null);
  const htmlRef = useRef<HTMLDivElement>(null);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const updateNodeSilent = useCanvasStore((s) => s.updateNodeSilent);
  const [isEditing, setIsEditing] = useState(!!autoEdit);
  const [hovered, setHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Only allow drag/hover in interactive modes (not draw or lasso)
  const activeTool = useToolStore((s) => s.activeTool);
  const isInteractive = isNodeInteractive(activeTool);

  // Parse markdown to HTML (with math pre-processing and clickable checkboxes)
  const renderedHtml = useMemo(() => markdownToHtml(data.text), [data.text]);

  // Height auto-sizes to laid-out content at the intentional width.
  // Width is intentional (page default or user resize) — never shrink-to-content.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!htmlRef.current) return;
      const h = Math.max(MIN_TEXT_HEIGHT, htmlRef.current.offsetHeight);
      if (Math.abs(h - (node.height || 0)) > 2) {
        // Pack the band when a block grows or shrinks. Neighbours (including
        // diagrams) move; a silent height write would overlap them.
        if (!reflowAfterHeightChange(node.id, h)) {
          updateNodeSilent(node.id, { height: h });
        }
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [renderedHtml, node.id, node.width, node.height, updateNodeSilent]);

  const clampTextWidth = (w: number) =>
    Math.min(MAX_TEXT_WIDTH, Math.max(MIN_TEXT_WIDTH, w));

  const handleWidthResizeMove = (
    e: Konva.KonvaEventObject<DragEvent>,
    side: 'left' | 'right',
  ) => {
    e.cancelBubble = true;
    const handle = e.target;
    const hx = handle.x() + 5; // handle center in local coords
    const current = useCanvasStore.getState().nodes.find((n) => n.id === node.id);
    if (!current) return;

    let newW = current.width;
    let newX = current.x;

    if (side === 'right') {
      newW = clampTextWidth(hx);
    } else {
      // Keep right edge fixed while dragging left edge
      newW = clampTextWidth(current.width - hx);
      newX = current.x + (current.width - newW);
    }

    updateNodeSilent(node.id, { x: newX, y: current.y, width: newW });

    // Snap handle back to edge (re-render will also correct)
    handle.x(side === 'right' ? newW - 5 : -5);
    handle.y(Math.max(MIN_TEXT_HEIGHT, current.height || MIN_TEXT_HEIGHT) / 2 - 5);
  };

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    // Ctrl+Alt+drag: duplicate the node, drag the duplicate
    if ((e.evt.ctrlKey || e.evt.metaKey) && e.evt.altKey) {
      const duplicate: CanvasNode = {
        ...node,
        id: generateId(),
        data: { ...node.data },
      };
      useCanvasStore.getState().addNode(duplicate);
    }
    multiDragStart(node.id, e.target.x(), e.target.y());
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    multiDragMove(node.id, e.target.x(), e.target.y(), e.target.getStage());
    // Shift snaps to other nodes; without it, the ungated magnet lines the block
    // up with the scroll band it is being dragged in.
    if (!e.evt.shiftKey) {
      const page = useWorkspaceStore.getState().getActivePage();
      const scrolls = page?.scrolls;
      const snap = calculateScrollSnap(
        { x: e.target.x(), y: e.target.y(), width: node.width },
        (c) => columnLeft(c, scrolls),
        (c) => columnWidth(c, scrolls),
        scrolls?.length ?? 0,
      );
      onSnapChange(snap.line ? [snap.line] : []);
      if (snap.line) {
        e.target.x(snap.x);
        multiDragMove(node.id, snap.x, e.target.y(), e.target.getStage());
      }
      return;
    }

    const allNodes = useCanvasStore.getState().nodes;
    const draggedBounds = {
      id: node.id,
      x: e.target.x(),
      y: e.target.y(),
      width: node.width,
      height: node.height || 30,
    };

    const snap = calculateSnap(draggedBounds, allNodes);
    onSnapChange(snap.lines);

    // Apply snap position
    e.target.x(snap.x);
    e.target.y(snap.y);
    multiDragMove(node.id, snap.x, snap.y, e.target.getStage());
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onSnapChange([]); // Clear guides
    multiDragEnd(node.id, e.target.x(), e.target.y());
  };

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
  };

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    const tool = useToolStore.getState().activeTool;
    if (tool === 'select' || tool === 'text' || tool === 'image') {
      const additive = e.evt.ctrlKey || e.evt.metaKey;
      onSelect(node.id, additive);
    }
  };

  const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    const tool = useToolStore.getState().activeTool;
    if (tool === 'select' || tool === 'text' || tool === 'image') {
      onSelect(node.id, false);
      setIsEditing(true);
    }
  };

  const handleFinishEdit = (newText: string) => {
    setIsEditing(false);
    updateNode(node.id, {
      data: { ...data, text: newText },
    });
    undoBatchEnd(); // End batch started on text placement (if any)
  };

  const handleCancelEdit = () => {
    undoBatchEnd(); // End batch even on cancel
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <TextEditor
        node={node}
        stageScale={stageScale}
        onFinish={handleFinishEdit}
        onCancel={handleCancelEdit}
      />
    );
  }

  const hasContent = data.text && data.text.trim().length > 0;
  const boxW = Math.max(node.width, MIN_TEXT_WIDTH);
  const boxH = Math.max(node.height || MIN_TEXT_HEIGHT, MIN_TEXT_HEIGHT);
  const showWidthHandles = isSelected && isInteractive;

  return (
    <Group
      ref={groupRef}
      nodeId={node.id}
      x={node.x}
      y={node.y}
      width={boxW}
      height={boxH}
      draggable={isInteractive}
      listening={isInteractive}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onMouseDown={handleMouseDown}
      onMouseEnter={(e) => {
        if (!isInteractive) return;
        setHovered(true);
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = 'pointer';
      }}
      onMouseLeave={(e) => {
        if (!isInteractive) return;
        setHovered(false);
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = 'default';
      }}
    >
      {/* Invisible hit area for click/dblclick — matches intentional box size */}
      <Rect
        id={node.id}
        x={-4}
        y={-4}
        width={boxW + 8}
        height={boxH + 8}
        fill="transparent"
        onClick={handleClick}
        onTap={handleClick}
        onDblClick={handleDblClick}
        onDblTap={handleDblClick}
      />

      {/* Markdown-rendered HTML overlay — selection highlight applied via CSS */}
      <Html
        groupProps={{ x: 0, y: 0 }}
        divProps={{
          style: { pointerEvents: 'none', zIndex: 1 },
          className: 'powernote-html-overlay',
        }}
      >
        <div
          ref={htmlRef}
          className={`powernote-markdown ${isSelected ? 'powernote-markdown--selected' : ''} ${hovered && !isSelected ? 'powernote-markdown--hovered' : ''}`}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            // Handle checkbox clicks
            if (target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox') {
              e.stopPropagation();
              const checkboxes = htmlRef.current?.querySelectorAll('input[type="checkbox"]');
              if (checkboxes) {
                const idx = Array.from(checkboxes).indexOf(target as HTMLInputElement);
                if (idx >= 0) {
                  const newText = toggleCheckbox(data.text, idx);
                  updateNode(node.id, { data: { ...data, text: newText } });
                }
              }
            }
            // Handle link clicks
            if (target.tagName === 'A') {
              e.stopPropagation();
              e.preventDefault();
              const href = target.getAttribute('href') || '';
              if (href.startsWith('powernote://')) {
                handleInternalLink(href);
              } else if (href.startsWith('http://') || href.startsWith('https://')) {
                window.open(href, '_blank', 'noopener');
              }
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY });
          }}
          style={markdownBoxStyle(data, boxW, hasContent ? data.fill : '#999999')}
          dangerouslySetInnerHTML={{
            __html: hasContent ? renderedHtml : '<p>Double-click to edit</p>',
          }}
        />
        {/* Context menu for inserting links */}
        {contextMenu && (
          <LinkContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onInsertLink={(sectionId, pageId, pageTitle) => {
              const link = `[${pageTitle}](powernote://${sectionId}/${pageId})`;
              updateNode(node.id, {
                data: { ...data, text: data.text + '\n' + link },
              });
              setContextMenu(null);
            }}
            onClose={() => setContextMenu(null)}
          />
        )}
      </Html>

      {/* Width-only resize handles (height stays content-driven) */}
      {showWidthHandles &&
        (
          [
            { side: 'left' as const, cx: 0 },
            { side: 'right' as const, cx: boxW },
          ] as const
        ).map(({ side, cx }) => (
          <Rect
            key={`text-w-${side}`}
            name={`text-width-handle-${side}`}
            x={cx - 5}
            y={boxH / 2 - 5}
            width={10}
            height={10}
            fill="#ffffff"
            stroke="#2563eb"
            strokeWidth={1}
            cornerRadius={2}
            draggable
            onMouseDown={(e) => {
              e.cancelBubble = true;
            }}
            onMouseEnter={(e) => {
              e.target.getStage()!.container().style.cursor = 'ew-resize';
            }}
            onMouseLeave={(e) => {
              e.target.getStage()!.container().style.cursor = 'default';
            }}
            onDragStart={(e) => {
              e.cancelBubble = true;
              // One undo entry for the whole resize gesture
              undoBatchStart(useCanvasStore.getState().nodes);
            }}
            onDragMove={(e) => handleWidthResizeMove(e, side)}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              undoBatchEnd();
              // Snap handle to final edge
              const current = useCanvasStore.getState().nodes.find((n) => n.id === node.id);
              if (current) {
                e.target.x(side === 'right' ? current.width - 5 : -5);
                e.target.y(Math.max(MIN_TEXT_HEIGHT, current.height || MIN_TEXT_HEIGHT) / 2 - 5);
              }
            }}
          />
        ))}
    </Group>
  );
}

function LinkContextMenu({
  x,
  y,
  onInsertLink,
  onClose,
}: {
  x: number;
  y: number;
  onInsertLink: (sectionId: string, pageId: string, pageTitle: string) => void;
  onClose: () => void;
}) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const [showPages, setShowPages] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      data-testid="link-context-menu"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 9999,
        minWidth: 180,
        padding: '4px 0',
        fontSize: 13,
        pointerEvents: 'auto',
      }}
    >
      {!showPages ? (
        <div
          style={{ padding: '6px 12px', cursor: 'pointer' }}
          onClick={() => setShowPages(true)}
          onMouseOver={(e) => ((e.target as HTMLElement).style.background = '#f0f0f0')}
          onMouseOut={(e) => ((e.target as HTMLElement).style.background = 'transparent')}
        >
          Insert Link to Page...
        </div>
      ) : (
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {workspace.sections.map((section) =>
            section.pages.map((page) => (
              <div
                key={page.id}
                style={{ padding: '4px 12px', cursor: 'pointer' }}
                onClick={() => onInsertLink(section.id, page.id, page.title)}
                onMouseOver={(e) => ((e.target as HTMLElement).style.background = '#f0f0f0')}
                onMouseOut={(e) => ((e.target as HTMLElement).style.background = 'transparent')}
              >
                {section.title} / {page.title}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
