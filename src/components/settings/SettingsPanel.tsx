import { useEffect, useState } from 'react';
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
}

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

  return (
    <div className="settings-panel" data-testid="settings-panel">
      <h3 className="settings-panel__title">Settings</h3>

      <div className="settings-panel__scope" data-testid="settings-scope" data-scope={scope}>
        <button
          type="button"
          className={`settings-panel__scope-btn ${scope === 'page' ? 'settings-panel__scope-btn--active' : ''}`}
          onClick={() => setScope('page')}
          data-testid="settings-scope-page"
          title={`Change the look of "${pageTitle}" only`}
        >
          This page
        </button>
        <button
          type="button"
          className={`settings-panel__scope-btn ${scope === 'notebook' ? 'settings-panel__scope-btn--active' : ''}`}
          onClick={() => setScope('notebook')}
          data-testid="settings-scope-notebook"
          title="Change the default every page follows unless it overrides it"
        >
          All pages
        </button>
      </div>

      <div className="settings-panel__columns">
        <div className="settings-panel__section">
          <span className="settings-panel__label">Guide style</span>

          {GUIDE_STYLES.map((style) => (
            <label className="settings-panel__radio" key={style.value}>
              <input
                type="radio"
                name="bg-mode"
                checked={backgroundMode === style.value}
                onChange={() => onChange({ backgroundMode: style.value }, scope)}
                data-testid={`settings-bg-${style.value}`}
              />
              <span>{style.label}</span>
            </label>
          ))}
        </div>

        <div className="settings-panel__section">
          <span className="settings-panel__label">Background</span>

          <div className="settings-panel__color-grid">
            {BG_COLORS.map((c) => (
              <button
                key={c.value}
                className={`settings-panel__color-swatch ${bgColor === c.value ? 'settings-panel__color-swatch--active' : ''}`}
                style={{ backgroundColor: c.preview }}
                onClick={() => onChange({ bgColor: c.value }, scope)}
                title={c.label}
                data-testid={`settings-bg-color-${c.value}`}
              />
            ))}
          </div>
        </div>
      </div>

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

      {/* Device setting, not a notebook look — no page/notebook scope. */}
      <div className="settings-panel__section" style={{ marginTop: 12, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
        <span className="settings-panel__label">Touch drawing</span>

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

        <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'block' }}>
          The pen always draws, with pressure. Two fingers pan and zoom in any
          mode. Saved for this device, not in the notebook.
        </span>
      </div>

      {/* Device setting, like touch drawing — it controls interaction, not page content. */}
      <div className="settings-panel__section" style={{ marginTop: 12, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
        <label className="settings-panel__radio">
          <input
            type="checkbox"
            checked={snapToObjects}
            onChange={(e) => useToolStore.getState().setDrawOptions({ snapToObjects: e.target.checked })}
            data-testid="settings-snap-to-objects"
          />
          <span>Snap to objects</span>
        </label>
        <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'block' }}>
          Hold Shift while dragging to place freely. Saved for this device.
        </span>
      </div>

      <div className="settings-panel__section" style={{ marginTop: 12, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
        <span className="settings-panel__label">Agent bridge</span>

        <label className="settings-panel__radio" style={{ marginTop: 4 }}>
          <input
            type="checkbox"
            checked={bridgeEnabled}
            onChange={(e) => setBridgeEnabled(e.target.checked)}
            data-testid="settings-bridge-toggle"
          />
          <span>Let a local agent write into this notebook</span>
        </label>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: BRIDGE_STATUS_LABEL[bridgeStatus].color,
              flexShrink: 0,
            }}
          />
          <span
            style={{ fontSize: 12, color: BRIDGE_STATUS_LABEL[bridgeStatus].color }}
            data-testid="settings-bridge-status"
            data-status={bridgeStatus}
          >
            {BRIDGE_STATUS_LABEL[bridgeStatus].text}
          </span>
          {bridgeCommandCount > 0 && (
            <span style={{ fontSize: 12, color: '#64748b' }} data-testid="settings-bridge-count">
              · {bridgeCommandCount} command{bridgeCommandCount === 1 ? '' : 's'}
              {bridgeLastCommand ? ` (last: ${bridgeLastCommand})` : ''}
            </span>
          )}
        </div>

        {bridgeEnabled && (
          <input
            type="text"
            value={bridgeUrl}
            placeholder={DEFAULT_BRIDGE_URL}
            onChange={(e) => setBridgeUrl(e.target.value)}
            data-testid="settings-bridge-url"
            style={{
              marginTop: 6,
              width: '100%',
              fontSize: 12,
              padding: '4px 6px',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              fontFamily: 'ui-monospace, monospace',
            }}
          />
        )}

        {bridgeStatus === 'displaced' && (
          <span
            style={{ fontSize: 11, color: '#d97706', marginTop: 6, display: 'block' }}
            data-testid="settings-bridge-displaced-hint"
          >
            Another notebook connected to the bridge, so this one stopped. Tick the
            box again to take the connection back.
          </span>
        )}

        <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, display: 'block' }}>
          Off by default. Only enable on your own machine — anything that can reach
          this port can edit the notebook.
        </span>
      </div>

      <div className="settings-panel__section" style={{ marginTop: 12, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
        <span className="settings-panel__label">Extensions</span>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12 }}>draw.io viewer — exact diagram rendering</span>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: EXT_STATUS_COLOR[drawioExt.status],
              flexShrink: 0,
            }}
          />
          <span
            style={{ fontSize: 12, color: EXT_STATUS_COLOR[drawioExt.status] }}
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
              className="settings-panel__btn"
              onClick={() => void installDrawio()}
              data-testid="settings-ext-drawio-install"
            >
              {drawioExt.status === 'failed' ? 'Retry' : 'Install (~1.1 MB)'}
            </button>
          )}
        </div>

        {drawioExt.status === 'failed' && drawioExt.error && (
          <span
            style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block' }}
            data-testid="settings-ext-drawio-error"
          >
            {drawioExt.error}
          </span>
        )}

        {drawioExt.status === 'installed' && (
          <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'block' }}>
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

        <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, display: 'block' }}>
          Without the extension, draw.io diagrams still display — the extension is
          needed to create or redraw them offline. Renders exactly what
          diagrams.net shows. Apache-2.0.
        </span>
      </div>

      <div className="settings-panel__section" style={{ marginTop: 12, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
        <span className="settings-panel__label" data-testid="settings-app-version">PowerScroll v{APP_VERSION}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
          {updateStatus === 'idle' && (
            <button
              className="settings-panel__btn"
              onClick={handleCheckUpdate}
              data-testid="check-update-btn"
            >
              Check for updates
            </button>
          )}
          {updateStatus === 'checking' && (
            <span style={{ fontSize: 12, color: '#64748b' }} data-testid="update-status-checking">Checking...</span>
          )}
          {updateStatus === 'available' && updateInfo && (
            <>
              <span style={{ fontSize: 12, color: '#16a34a' }}>v{updateInfo.version} available!</span>
              <button
                className="settings-panel__btn settings-panel__btn--primary"
                onClick={handleUpdate}
                data-testid="update-btn"
              >
                Update
              </button>
            </>
          )}
          {updateStatus === 'updating-live' && (
            <span style={{ fontSize: 12, color: '#2563eb' }} data-testid="update-status-live">
              Updating this file…
            </span>
          )}
          {updateStatus === 'updating-download' && (
            <span style={{ fontSize: 12, color: '#2563eb' }} data-testid="update-status-download">
              Downloading backup + update…
            </span>
          )}
          {updateStatus === 'failed' && (
            <>
              <span style={{ fontSize: 12, color: '#dc2626' }}>Update failed (rate limited or offline)</span>
              <button className="settings-panel__btn" onClick={handleCheckUpdate}>Retry</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
