import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Search, X, Replace } from 'lucide-react';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useSearchStore } from '../../stores/useSearchStore';
import { collectEntries, runSearch, warmEntries, type SearchResult } from '../../search/searchIndex';
import { openSearchResult } from '../../search/openResult';
import type { TextNodeData } from '../../types/data';
import './SearchPanel.css';

/** Rendering more rows than this costs keystrokes and helps nobody; the count stays exact. */
const SHOWN = 200;

/**
 * One search panel for canvas and board pages (docs/SRS_SEARCH.md). It finds
 * what the reader sees across the page or the notebook, marks every match,
 * and takes the user to the result; Replace All still edits text blocks only
 * (REQ-SEARCH-007).
 */
export function SearchPanel() {
  const open = useSearchStore((s) => s.open);
  const scope = useSearchStore((s) => s.scope);
  const focusTick = useSearchStore((s) => s.focusTick);
  const setScope = useSearchStore((s) => s.setScope);
  const close = useSearchStore((s) => s.close);

  const [query, setQuery] = useState('');
  const [replaceMode, setReplaceMode] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const nodes = useCanvasStore((s) => s.nodes);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const activeSectionId = useWorkspaceStore((s) => s.activeSectionId);
  const activePageId = useWorkspaceStore((s) => s.activePageId);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [open, focusTick]);

  const entries = useMemo(() => {
    if (!open) return [];
    const all = collectEntries(workspace, scope, activeSectionId, activePageId, nodes);
    warmEntries(all);
    return all;
  }, [open, workspace, scope, activeSectionId, activePageId, nodes]);
  const results = useMemo(() => runSearch(entries, query), [entries, query]);

  useEffect(() => setActive(0), [query, scope]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = useCallback((result: SearchResult | undefined) => {
    if (result) openSearchResult(result.entry);
  }, []);

  const replaceAll = useCallback(() => {
    if (!query.trim()) return;
    const q = query;

    // Replace in active page's canvas nodes (live store)
    for (const n of nodes) {
      if (n.type !== 'text') continue;
      const data = n.data as TextNodeData;
      const oldText = data.text || '';
      if (!oldText.includes(q)) continue;
      updateNode(n.id, { data: { ...data, text: oldText.split(q).join(replacement) } });
    }

    // For notebook-wide replace, also update non-active pages via workspace store
    if (scope === 'notebook') {
      const ws = useWorkspaceStore.getState().workspace;
      const updatedSections = ws.sections.map((section) => ({
        ...section,
        pages: section.pages.map((page) => {
          const isActivePage = section.id === activeSectionId && page.id === activePageId;
          if (isActivePage) return page; // already handled via canvas store above
          const updatedNodes = page.nodes.map((node) => {
            if (node.type !== 'text') return node;
            const text = (node.data as TextNodeData).text || '';
            if (!text.includes(q)) return node;
            return { ...node, data: { ...node.data, text: text.split(q).join(replacement) } };
          });
          return { ...page, nodes: updatedNodes };
        }),
      }));
      useWorkspaceStore.setState({ workspace: { ...ws, sections: updatedSections }, isDirty: true });
    }
  }, [query, replacement, nodes, updateNode, activeSectionId, activePageId, scope]);

  if (!open) return null;

  const shown = results.slice(0, SHOWN);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' && shown.length) {
      e.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' && shown.length) {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && e.target === inputRef.current) {
      e.preventDefault();
      choose(shown[active]);
    }
  };

  const scopeButton = (value: 'page' | 'notebook', label: string) => (
    <button
      type="button"
      className={`search-panel__scope ${scope === value ? 'search-panel__scope--active' : ''}`}
      aria-pressed={scope === value}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        setScope(value);
        inputRef.current?.focus();
      }}
      data-testid={`search-scope-${value}`}
    >
      {label}
    </button>
  );

  let lastGroup = '';
  return (
    <div className="search-panel" data-testid="search-panel" onKeyDown={onKeyDown}>
      <div className="search-panel__header">
        <Search size={16} />
        <input
          ref={inputRef}
          className="search-panel__input"
          placeholder={scope === 'notebook' ? 'Search notebook...' : 'Search this page...'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          role="combobox"
          aria-expanded={!!query.trim()}
          aria-controls="search-results"
          aria-activedescendant={shown.length ? `search-result-${active}` : undefined}
          aria-label="Search"
          data-testid="search-input"
        />
        <span className="search-panel__count" data-testid="search-count">
          {query.trim() ? `${results.length} result${results.length !== 1 ? 's' : ''}` : ''}
        </span>
        <button
          className={`search-panel__toggle ${replaceMode ? 'search-panel__toggle--active' : ''}`}
          onClick={() => setReplaceMode((v) => !v)}
          title="Replace in text blocks"
          aria-pressed={replaceMode}
          data-testid="search-replace-toggle"
        >
          <Replace size={14} />
        </button>
        <button className="search-panel__close" onClick={close} title="Close (Esc)" aria-label="Close search">
          <X size={16} />
        </button>
      </div>
      <div className="search-panel__scopes" role="group" aria-label="Search in">
        {scopeButton('page', 'This page')}
        {scopeButton('notebook', 'Whole notebook')}
      </div>
      {replaceMode && (
        <div className="search-panel__replace-row" data-testid="search-replace-row">
          <input
            className="search-panel__input"
            placeholder="Replace in text blocks with..."
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            data-testid="search-replace-input"
          />
          <button
            className="search-panel__btn"
            onClick={replaceAll}
            disabled={!query.trim()}
            data-testid="search-replace-all"
          >
            Replace All
          </button>
        </div>
      )}
      {query.trim() && (
        <div className="search-panel__results" id="search-results" role="listbox" ref={listRef}>
          {results.length === 0 && <div className="search-panel__empty">No results found</div>}
          {shown.map((r, i) => {
            const heading = scope === 'notebook' && r.entry.group !== lastGroup ? r.entry.groupTitle : null;
            lastGroup = r.entry.group;
            return (
              <div key={`${r.entry.group}-${r.entry.kind}-${r.entry.targetId ?? ''}-${i}`} role="presentation">
                {heading !== null && (
                  <div className="search-panel__result-path" data-testid="search-group" role="presentation">
                    {heading}
                  </div>
                )}
                <button
                  id={`search-result-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`search-panel__result ${i === active ? 'search-panel__result--active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(r)}
                  data-index={i}
                  data-kind={r.entry.kind}
                  data-testid="search-result"
                >
                  <span className="search-panel__result-kind">{r.entry.label}</span>
                  <span className="search-panel__result-snippet">
                    {r.parts.map((p, j) => (p.mark ? <mark key={j}>{p.text}</mark> : <span key={j}>{p.text}</span>))}
                  </span>
                </button>
              </div>
            );
          })}
          {results.length > SHOWN && (
            <div className="search-panel__more">
              Showing the first {SHOWN} of {results.length} - type more to narrow it down
            </div>
          )}
        </div>
      )}
    </div>
  );
}
