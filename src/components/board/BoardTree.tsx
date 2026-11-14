import { useEffect, useMemo, useRef } from 'react';
import type { BoardCard, BoardEvent } from '../../types/data';
import { createTreeLayouter, type TreeAgent } from '../../board/treeLayout';
import { BoardTreeRenderer } from './boardTreeRenderer';

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
