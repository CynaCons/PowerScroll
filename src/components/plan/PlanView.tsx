import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useSearchStore } from '../../stores/useSearchStore';
import { getHandleForPlan, setHandleForPlan } from '../../utils/fileHandleStore';
import { ownerChecks, parsePlan, type PlanIteration, type PlanMajor } from '../../plan/planParser';
import type { Page } from '../../types/data';
import './PlanView.css';

/** How often a linked PLAN.md is looked at for changes while the plan page is open (REQ-PLAN-005). */
export const PLAN_REREAD_MS = 3000;
/** Majors shown before "Show all": the newest ones, oldest of them first. */
const RECENT_MAJORS = 6;

type LinkState = 'none' | 'linked' | 'needs-permission' | 'snapshot';

interface PickerWindow {
  showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle[]>;
}
interface PermissionHandle {
  queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState>;
}

// Handles survive a reload through IndexedDB; this map keeps them for the session even
// where IndexedDB refuses one (and lets tests hand in a stand-in handle).
const sessionHandles = new Map<string, FileSystemFileHandle>();

async function permission(handle: FileSystemFileHandle, ask: boolean): Promise<PermissionState> {
  const h = handle as unknown as PermissionHandle;
  try {
    if (ask && h.requestPermission) return await h.requestPermission({ mode: 'read' });
    if (h.queryPermission) return await h.queryPermission({ mode: 'read' });
  } catch {
    return 'denied';
  }
  return 'granted';
}

function findActivePlanPage(): Page | null {
  const { workspace, activePageId } = useWorkspaceStore.getState();
  for (const section of workspace.sections) {
    const page = section.pages.find((item) => item.id === activePageId);
    if (page) return page.kind === 'plan' ? page : null;
  }
  return null;
}

export function PlanView() {
  const page = useWorkspaceStore((state) => {
    for (const section of state.workspace.sections) {
      const found = section.pages.find((item) => item.id === state.activePageId);
      if (found) return found;
    }
    return null;
  });
  const updatePlan = useWorkspaceStore((state) => state.updatePlan);
  const pageId = page?.id ?? '';
  const source = page?.plan?.source ?? '';
  const plan = useMemo(() => parsePlan(source), [source]);
  const checks = useMemo(() => ownerChecks(plan), [plan]);

  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showNeeds, setShowNeeds] = useState(false);
  const [showBacklog, setShowBacklog] = useState(false);
  const [link, setLink] = useState<LinkState>('none');
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<FileSystemFileHandle | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const store = useCallback((text: string, fileName: string, modified: number) => {
    if (!pageId) return;
    updatePlan(pageId, (current) => ({ ...current, source: text, fileName, readAt: Date.now(), fileModified: modified }));
  }, [pageId, updatePlan]);

  /** Read the linked file when it changed since the last read. */
  const reread = useCallback(async (force = false) => {
    const handle = handleRef.current;
    if (!handle) return;
    const state = await permission(handle, false);
    if (state !== 'granted') {
      setLink('needs-permission');
      return;
    }
    try {
      const file = await handle.getFile();
      setLink('linked');
      setError(null);
      const current = findActivePlanPage()?.plan;
      if (!force && current && current.fileModified === file.lastModified && current.fileName === file.name) return;
      store(await file.text(), file.name, file.lastModified);
    } catch (reason) {
      setError(`Could not read ${handle.name}: ${(reason as Error)?.message ?? 'unknown error'}`);
    }
  }, [store]);

  // Find this page's linked file, if any.
  useEffect(() => {
    let cancelled = false;
    handleRef.current = null;
    setSelected(null);
    setShowNeeds(false);
    setError(null);
    setLink(source ? 'snapshot' : 'none');
    (async () => {
      const handle = sessionHandles.get(pageId) ?? await getHandleForPlan(pageId);
      if (cancelled || !handle) return;
      handleRef.current = handle;
      sessionHandles.set(pageId, handle);
      await reread();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page; `source` only seeds the label
  }, [pageId]);

  // Re-read the linked file every few seconds while this page is shown and the tab is visible.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden || !handleRef.current) return;
      void reread();
    }, PLAN_REREAD_MS);
    const onVisible = () => { if (!document.hidden) void reread(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reread]);

  // Search result "Plan v0.97.0" opens that iteration.
  const searchReveal = useSearchStore((state) => state.reveal);
  useEffect(() => {
    if (!searchReveal || searchReveal.kind !== 'card' || searchReveal.pageId !== pageId) return;
    useSearchStore.getState().setReveal(null);
    if (plan.iterations.some((iteration) => iteration.version === searchReveal.id)) {
      setSelected(searchReveal.id);
      setShowAll(true);
    }
  }, [searchReveal, pageId, plan]);

  const openFile = async () => {
    const picker = (window as unknown as PickerWindow).showOpenFilePicker;
    if (!picker) {
      fileInput.current?.click();
      return;
    }
    try {
      const [handle] = await picker({
        multiple: false,
        types: [{ description: 'Plan', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }],
      });
      if (!handle) return;
      handleRef.current = handle;
      sessionHandles.set(pageId, handle);
      void setHandleForPlan(pageId, handle);
      setSelected(null);
      await reread(true);
    } catch (reason) {
      if ((reason as Error)?.name !== 'AbortError') setError(`Could not open the file: ${(reason as Error)?.message ?? 'unknown error'}`);
    }
  };

  const onFallbackFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    store(await file.text(), file.name, file.lastModified);
    setSelected(null);
    setLink('snapshot');
  };

  const reconnect = async () => {
    const handle = handleRef.current;
    if (!handle) return;
    if ((await permission(handle, true)) === 'granted') await reread(true);
  };

  if (!page) return null;

  const majors = plan.majors;
  const hidden = showAll ? 0 : Math.max(0, majors.length - RECENT_MAJORS);
  const shownMajors = majors.slice(hidden);
  const current = plan.current;
  const focus = plan.iterations.find((iteration) => iteration.version === selected) ?? current;
  const ownerByVersion = new Set(checks.map((check) => check.iteration.version));
  const fileName = page.plan?.fileName ?? 'PLAN.md';

  const linkLabel = link === 'linked'
    ? `${fileName} · linked`
    : link === 'needs-permission'
      ? `${fileName} · paused`
      : source ? `${fileName} · snapshot` : '';

  return (
    <div className="plan-view" data-testid="plan-view" data-link={link}>
      <input ref={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden
        data-testid="plan-file-input" onChange={onFallbackFile} />
      <header className="plan-view__header">
        <div>
          <h1 data-testid="plan-title">{plan.title || page.title}</h1>
          {source && (
            <p>
              {plan.iterations.length} iteration{plan.iterations.length === 1 ? '' : 's'} in {majors.length} group{majors.length === 1 ? '' : 's'}
              {current ? ` · current ${current.version}` : ''}
              {page.plan?.readAt ? ` · read ${new Date(page.plan.readAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
            </p>
          )}
        </div>
        <div className="plan-view__controls">
          {checks.length > 0 && (
            <button type="button" className={`plan-need${showNeeds ? ' plan-need--on' : ''}`} data-testid="plan-need"
              aria-pressed={showNeeds} onClick={() => setShowNeeds((value) => !value)}>
              {checks.length} need{checks.length === 1 ? 's' : ''} you
            </button>
          )}
          {linkLabel && <span className="plan-badge" data-testid="plan-link">{linkLabel}</span>}
          {link === 'needs-permission' && (
            <button type="button" className="plan-button" data-testid="plan-reconnect" onClick={reconnect}>Reconnect</button>
          )}
          <button type="button" className="plan-button" data-testid="plan-open" onClick={openFile}>
            {source ? 'Open another file' : 'Open PLAN.md'}
          </button>
        </div>
      </header>

      {error && <div className="plan-error" data-testid="plan-error" role="alert">{error}</div>}

      {!source ? (
        <div className="plan-empty" data-testid="plan-empty">
          <h2>Show a PLAN.md here</h2>
          <p>Open a project&apos;s PLAN.md to see its versions as progress bars, with the current iteration as a checklist.
            In Chrome and Edge the file stays linked and the page follows it as agents tick tasks. PowerScroll only reads it.</p>
          <button type="button" className="plan-button plan-button--primary" onClick={openFile} data-testid="plan-open-empty">Open PLAN.md</button>
        </div>
      ) : !plan.iterations.length ? (
        <div className="plan-empty" data-testid="plan-empty">
          <h2>No iterations found</h2>
          <p>This file has no <code>### vX.Y.Z - Title</code> headings, so there is nothing to draw. Open the project&apos;s PLAN.md instead.</p>
        </div>
      ) : (
        <>
          {showNeeds && (
            <section className="plan-needs" data-testid="plan-needs">
              {checks.map(({ iteration, task }, index) => (
                <button type="button" key={`${iteration.version}-${index}`} className="plan-needs__row"
                  onClick={() => { setSelected(iteration.version); setShowAll(true); }}>
                  <span className="plan-mono">{iteration.version}</span>
                  <span>{task.text}</span>
                </button>
              ))}
            </section>
          )}

          <section className="plan-rail" data-testid="plan-rail">
            {hidden > 0 && (
              <button type="button" className="plan-more" data-testid="plan-show-all" onClick={() => setShowAll(true)}>
                Show {hidden} earlier group{hidden === 1 ? '' : 's'}
              </button>
            )}
            {shownMajors.map((major) => (
              <MajorRow key={major.version || 'loose'} major={major} current={current?.version ?? null}
                selected={focus?.version ?? null} owner={ownerByVersion} onSelect={setSelected} />
            ))}
          </section>

          {focus && <IterationDetail iteration={focus} isCurrent={focus === current} />}

          {plan.backlog.length > 0 && (
            <section className="plan-backlog" data-testid="plan-backlog">
              <button type="button" className="plan-backlog__toggle" onClick={() => setShowBacklog((value) => !value)} aria-expanded={showBacklog}>
                {showBacklog ? '▾' : '▸'} Backlog · {plan.backlog.length} item{plan.backlog.length === 1 ? '' : 's'}
              </button>
              {showBacklog && (
                <ul>
                  {plan.backlog.map((item, index) => <li key={index}>{stripMarkdown(item)}</li>)}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function MajorRow({ major, current, selected, owner, onSelect }: {
  major: PlanMajor;
  current: string | null;
  selected: string | null;
  owner: Set<string>;
  onSelect: (version: string) => void;
}) {
  const done = major.iterations.reduce((sum, iteration) => sum + iteration.done, 0);
  const total = major.iterations.reduce((sum, iteration) => sum + iteration.total, 0);
  return (
    <div className="plan-major" data-testid={`plan-major-${major.version || 'loose'}`}>
      <div className="plan-major__name" title={`${major.version} ${major.title}`}>
        {major.version && <span className="plan-mono">{major.version}</span>}
        {stripMarkdown(major.title)}
      </div>
      <div className="plan-major__its">
        {major.iterations.map((iteration) => {
          const share = iteration.total ? iteration.done / iteration.total : iteration.complete ? 1 : 0;
          const classes = ['plan-it'];
          if (iteration.version === current) classes.push('plan-it--current');
          if (iteration.version === selected) classes.push('plan-it--selected');
          if (owner.has(iteration.version)) classes.push('plan-it--need');
          return (
            <button type="button" key={iteration.version} className={classes.join(' ')}
              data-testid={`plan-it-${iteration.version}`}
              data-done={iteration.done} data-total={iteration.total}
              style={{ flexGrow: Math.max(1, iteration.total) }}
              title={`${iteration.version} ${stripMarkdown(iteration.title)} · ${iteration.done}/${iteration.total}`}
              aria-label={`${iteration.version} ${stripMarkdown(iteration.title)}, ${iteration.done} of ${iteration.total} done`}
              aria-pressed={iteration.version === selected}
              onClick={() => onSelect(iteration.version)}>
              <i style={{ width: `${share * 100}%` }} />
            </button>
          );
        })}
      </div>
      <div className="plan-major__pc">{total ? Math.round((done / total) * 100) : 0}%</div>
    </div>
  );
}

function IterationDetail({ iteration, isCurrent }: { iteration: PlanIteration; isCurrent: boolean }) {
  return (
    <section className="plan-detail" data-testid="plan-detail" data-version={iteration.version}>
      <div className="plan-detail__head">
        <h2><span className="plan-mono">{iteration.version}</span> {stripMarkdown(iteration.title)}</h2>
        <span className="plan-badge">
          {iteration.done} / {iteration.total}{isCurrent ? ' · current' : ''}{iteration.status ? ` · ${iteration.status}` : ''}
        </span>
      </div>
      {iteration.goal && <p className="plan-detail__goal">{stripMarkdown(iteration.goal)}</p>}
      <div className="plan-bar"><i style={{ width: `${iteration.total ? (iteration.done / iteration.total) * 100 : 0}%` }} /></div>
      <ul className="plan-tasks">
        {iteration.tasks.map((task, index) => (
          <li key={index} data-testid="plan-task" data-done={task.done ? 'true' : 'false'}
            className={`plan-task${task.done ? ' plan-task--done' : ''}${task.needsOwner ? ' plan-task--need' : ''}`}>
            <span className="plan-task__box" aria-hidden="true" />
            <span className="plan-task__text">{stripMarkdown(task.text)}</span>
            <span className="plan-task__tag">{task.needsOwner ? 'needs you' : task.agent ?? ''}</span>
          </li>
        ))}
        {!iteration.tasks.length && <li className="plan-task plan-task--empty">No tasks listed.</li>}
      </ul>
    </section>
  );
}

/** Inline Markdown the rail shows as text: bold, code and links lose their marks. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}
