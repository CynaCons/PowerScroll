import { useState, useRef, useEffect } from 'react';
import { ScrollText, FileText, Pencil, X, Plus, SquareKanban } from 'lucide-react';
import { deleteScroll, liveScrollDeleteInfo } from '../../utils/scrollOps';
import { ScrollDeleteChoices } from '../canvas/ScrollDeleteChoices';
import '../canvas/ContextMenu.css';
import type { Page } from '../../types/data';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import './HierarchyPanel.css';

interface PageItemProps {
  page: Page;
  pageIndex: number;
  sectionId: string;
  isActive: boolean;
  onNavigate: (sectionId: string, pageId: string) => void;
  onRenamePage: (sectionId: string, pageId: string, title: string) => void;
  onDeletePage: (sectionId: string, pageId: string) => void;
  onReorderPage: (fromIndex: number, toIndex: number) => void;
  onOpenScroll: (sectionId: string, pageId: string, scrollId: string, column: number) => void;
}

export function PageItem({
  page,
  pageIndex,
  sectionId,
  isActive,
  onNavigate,
  onRenamePage,
  onDeletePage,
  onReorderPage,
  onOpenScroll,
}: PageItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleRenameCommit = () => {
    const val = inputRef.current?.value.trim();
    if (val && val !== page.title) {
      onRenamePage(sectionId, page.id, val);
    }
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameCommit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsRenaming(false);
    }
  };

  if (isRenaming) {
    return (
      <div className="hierarchy-page hierarchy-page--renaming" data-testid={`page-${page.id}`}>
        {page.kind === 'board' ? <SquareKanban size={14} /> : <FileText size={14} />}
        <input
          ref={inputRef}
          className="hierarchy-page__rename-input"
          defaultValue={page.title}
          onBlur={handleRenameCommit}
          onKeyDown={handleRenameKeyDown}
          data-testid="page-rename-input"
        />
      </div>
    );
  }

  return (
    <div
      className={`hierarchy-page ${isActive ? 'hierarchy-page--active' : ''}`}
      data-testid={`page-${page.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('powernote/page-index', String(pageIndex));
        e.dataTransfer.setData('powernote/page-section', sectionId);
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation(); // Don't trigger section drag
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('powernote/page-index')) {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.classList.add('hierarchy-page--dragover');
        }
      }}
      onDragLeave={(e) => {
        e.currentTarget.classList.remove('hierarchy-page--dragover');
      }}
      onDrop={(e) => {
        e.currentTarget.classList.remove('hierarchy-page--dragover');
        e.stopPropagation();
        const fromStr = e.dataTransfer.getData('powernote/page-index');
        if (fromStr !== '') {
          e.preventDefault();
          onReorderPage(Number(fromStr), pageIndex);
        }
      }}
    >
      <button
        className="hierarchy-page__nav"
        onClick={() => onNavigate(sectionId, page.id)}
        title={page.title}
      >
        {page.kind === 'board' ? <SquareKanban size={14} /> : <FileText size={14} />}
        <span className="hierarchy-page__title" data-testid="page-title">{page.title}</span>
      </button>
      <div className="hierarchy-page__actions">
        <button
          className="hierarchy-page__action-btn"
          onClick={(e) => {
            e.stopPropagation();
            setIsRenaming(true);
          }}
          title="Rename page"
          data-testid="rename-page-btn"
        >
          <Pencil size={12} />
        </button>
        <button
          className="hierarchy-page__action-btn hierarchy-page__action-btn--danger"
          onClick={(e) => {
            e.stopPropagation();
            onDeletePage(sectionId, page.id);
          }}
          title="Delete page"
          data-testid="delete-page-btn"
        >
          <X size={12} />
        </button>
      </div>
      {page.kind !== 'board' && <ScrollList page={page} isActive={isActive} sectionId={sectionId} onOpenScroll={onOpenScroll} />}
    </div>
  );
}

/**
 * Named scrolls listed under their page — the sidebar half of scroll identity.
 *
 * Only named ones appear: every pre-v0.31 page is backfilled with an untitled
 * scroll, so listing those would add a meaningless row under every page in the
 * notebook. Nothing renders at all unless a page has at least one named scroll,
 * which keeps single-column notebooks looking exactly as they did.
 */
function ScrollList({
  page,
  isActive,
  sectionId,
  onOpenScroll,
}: {
  page: Page;
  isActive: boolean;
  sectionId: string;
  onOpenScroll: (sectionId: string, pageId: string, scrollId: string, column: number) => void;
}) {
  const activeScrollId = useWorkspaceStore((s) => s.activeScrollId);
  const createScroll = useWorkspaceStore((s) => s.createScroll);
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const named = [...(page.scrolls ?? [])]
    .filter((s) => s.title)
    .sort((a, b) => a.column - b.column);

  // Nothing to show for a collapsed page with no named scrolls. The add row is
  // offered on the OPEN page only: under every page in the tree it would be
  // noise, and it would be ambiguous which page a click was adding to.
  if (!isActive && named.length === 0) return null;

  // An unnamed scroll draws no header, so a blank name would create something
  // invisible. Cancel instead, the same as Escape.
  const commit = () => {
    const title = draft.trim();
    if (title) {
      const record = createScroll(page.id, title);
      if (record) onOpenScroll(sectionId, page.id, record.id, record.column);
    }
    setDraft('');
    setAdding(false);
  };

  return (
    <div className="hierarchy-scrolls" data-testid={`page-scrolls-${page.id}`}>
      {named.map((scroll) => {
        // Only the open page can have an active scroll — highlighting one under
        // a different page would claim a state that is not in effect.
        const isActiveScroll = isActive && activeScrollId === scroll.id;
        const info = liveScrollDeleteInfo(page.id, scroll.id);
        const canDelete = !!info && !info.isLast;
        return (
          <div
            key={scroll.id}
            className={`hierarchy-scroll${isActiveScroll ? ' hierarchy-scroll--active' : ''}`}
          >
            <button
              type="button"
              className="hierarchy-scroll__nav"
              data-testid={`scroll-${scroll.id}`}
              data-active={isActiveScroll ? 'true' : 'false'}
              title={scroll.title}
              onClick={() => onOpenScroll(sectionId, page.id, scroll.id, scroll.column)}
            >
              <ScrollText size={12} />
              <span className="hierarchy-scroll__title">{scroll.title}</span>
            </button>
            {canDelete && (
              <button
                type="button"
                className="hierarchy-page__action-btn hierarchy-page__action-btn--danger"
                data-testid={`delete-scroll-${scroll.id}`}
                title="Delete scroll"
                onClick={(e) => {
                  e.stopPropagation();
                  if (info.empty) {
                    deleteScroll(page.id, scroll.id, false);
                    setConfirmId(null);
                    return;
                  }
                  setConfirmId((id) => (id === scroll.id ? null : scroll.id));
                }}
              >
                <X size={12} />
              </button>
            )}
            {confirmId === scroll.id && (
              <div className="context-menu hierarchy-scroll__confirm" data-testid="scroll-delete-confirm">
                <ScrollDeleteChoices
                  onKeep={() => {
                    deleteScroll(page.id, scroll.id, false);
                    setConfirmId(null);
                  }}
                  onDelete={() => {
                    deleteScroll(page.id, scroll.id, true);
                    setConfirmId(null);
                  }}
                />
              </div>
            )}
          </div>
        );
      })}

      {!isActive ? null : adding ? (
        <input
          className="hierarchy-scroll__new"
          data-testid={`new-scroll-input-${page.id}`}
          placeholder="Scroll name"
          aria-label="New scroll name"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
        />
      ) : (
        <button
          className="hierarchy-scroll-add"
          data-testid={`new-scroll-${page.id}`}
          onClick={() => setAdding(true)}
        >
          <Plus size={12} />
          <span className="hierarchy-scroll__title">New scroll</span>
        </button>
      )}
    </div>
  );
}
