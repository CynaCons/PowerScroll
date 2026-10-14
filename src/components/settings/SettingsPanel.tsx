import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { BackgroundMode, CanvasBgColor, WorkspaceSettings } from '../../types/data';
import type { ResolvedPageSettings, SettingsScope } from '../../utils/pageSettings';
import { APP_VERSION } from '../../version';
import { checkForUpdate, performUpdate, isLiveUpdateEnabled } from '../../utils/updateChecker';
import { isFSASupported } from '../../utils/fileSystemAccess';
import { getCurrentHandle } from '../../utils/fileHandleStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useDrawStore } from '../../stores/useDrawStore';
import { useToolStore } from '../../stores/useToolStore';
import { useBridgeStore, type BridgeStatus } from '../../stores/useBridgeStore';
import { useExtensionStore } from '../../stores/useExtensionStore';
import { useFileBindingStore } from '../../stores/useFileBindingStore';
import type { ExtensionStatus } from '../../extensions/types';
import { DEFAULT_BRIDGE_URL } from '../../bridge/protocol';
import { showToast } from '../layout/Toast';
import './SettingsPanel.css';

interface SettingsPanelProps {
  /** The look the active page is actually drawn with, and where it came from. */
  resolved: ResolvedPageSettings;
  /** What a page falls back to — shown while the scope is All pages. */
  notebookDefault: WorkspaceSettings;
  pageTitle: string;
  onChange: (updates: Partial<WorkspaceSettings>, scope: SettingsScope) => void;
  onClearPageOverride: () => void;
  onClose: () => void;
}

/** One entry per section of the scrolling page, in page order — the side index is built from it. */
const SECTIONS = [
  { id: 'look', label: 'Page look' },
  { id: 'input', label: 'Drawing & input' },
  { id: 'saving', label: 'Saving & recovery' },
  { id: 'bridge', label: 'Agent bridge' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'about', label: 'About & updates' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const SECTION_ICONS: Record<SectionId, ReactNode> = {
  look: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </>
  ),
  input: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  saving: (
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </>
  ),
  bridge: <path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />,
  extensions: <path d="M4 8h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4Z" />,
  about: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
};

const GUIDE_STYLES: { value: BackgroundMode; label: string }[] = [
  { value: 'pages', label: 'Pages' },
  { value: 'scroll', label: 'Scroll' },
  { value: 'grid', label: 'Grid' },
  { value: 'none', label: 'None' },
];

const BG_COLORS: { value: CanvasBgColor; label: string; preview: string }[] = [
  { value: '#ffffff', label: 'White', preview: '#ffffff' },
  { value: '#f5f5f5', label: 'Light gray', preview: '#f5f5f5' },
  { value: '#e5e5e5', label: 'Gray', preview: '#e5e5e5' },
  { value: 'paper', label: 'Paper', preview: '#f5f0e8' },
];

type UpdateStatus = 'idle' | 'checking' | 'available' | 'updating-live' | 'updating-download' | 'failed';

const TOUCH_DRAW_MODES: { value: 'auto' | 'always' | 'never'; label: string }[] = [
  { value: 'auto', label: 'Auto — finger draws until a pen is used, then pans' },
  { value: 'always', label: 'Finger always draws' },
  { value: 'never', label: 'Finger always pans' },
];

const BRIDGE_STATUS_LABEL: Record<BridgeStatus, { text: string; color: string }> = {
  off: { text: 'Off', color: '#64748b' },
  connecting: { text: 'Waiting for agent server…', color: '#d97706' },
  connected: { text: 'Connected', color: '#16a34a' },
  error: { text: 'Cannot reach server', color: '#dc2626' },
  displaced: { text: 'Another notebook took over', color: '#d97706' },
};

const EXT_STATUS_COLOR: Record<ExtensionStatus, string> = {
  'not-installed': '#64748b',
  installing: '#d97706',
  installed: '#16a34a',
  failed: '#dc2626',
};

export function SettingsPanel({
  resolved,
  notebookDefault,
  pageTitle,
  onChange,
  onClearPageOverride,
  onClose,
}: SettingsPanelProps) {
  // Which scope the controls WRITE to.
  //
  // Notebook by default, for the same reason the bridge command defaults there:
  // these controls meant notebook-wide before per-page overrides existed, so
  // starting on the page would silently change what an unchanged click does.
  // The switch is visible, so choosing the page is one deliberate click.
  const [scope, setScope] = useState<SettingsScope>('notebook');

  // Editing the notebook default shows the default, not the page's override —
  // otherwise the radio you see selected is not the one you are about to change.
  const shown = scope === 'page' ? resolved : notebookDefault;
  const backgroundMode = shown.backgroundMode;
  const bgColor = shown.bgColor;

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<{ version: string; url?: string; releaseUrl?: string } | null>(null);

  const touchDraw = useToolStore((s) => s.drawOptions.touchDraw);
  const snapToObjects = useToolStore((s) => s.drawOptions.snapToObjects);

  const drawioExt = useExtensionStore((s) => s.drawio);
  const refreshExtensions = useExtensionStore((s) => s.refresh);
  const installDrawio = useExtensionStore((s) => s.install);

  // The truth lives in IndexedDB / the document — mirror it when the panel opens.
  useEffect(() => {
    void refreshExtensions();
  }, [refreshExtensions]);

  const bridgeEnabled = useBridgeStore((s) => s.enabled);
  const bridgeStatus = useBridgeStore((s) => s.status);
  const bridgeUrl = useBridgeStore((s) => s.url);
  const bridgeCommandCount = useBridgeStore((s) => s.commandCount);
  const bridgeLastCommand = useBridgeStore((s) => s.lastCommand);
  const setBridgeEnabled = useBridgeStore((s) => s.setEnabled);
  const setBridgeUrl = useBridgeStore((s) => s.setUrl);

  const handleCheckUpdate = async () => {
    setUpdateStatus('checking');
    const result = await checkForUpdate(APP_VERSION, { force: true });
    if (result?.available && result.latestVersion) {
      setUpdateStatus('available');
      setUpdateInfo({ version: result.latestVersion, url: result.downloadUrl, releaseUrl: result.releaseUrl });
    } else if (result && !result.available) {
      setUpdateStatus('idle');
      setUpdateInfo(null);
      showToast('Already up to date', 'info');
    } else {
      setUpdateStatus('failed');
    }
  };

  const handleUpdate = async () => {
    // A missing release asset used to dead-end here, silently opening the
    // release page instead of updating -- which is exactly what happened when a
    // failing CI job stopped the asset being attached. The download no longer
    // needs it: it fetches the committed build at the release tag. Only give up
    // when there is no version to fetch at all.
    if (!updateInfo?.version) {
      if (updateInfo?.releaseUrl) window.open(updateInfo.releaseUrl, '_blank');
      return;
    }

    // Prefer live-swap messaging when a writable FSA handle is likely available
    let preferLive = false;
    if (isLiveUpdateEnabled() && isFSASupported()) {
      const handle = await getCurrentHandle();
      preferLive = !!handle;
    }
    setUpdateStatus(preferLive ? 'updating-live' : 'updating-download');

    const wsStore = useWorkspaceStore.getState();
    wsStore.savePageNodes(useCanvasStore.getState().nodes);
    wsStore.savePageStrokes(useDrawStore.getState().strokes);
    // Re-read AFTER the saves: zustand states are immutable, so `wsStore` is
    // the pre-save snapshot and its `.workspace` does not contain the nodes
    // just saved — the updated file would embed a stale workspace, silently
    // dropping any canvas edits made since the last save. Found by the
    // v0.37.5 → v0.52.3 end-to-end update test (empty page in the output).
    const ws = useWorkspaceStore.getState().workspace;

    const result = await performUpdate(updateInfo.url ?? '', ws, APP_VERSION, updateInfo.version);
    if (!result.ok) {
      setUpdateStatus('failed');
      if (updateInfo.releaseUrl) window.open(updateInfo.releaseUrl, '_blank');
      return;
    }

    if (result.mode === 'live-swap') {
      // Page is reloading — leave status as updating-live
      return;
    }

    showToast('Updated notebook downloaded — open it to use the new version', 'success');
    setUpdateStatus('idle');
    setUpdateInfo(null);
  };

  const fileLabel = useFileBindingStore((s) => s.label);
  const fileSource = useFileBindingStore((s) => s.source);
  const workspaceName = useWorkspaceStore((s) => s.workspace.filename.replace(/\.html?$/i, ''));

  // ── Dialog behaviour ──────────────────────────────────────────────────────
  const dialogRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus moves into the dialog on open and back to whatever opened it (the
  // gear) on close, so a keyboard user is never left on a control behind it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // Escape closes. Capture phase + stopPropagation, so the canvas's own
  // Escape (clear selection, exit isolation) does not also run underneath.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  // Tab cycles inside the dialog.
  const trapFocus = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // ── One scrolling page, the side index follows it ─────────────────────────
  const [activeSection, setActiveSection] = useState<SectionId>('look');

  // The section you are reading is the last one whose heading has passed the
  // top of the pane; at the very bottom it is the last section, even when that
  // section is too short to ever reach the top.
  const syncActiveSection = useCallback(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2) {
      setActiveSection(SECTIONS[SECTIONS.length - 1].id);
      return;
    }
    let current: SectionId = SECTIONS[0].id;
    for (const { id } of SECTIONS) {
      const el = pane.querySelector<HTMLElement>(`[data-section="${id}"]`);
      if (el && el.offsetTop - pane.scrollTop <= 48) current = id;
    }
    setActiveSection(current);
  }, []);

  const jumpTo = (id: SectionId) => {
    const pane = scrollRef.current;
    const el = pane?.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (!pane || !el) return;
    pane.scrollTo({ top: el.offsetTop - 24, behavior: 'smooth' });
    setActiveSection(id);
  };

  const sectionHeading = (id: SectionId, description: string) => (
    <div className="settings-panel__section-head">
      <h3 className="settings-panel__section-title" id={`settings-h-${id}`}>
        {SECTIONS.find((s) => s.id === id)?.label}
      </h3>
      <p className="settings-panel__section-desc">{description}</p>
    </div>
  );

  return (
    <div
      className="settings-overlay"
      data-testid="settings-overlay"
      // Only a press that starts on the backdrop closes — a drag that began on
      // a control and ended outside it must not.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="settings-panel"
        data-testid="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={trapFocus}
      >
        <header className="settings-panel__header">
          <div className="settings-panel__heading">
            <h2 className="settings-panel__title" id="settings-title">Settings</h2>
            <span className="settings-panel__context">
              {workspaceName} · {pageTitle}
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="settings-panel__close"
            onClick={onClose}
            aria-label="Close settings"
            title="Close (Esc)"
            data-testid="settings-close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="settings-panel__body">
          <nav className="settings-panel__index" aria-label="Settings sections" data-testid="settings-index">
            {SECTIONS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`settings-panel__index-item${activeSection === id ? ' settings-panel__index-item--active' : ''}`}
                aria-current={activeSection === id ? 'true' : undefined}
                onClick={() => jumpTo(id)}
                data-testid={`settings-index-${id}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {SECTION_ICONS[id]}
                </svg>
                <span className="settings-panel__index-label">{label}</span>
                {id === 'bridge' && (
                  <span className="settings-panel__index-meta" style={{ color: BRIDGE_STATUS_LABEL[bridgeStatus].color }}>
                    {bridgeEnabled ? BRIDGE_STATUS_LABEL[bridgeStatus].text.split(' ')[0] : 'Off'}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="settings-panel__scroll" ref={scrollRef} onScroll={syncActiveSection} data-testid="settings-scroll">
            {/* ── Page look ─────────────────────────────────────────── */}
            <section className="settings-panel__section" data-section="look" aria-labelledby="settings-h-look">
              {sectionHeading('look', 'How pages are drawn behind your content. Change this page alone, or the default every page follows.')}

              <div className="settings-panel__row">
                <span className="settings-panel__row-label">Apply to</span>
                <div className="settings-panel__row-control">
                  <div className="settings-panel__scope" data-testid="settings-scope" data-scope={scope} role="group" aria-label="Apply to">
                    <button
                      type="button"
                      className={`settings-panel__scope-btn ${scope === 'page' ? 'settings-panel__scope-btn--active' : ''}`}
                      onClick={() => setScope('page')}
                      aria-pressed={scope === 'page'}
                      data-testid="settings-scope-page"
                      title={`Change the look of "${pageTitle}" only`}
                    >
                      This page
                    </button>
                    <button
                      type="button"
                      className={`settings-panel__scope-btn ${scope === 'notebook' ? 'settings-panel__scope-btn--active' : ''}`}
                      onClick={() => setScope('notebook')}
                      aria-pressed={scope === 'notebook'}
                      data-testid="settings-scope-notebook"
                      title="Change the default every page follows unless it overrides it"
                    >
                      All pages
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-panel__row">
                <span className="settings-panel__row-label">Guide style</span>
                <div className="settings-panel__row-control settings-panel__tiles" role="radiogroup" aria-label="Guide style">
                  {GUIDE_STYLES.map((style) => (
                    <label
                      key={style.value}
                      className={`settings-panel__tile${backgroundMode === style.value ? ' settings-panel__tile--active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="bg-mode"
                        className="settings-panel__tile-input"
                        checked={backgroundMode === style.value}
                        onChange={() => onChange({ backgroundMode: style.value }, scope)}
                        data-testid={`settings-bg-${style.value}`}
                      />
                      <span className={`settings-panel__tile-preview settings-panel__tile-preview--${style.value}`} aria-hidden="true">
                        {style.value === 'pages' && (
                          <>
                            <span />
                            <span />
                          </>
                        )}
                        {style.value === 'scroll' && (
                          <>
                            <span />
                            <span />
                          </>
                        )}
                      </span>
                      <span className="settings-panel__tile-label">{style.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="settings-panel__row">
                <span className="settings-panel__row-label">Background</span>
                <div className="settings-panel__row-control settings-panel__swatches">
                  {BG_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      className="settings-panel__swatch"
                      onClick={() => onChange({ bgColor: c.value }, scope)}
                      aria-pressed={bgColor === c.value}
                      title={c.label}
                    >
                      <span
                        className={`settings-panel__color-swatch ${bgColor === c.value ? 'settings-panel__color-swatch--active' : ''}`}
                        style={{ backgroundColor: c.preview }}
                        data-testid={`settings-bg-color-${c.value}`}
                      />
                      <span className="settings-panel__swatch-label">{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-panel__row settings-panel__row--note">
                {/* Only offered when there is something to undo, and only in page scope —
                    in notebook scope it would read as resetting the notebook. */}
                {scope === 'page' && resolved.hasOverride && (
                  <button
                    type="button"
                    className="settings-panel__reset"
                    onClick={onClearPageOverride}
                    data-testid="settings-clear-page-override"
                  >
                    Use the notebook default for this page
                  </button>
                )}
                {scope === 'notebook' && (
                  <span className="settings-panel__note" data-testid="settings-scope-note">
                    {resolved.hasOverride
                      ? // Without this the panel would show one look while the canvas shows
                        // another, and the change you just made would appear to do nothing.
                        `Pages with their own look keep it — including "${pageTitle}", which you are looking at.`
                      : 'Pages with their own look keep it.'}
                  </span>
                )}
              </div>
            </section>

            {/* ── Drawing & input — device settings, no page/notebook scope ── */}
            <section className="settings-panel__section" data-section="input" aria-labelledby="settings-h-input">
              {sectionHeading('input', 'How pen, finger and mouse behave on this device. Kept in this browser, not in the notebook.')}

              <div className="settings-panel__row">
                <span className="settings-panel__row-label">Touch drawing</span>
                <div className="settings-panel__row-control settings-panel__stack" role="radiogroup" aria-label="Touch drawing">
                  {TOUCH_DRAW_MODES.map((mode) => (
                    <label className="settings-panel__radio" key={mode.value}>
                      <input
                        type="radio"
                        name="touch-draw"
                        checked={touchDraw === mode.value}
                        onChange={() => useToolStore.getState().setDrawOptions({ touchDraw: mode.value })}
                        data-testid={`settings-touchdraw-${mode.value}`}
                      />
                      <span>{mode.label}</span>
                    </label>
                  ))}
                  <span className="settings-panel__hint">
                    The pen always draws, with pressure. Two fingers pan and zoom in any mode.
                  </span>
                </div>
              </div>

              <div className="settings-panel__row">
                <span className="settings-panel__row-label">Snap to objects</span>
                <div className="settings-panel__row-control">
                  <label className="settings-panel__switch-row">
                    <input
                      type="checkbox"
                      className="settings-panel__switch"
                      checked={snapToObjects}
                      onChange={(e) => useToolStore.getState().setDrawOptions({ snapToObjects: e.target.checked })}
                      data-testid="settings-snap-to-objects"
                    />
                    <span>Line up with nearby objects while dragging. Hold Shift to place freely.</span>
                  </label>
                </div>
              </div>
            </section>

            {/* ── Saving & recovery ─────────────────────────────────── */}
            <section className="settings-panel__section" data-section="saving" aria-labelledby="settings-h-saving">
              {sectionHeading('saving', 'Where your changes go while you work.')}

              <div className="settings-panel__row">
                <span className="settings-panel__row-label">Linked file</span>
                <div className="settings-panel__row-control settings-panel__stack">
                  <span className="settings-panel__mono" data-testid="settings-file-label">
                    {fileLabel ?? 'Not linked to a file'}
                  </span>
                  <span className="settings-panel__hint">
                    {fileSource === 'fsa'
                      ? 'Changes are written back to this file automatically.'
                      : 'Save with Ctrl+S to link a file; changes are then written back to it automatically.'}
                  </span>
                </div>
              </div>

              <div className="settings-panel__row">
                <span className="settings-panel__row-label">Browser copy</span>
                <div className="settings-panel__row-control settings-panel__stack">
                  <span>A recovery copy of this notebook is kept in this browser.</span>
                  <span className="settings-panel__hint">Reopen it from Recent notebooks in the left rail.</span>
                </div>
              </div>
            </section>

            {/* ── Agent bridge ──────────────────────────────────────── */}
            <section className="settings-panel__section" data-section="bridge" aria-labelledby="settings-h-bridge">
              {sectionHeading('bridge', 'Let an AI agent on this computer read and write the notebook through the PowerScroll MCP server.')}

              <div className="settings-panel__row">
                <span className="settings-panel__row-label">Connection</span>
                <div className="settings-panel__row-control settings-panel__stack">
                  <label className="settings-panel__switch-row">
                    <input
                      type="checkbox"
                      className="settings-panel__switch"
                      checked={bridgeEnabled}
                      onChange={(e) => setBridgeEnabled(e.target.checked)}
                      data-testid="settings-bridge-toggle"
                    />
                    <span>Let a local agent write into this notebook</span>
                  </label>

                  <div className="settings-panel__status">
                    <span className="settings-panel__dot" style={{ backgroundColor: BRIDGE_STATUS_LABEL[bridgeStatus].color }} />
                    <span
                      style={{ color: BRIDGE_STATUS_LABEL[bridgeStatus].color }}
                      data-testid="settings-bridge-status"
                      data-status={bridgeStatus}
                    >
                      {BRIDGE_STATUS_LABEL[bridgeStatus].text}
                    </span>
                    {bridgeCommandCount > 0 && (
                      <span className="settings-panel__muted" data-testid="settings-bridge-count">
                        · {bridgeCommandCount} command{bridgeCommandCount === 1 ? '' : 's'}
                        {bridgeLastCommand ? ` (last: ${bridgeLastCommand})` : ''}
                      </span>
                    )}
                  </div>

                  {bridgeStatus === 'displaced' && (
                    <span className="settings-panel__hint settings-panel__hint--warn" data-testid="settings-bridge-displaced-hint">
                      Another notebook connected to the bridge, so this one stopped. Tick the
                      box again to take the connection back.
                    </span>
                  )}

                  <span className="settings-panel__hint">
                    Off by default. Only enable on your own machine — anything that can reach
                    this port can edit the notebook.
                  </span>
                </div>
              </div>

              {bridgeEnabled && (
                <div className="settings-panel__row">
                  <span className="settings-panel__row-label">Server address</span>
                  <div className="settings-panel__row-control">
                    <input
                      type="text"
                      className="settings-panel__text-input"
                      value={bridgeUrl}
                      placeholder={DEFAULT_BRIDGE_URL}
                      onChange={(e) => setBridgeUrl(e.target.value)}
                      aria-label="Bridge server address"
                      data-testid="settings-bridge-url"
                    />
                  </div>
                </div>
              )}
            </section>

            {/* ── Extensions ────────────────────────────────────────── */}
            <section className="settings-panel__section" data-section="extensions" aria-labelledby="settings-h-extensions">
              {sectionHeading('extensions', 'Optional pieces that are downloaded once and then work offline.')}

              <div className="settings-panel__row">
                <span className="settings-panel__row-label">draw.io viewer</span>
                <div className="settings-panel__row-control settings-panel__stack">
                  <div className="settings-panel__status">
                    <span className="settings-panel__dot" style={{ backgroundColor: EXT_STATUS_COLOR[drawioExt.status] }} />
                    <span
                      style={{ color: EXT_STATUS_COLOR[drawioExt.status] }}
                      data-testid="settings-ext-drawio-status"
                      data-status={drawioExt.status}
                    >
                      {drawioExt.status === 'not-installed' && 'Not installed'}
                      {drawioExt.status === 'installing' && 'Installing…'}
                      {drawioExt.status === 'installed' &&
                        `Installed${drawioExt.version ? ` v${drawioExt.version}` : ''}`}
                      {drawioExt.status === 'failed' && 'Install failed'}
                    </span>
                    {(drawioExt.status === 'not-installed' || drawioExt.status === 'failed') && (
                      <button
                        type="button"
                        className="settings-panel__btn"
                        onClick={() => void installDrawio()}
                        data-testid="settings-ext-drawio-install"
                      >
                        {drawioExt.status === 'failed' ? 'Retry' : 'Install (~1.1 MB)'}
                      </button>
                    )}
                  </div>

                  {drawioExt.status === 'failed' && drawioExt.error && (
                    <span className="settings-panel__hint settings-panel__hint--error" data-testid="settings-ext-drawio-error">
                      {drawioExt.error}
                    </span>
                  )}

                  {drawioExt.status === 'installed' && (
                    <span className="settings-panel__hint">
                      {[
                        drawioExt.embedded ? 'Embedded in this notebook' : null,
                        drawioExt.cached ? 'cached in this browser' : null,
                        !drawioExt.embedded ? 'embedded into the notebook on the next save' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      .
                    </span>
                  )}

                  <span className="settings-panel__hint">
                    Exact diagram rendering. Without it, draw.io diagrams still display — the
                    extension is needed to create or redraw them offline. Renders exactly what
                    diagrams.net shows. Apache-2.0.
                  </span>
                </div>
              </div>
            </section>

            {/* ── About & updates ───────────────────────────────────── */}
            <section className="settings-panel__section" data-section="about" aria-labelledby="settings-h-about">
              {sectionHeading('about', 'Updates are fetched from GitHub only when you ask.')}

              <div className="settings-panel__row">
                <span className="settings-panel__row-label">Version</span>
                <div className="settings-panel__row-control settings-panel__status">
                  <span className="settings-panel__mono" data-testid="settings-app-version">PowerScroll v{APP_VERSION}</span>
                  {updateStatus === 'idle' && (
                    <button type="button" className="settings-panel__btn" onClick={handleCheckUpdate} data-testid="check-update-btn">
                      Check for updates
                    </button>
                  )}
                  {updateStatus === 'checking' && (
                    <span className="settings-panel__muted" data-testid="update-status-checking">Checking...</span>
                  )}
                  {updateStatus === 'available' && updateInfo && (
                    <>
                      <span style={{ color: '#16a34a' }}>v{updateInfo.version} available!</span>
                      <button
                        type="button"
                        className="settings-panel__btn settings-panel__btn--primary"
                        onClick={handleUpdate}
                        data-testid="update-btn"
                      >
                        Update
                      </button>
                    </>
                  )}
                  {updateStatus === 'updating-live' && (
                    <span style={{ color: '#2563eb' }} data-testid="update-status-live">
                      Updating this file…
                    </span>
                  )}
                  {updateStatus === 'updating-download' && (
                    <span style={{ color: '#2563eb' }} data-testid="update-status-download">
                      Downloading backup + update…
                    </span>
                  )}
                  {updateStatus === 'failed' && (
                    <>
                      <span style={{ color: '#dc2626' }}>Update failed (rate limited or offline)</span>
                      <button type="button" className="settings-panel__btn" onClick={handleCheckUpdate}>Retry</button>
                    </>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>

        <footer className="settings-panel__footer">
          <span>Changes apply at once · Esc closes</span>
          <span className="settings-panel__mono">PowerScroll v{APP_VERSION}</span>
        </footer>
      </section>
    </div>
  );
}
