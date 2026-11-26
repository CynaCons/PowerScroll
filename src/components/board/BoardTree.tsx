import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardCard, BoardEvent } from '../../types/data';
import { agentTrails, createTreeLayouter, type TreeAgent } from '../../board/treeLayout';
import { BoardTreeRenderer, TREE_SHOW_DEFAULT, type TreeShow } from './boardTreeRenderer';
import { avatarColor } from './boardUi';

/** The readability switches are a viewer preference, kept in this browser only. */
const SHOW_KEY = 'powerscroll-tree-show';
const SHOW_ITEMS: Array<{ key: keyof TreeShow; label: string }> = [
  { key: 'arcs', label: 'Topic progress arcs' },
  { key: 'now', label: '"Now" marks on each branch' },
  { key: 'ready', label: 'Ready-next markers' },
  { key: 'trail', label: 'Agent trail' },
];

function readShow(): TreeShow {
  try {
    const raw = localStorage.getItem(SHOW_KEY);
    if (raw) return { ...TREE_SHOW_DEFAULT, ...(JSON.parse(raw) as Partial<TreeShow>) };
  } catch { /* storage blocked or bad JSON: defaults */ }
  return { ...TREE_SHOW_DEFAULT };
}

interface BoardTreeProps {
  cards: BoardCard[];
  events: BoardEvent[];
  quietCardIds: Set<string>;
  /** Connected agents that hold a card on this board. */
  agents: TreeAgent[];
  /** Per agent: what the tooltip says ("working now", "holding", "quiet 15 min"). */
  agentNotes: Record<string, string>;
  spotlight: string | null;
  title: string;
  onOpenCard: (cardId: string) => void;
}

export function BoardTree({ cards, events, quietCardIds, agents, agentNotes, spotlight, title, onOpenCard }: BoardTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<BoardTreeRenderer | null>(null);
  const layouter = useRef(createTreeLayouter());
  const openRef = useRef(onOpenCard);
  openRef.current = onOpenCard;

  // The board object changes on every note; the layouter hands back the same layout unless the picture changes.
  const layout = useMemo(
    () => layouter.current(cards, events, quietCardIds, agents),
    [cards, events, quietCardIds, agents],
  );
  const needCount = useMemo(
    () => layout.nodes.filter((node) => node.kind === 'card' && node.fault).length,
    [layout],
  );
  const [show, setShow] = useState<TreeShow>(readShow);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const trails = useMemo(() => {
    if (!show.trail) return [];
    const colors = new Map(agents.map((agent) => [agent.name, agent.color]));
    return agentTrails(cards, events, (name) => colors.get(name) ?? avatarColor(name));
  }, [show.trail, cards, events, agents]);
  const topicCount = useMemo(() => layout.nodes.filter((node) => node.kind === 'topic').length, [layout]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const tip = tipRef.current;
    if (!container || !canvas || !tip) return undefined;
    const renderer = new BoardTreeRenderer(container, canvas, tip, (id) => openRef.current(id));
    rendererRef.current = renderer;
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setTitle(title);
    rendererRef.current?.setLayout(layout);
  }, [layout, title]);

  useEffect(() => {
    rendererRef.current?.setAgentNotes(agentNotes);
  }, [agentNotes]);

  useEffect(() => {
    rendererRef.current?.setShow(show);
    try { localStorage.setItem(SHOW_KEY, JSON.stringify(show)); } catch { /* not kept */ }
  }, [show]);

  useEffect(() => {
    rendererRef.current?.setTrails(trails);
  }, [trails]);

  // The menu closes on a click outside it or on Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // After the layout, so the spotlight finds its node when both change together.
  useEffect(() => {
    rendererRef.current?.setSpotlight(spotlight);
  }, [spotlight, layout]);

  return (
    <div className="board-tree" data-testid="board-tree" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="board-tree__canvas"
        data-testid="board-tree-canvas"
        tabIndex={0}
        aria-label={`Board tree: ${topicCount} topic${topicCount === 1 ? '' : 's'}, ${cards.length} card${cards.length === 1 ? '' : 's'}, ${needCount} need${needCount === 1 ? 's' : ''} you`}
      />
      <div className="board-tree__tip" ref={tipRef} hidden role="tooltip" />
      <div className="board-tree__buttons">
        {needCount > 0 && (
          <button
            type="button"
            className="board-tree__need"
            data-testid="board-tree-need"
            onClick={() => rendererRef.current?.nextFault()}
          >
            {needCount} need you
          </button>
        )}
        <div className="board-tree__show" ref={menuRef}>
          <button
            type="button"
            className="board-tree__fit"
            data-testid="board-tree-show"
            aria-expanded={menuOpen}
            aria-haspopup="true"
            onClick={() => setMenuOpen((open) => !open)}
          >
            Show
          </button>
          {menuOpen && (
            <div className="board-tree__menu" data-testid="board-tree-show-menu" role="group" aria-label="Show on the tree">
              {SHOW_ITEMS.map((item) => (
                <label key={item.key} className="board-tree__option">
                  <input
                    type="checkbox"
                    data-testid={`board-tree-show-${item.key}`}
                    checked={show[item.key]}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setShow((current) => ({ ...current, [item.key]: checked }));
                    }}
                  />
                  {item.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="board-tree__fit"
          data-testid="board-tree-fit"
          onClick={() => rendererRef.current?.fit()}
        >
          Fit
        </button>
      </div>
    </div>
  );
}
