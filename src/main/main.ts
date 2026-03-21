import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  clearStoredConnectionStateChannel,
  getConnectionSnapshotChannel,
  openPreferredUiChannel,
  refreshConnectionChannel,
  type ConnectionSnapshot,
  setBridgeOverrideChannel,
} from '@shared/connection';
import { runtimeInfoChannel, showSettingsPageChannel } from '@shared/runtime';
import { ConnectionCoordinator } from './connectionCoordinator';

const currentDir = dirname(fileURLToPath(import.meta.url));
const connectionCoordinator = new ConnectionCoordinator();
const disableHardwareAcceleration = process.env.DVI_DISABLE_HARDWARE_ACCELERATION !== '0';
const CONNECTION_MONITOR_INTERVAL_MS = Number(process.env.DVI_CONNECTION_MONITOR_INTERVAL_MS ?? '10000');
let mainWindow: BrowserWindow | null = null;
let protectedOrigin: string | null = null;
let protectedOriginToken: string | null = null;
let authHandlerRegistered = false;
let overlaySyncInterval: NodeJS.Timeout | null = null;
let connectionMonitorInterval: NodeJS.Timeout | null = null;
let activeNavigationTarget: string | null = null;
let activeNavigationPromise: Promise<string | null> | null = null;
let selectedView: 'auto' | 'settings' | 'ui' = 'auto';

if (disableHardwareAcceleration) {
  app.disableHardwareAcceleration();
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(currentDir, '../preload/index.cjs'),
    },
  });

  registerTunnelAuthHandler(window);
  registerConnectionOverlaySync(window);

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(currentDir, '../renderer/index.html'));
  }

  return window;
}

function registerConnectionOverlaySync(window: BrowserWindow): void {
  window.webContents.on('did-finish-load', () => {
    void syncConnectionOverlay(window).catch((error) => {
      console.warn('Failed to sync connection overlay after page load.', error);
    });
  });

  if (!overlaySyncInterval) {
    overlaySyncInterval = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      void syncConnectionOverlay(mainWindow).catch((error) => {
        console.warn('Failed to refresh connection overlay.', error);
      });
    }, 15_000);
  }
}

function registerTunnelAuthHandler(window: BrowserWindow): void {
  if (authHandlerRegistered) {
    return;
  }

  window.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders };

    if (protectedOrigin && protectedOriginToken) {
      try {
        if (new URL(details.url).origin === protectedOrigin) {
          requestHeaders.Authorization = `Bearer ${protectedOriginToken}`;
        }
      } catch {
        // Ignore malformed URLs from Electron internals.
      }
    }

    callback({ requestHeaders });
  });

  authHandlerRegistered = true;
}

async function openPreferredUiInMainWindow(): Promise<string | null> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  selectedView = 'ui';
  const snapshot = await connectionCoordinator.refreshConnection();
  return navigateMainWindowToSnapshot(snapshot);
}

async function showSettingsPageInMainWindow(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  selectedView = 'settings';
  protectedOrigin = null;
  protectedOriginToken = null;
  activeNavigationTarget = null;
  activeNavigationPromise = null;
  await loadShellPage(mainWindow);
}

async function navigateMainWindowToSnapshot(snapshot: ConnectionSnapshot): Promise<string | null> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  const navigationContext = await connectionCoordinator.getPreferredUiNavigationContext(snapshot);

  if (!navigationContext.url) {
    return null;
  }

  const targetUrl = new URL(navigationContext.url);
  const targetNavigationUrl = navigationContext.url;
  const isRemoteTunnelNavigation = snapshot.remoteTunnel?.tunnelUrl === navigationContext.url;

  protectedOrigin = isRemoteTunnelNavigation ? targetUrl.origin : null;
  protectedOriginToken = isRemoteTunnelNavigation ? navigationContext.authorizationToken : null;

  if (activeNavigationTarget === targetNavigationUrl && activeNavigationPromise) {
    return activeNavigationPromise;
  }

  const navigationTask = (async () => {
    try {
      const currentUrl = mainWindow?.webContents.getURL() ?? null;

      if (currentUrl !== targetNavigationUrl) {
        await mainWindow?.loadURL(targetNavigationUrl);
      }
    } catch (error) {
      if (!isExpectedNavigationAbort(error)) {
        throw error;
      }
    } finally {
      if (activeNavigationTarget === targetNavigationUrl) {
        activeNavigationTarget = null;
        activeNavigationPromise = null;
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      await syncConnectionOverlay(mainWindow, snapshot);
    }

    return targetNavigationUrl;
  })();

  activeNavigationTarget = targetNavigationUrl;
  activeNavigationPromise = navigationTask;
  return navigationTask;
}

function startConnectionMonitor(): void {
  if (connectionMonitorInterval) {
    return;
  }

  connectionMonitorInterval = setInterval(() => {
    void refreshConnectionRouting().catch((error) => {
      console.warn('Connection routing refresh failed.', error);
    });
  }, CONNECTION_MONITOR_INTERVAL_MS);
}

async function refreshConnectionRouting(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const snapshot = await connectionCoordinator.refreshConnection();
  await applyViewSelection(snapshot);
}

async function applyViewSelection(snapshot: ConnectionSnapshot): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const currentUrl = mainWindow.webContents.getURL();
  const isShellPage = !shouldShowConnectionOverlay(currentUrl);

  if (selectedView === 'settings') {
    if (!isShellPage) {
      await loadShellPage(mainWindow);
    }

    return;
  }

  if (selectedView === 'ui') {
    if (isShellPage) {
      if (snapshot.preferredUiUrl) {
        await navigateMainWindowToSnapshot(snapshot);
        return;
      }
    } else {
      const currentOrigin = tryGetOrigin(currentUrl);
      const preferredOrigin = tryGetOrigin(snapshot.preferredUiUrl);

      if (snapshot.preferredUiUrl && currentOrigin !== preferredOrigin) {
        await navigateMainWindowToSnapshot(snapshot);
        return;
      }
    }

    await syncConnectionOverlay(mainWindow, snapshot);
    return;
  }

  if (isShellPage) {
    if (snapshot.preferredUiUrl) {
      await navigateMainWindowToSnapshot(snapshot);
      return;
    }
  } else {
    const currentOrigin = tryGetOrigin(currentUrl);
    const preferredOrigin = tryGetOrigin(snapshot.preferredUiUrl);

    if (snapshot.preferredUiUrl && currentOrigin !== preferredOrigin) {
      await navigateMainWindowToSnapshot(snapshot);
      return;
    }
  }

  await syncConnectionOverlay(mainWindow, snapshot);
}

async function loadShellPage(window: BrowserWindow): Promise<void> {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;

  if (devServerUrl) {
    const currentUrl = window.webContents.getURL();

    if (currentUrl !== devServerUrl) {
      await window.loadURL(devServerUrl);
    }

    return;
  }

  await window.loadFile(join(currentDir, '../renderer/index.html'));
}

async function syncConnectionOverlay(
  window: BrowserWindow,
  snapshot?: ConnectionSnapshot,
): Promise<void> {
  if (window.isDestroyed()) {
    return;
  }

  const currentUrl = window.webContents.getURL();

  if (!shouldShowConnectionOverlay(currentUrl)) {
    return;
  }

  const resolvedSnapshot = snapshot ?? (await connectionCoordinator.getSnapshot());
  const overlayModel = buildOverlayModel(resolvedSnapshot, currentUrl);

  await window.webContents.executeJavaScript(
    `(() => {
      const data = ${JSON.stringify(overlayModel)};
      const existingPanel = document.getElementById('dvi-desktop-connection-overlay');
      if (existingPanel) {
        existingPanel.remove();
      }

      const panel = document.createElement('aside');
      panel.id = 'dvi-desktop-connection-overlay';
      panel.setAttribute('role', 'status');
      panel.setAttribute('aria-live', 'polite');
      document.documentElement.style.setProperty('--dvi-desktop-sidepanel-width', '308px');
      document.documentElement.style.setProperty(
        '--dvi-desktop-content-width',
        'calc(100vw - min(var(--dvi-desktop-sidepanel-width), 42vw) - 12px)',
      );
      panel.innerHTML = [
        '<div class="dvi-desktop-connection-overlay__title">Desktop connection</div>',
        '<dl class="dvi-desktop-connection-overlay__list">',
        '<div><dt>Local net</dt><dd>' + escapeHtml(data.localNet) + '</dd></div>',
        '<div><dt>Remote net</dt><dd>' + escapeHtml(data.remoteNet) + '</dd></div>',
        '<div><dt>Connected via</dt><dd>' + escapeHtml(data.connectedViaLabel) + '</dd></div>',
        '<div><dt>URL</dt><dd class="dvi-desktop-connection-overlay__url">' + escapeHtml(data.connectedUrl) + '</dd></div>',
        '<div><dt>Token auth</dt><dd>' + escapeHtml(data.tokenAuth) + '</dd></div>',
        '</dl>',
        '<div class="dvi-desktop-connection-overlay__actions">',
        '<button type="button" class="dvi-desktop-connection-overlay__button" id="dvi-desktop-open-settings">Settings</button>',
        '</div>',
        '<p class="dvi-desktop-connection-overlay__status" id="dvi-desktop-overlay-status"></p>',
      ].join('');

      Object.assign(panel.style, {
        position: 'fixed',
        top: '0',
        right: '0',
        bottom: '0',
        zIndex: '2147483647',
        width: 'min(var(--dvi-desktop-sidepanel-width), 42vw)',
        minWidth: '240px',
        maxWidth: '320px',
        padding: '16px 16px 18px',
        borderLeft: '1px solid rgba(255,255,255,0.14)',
        background: 'rgba(14, 18, 24, 0.94)',
        color: '#f5f7fa',
        boxShadow: '-8px 0 28px rgba(0,0,0,0.24)',
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '12px',
        lineHeight: '1.35',
        backdropFilter: 'blur(10px)',
        overflowY: 'auto',
      });

      const style = document.createElement('style');
      style.textContent = [
        ':root { --dvi-desktop-sidepanel-width: 308px; }',
        ':root { --dvi-desktop-content-width: calc(100vw - min(var(--dvi-desktop-sidepanel-width), 42vw) - 12px); }',
        'html { width: 100% !important; overflow-x: hidden !important; }',
        'body { box-sizing: border-box !important; width: var(--dvi-desktop-content-width) !important; max-width: var(--dvi-desktop-content-width) !important; padding-right: 12px !important; overflow-x: hidden !important; }',
        'body > *:not(#dvi-desktop-connection-overlay) { max-width: var(--dvi-desktop-content-width) !important; }',
        '.modal-overlay, dialog, [role="dialog"], ha-dialog { left: 0 !important; right: calc(min(var(--dvi-desktop-sidepanel-width), 42vw) + 12px) !important; width: auto !important; max-width: var(--dvi-desktop-content-width) !important; }',
        '.modal-content { max-width: min(90vw, var(--dvi-desktop-content-width)) !important; }',
        '#dvi-desktop-connection-overlay * { box-sizing: border-box; }',
        '#dvi-desktop-connection-overlay .dvi-desktop-connection-overlay__title { font-size: 13px; font-weight: 700; margin-bottom: 10px; letter-spacing: 0.02em; }',
        '#dvi-desktop-connection-overlay .dvi-desktop-connection-overlay__list { display: grid; gap: 6px; margin: 0; }',
        '#dvi-desktop-connection-overlay .dvi-desktop-connection-overlay__list div { display: grid; grid-template-columns: 88px 1fr; gap: 8px; align-items: start; }',
        '#dvi-desktop-connection-overlay .dvi-desktop-connection-overlay__actions { display: flex; gap: 8px; margin-top: 14px; }',
        '#dvi-desktop-connection-overlay .dvi-desktop-connection-overlay__button { appearance: none; border: 0; border-radius: 999px; padding: 10px 14px; background: #f5f7fa; color: #0f1822; cursor: pointer; font: inherit; font-weight: 700; }',
        '#dvi-desktop-connection-overlay .dvi-desktop-connection-overlay__button:disabled { opacity: 0.65; cursor: progress; }',
        '#dvi-desktop-connection-overlay .dvi-desktop-connection-overlay__status { margin: 10px 0 0; color: rgba(245,247,250,0.72); min-height: 1.35em; }',
        '#dvi-desktop-connection-overlay dt { margin: 0; color: rgba(245,247,250,0.72); font-weight: 600; }',
        '#dvi-desktop-connection-overlay dd { margin: 0; font-weight: 500; word-break: break-word; }',
        '#dvi-desktop-connection-overlay .dvi-desktop-connection-overlay__url { font-family: Consolas, "SFMono-Regular", monospace; font-size: 11px; }',
        '@media (max-width: 900px) { :root { --dvi-desktop-content-width: calc(100vw - min(var(--dvi-desktop-sidepanel-width), 48vw) - 8px); } body { width: var(--dvi-desktop-content-width) !important; max-width: var(--dvi-desktop-content-width) !important; padding-right: 8px !important; } body > *:not(#dvi-desktop-connection-overlay) { max-width: var(--dvi-desktop-content-width) !important; } .modal-overlay, dialog, [role="dialog"], ha-dialog { right: calc(min(var(--dvi-desktop-sidepanel-width), 48vw) + 8px) !important; max-width: var(--dvi-desktop-content-width) !important; } .modal-content { max-width: min(95vw, var(--dvi-desktop-content-width)) !important; } #dvi-desktop-connection-overlay { width: min(var(--dvi-desktop-sidepanel-width), 48vw) !important; min-width: 220px !important; } }',
      ].join('');

      panel.appendChild(style);
      document.body.appendChild(panel);

      const openSettingsButton = document.getElementById('dvi-desktop-open-settings');
      const statusElement = document.getElementById('dvi-desktop-overlay-status');

      openSettingsButton?.addEventListener('click', async () => {
        if (!window.dviDesktop?.showSettingsPage) {
          if (statusElement) {
            statusElement.textContent = 'Settings view is not available in this build.';
          }

          return;
        }

        openSettingsButton.disabled = true;

        try {
          await window.dviDesktop.showSettingsPage();
        } catch {
          if (statusElement) {
            statusElement.textContent = 'Failed to open settings view.';
          }

          openSettingsButton.disabled = false;
        }
      });

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }
    })();`,
    true,
  );
}

function shouldShowConnectionOverlay(currentUrl: string): boolean {
  if (!currentUrl) {
    return false;
  }

  if (currentUrl.startsWith('file://')) {
    return false;
  }

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;

  if (devServerUrl) {
    try {
      return new URL(currentUrl).origin !== new URL(devServerUrl).origin;
    } catch {
      return true;
    }
  }

  return true;
}

function buildOverlayModel(snapshot: ConnectionSnapshot, currentUrl: string): {
  connectedUrl: string;
  connectedViaLabel: string;
  localNet: string;
  remoteNet: string;
  tokenAuth: string;
} {
  const localNet = snapshot.localBridge
    ? snapshot.activeTransport === 'local'
      ? 'connected'
      : 'available'
    : 'unavailable';
  const remoteNet = snapshot.remoteTunnel
    ? snapshot.activeTransport === 'remote'
      ? 'connected'
      : 'available'
    : 'unavailable';
  const connectedViaLabel = snapshot.activeTransport === 'remote' ? 'Tunnel URL' : 'Local URL';
  const connectedUrl = snapshot.activeTransport === 'remote'
    ? snapshot.remoteTunnel?.tunnelUrl ?? currentUrl
    : snapshot.localBridge?.baseUrl ?? currentUrl;
  const tokenAuth = snapshot.activeTransport === 'remote' && Boolean(protectedOriginToken)
    ? 'Bearer token'
    : 'not in use';

  return {
    connectedUrl,
    connectedViaLabel,
    localNet,
    remoteNet,
    tokenAuth,
  };
}

function tryGetOrigin(url: string | null): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

app.whenReady().then(() => {
  ipcMain.handle(runtimeInfoChannel, () => connectionCoordinator.getRuntimeInfo());
  ipcMain.handle(getConnectionSnapshotChannel, () => connectionCoordinator.getSnapshot());
  ipcMain.handle(clearStoredConnectionStateChannel, () => connectionCoordinator.clearStoredConnectionState());
  ipcMain.handle(refreshConnectionChannel, async () => {
    const snapshot = await connectionCoordinator.refreshConnection();
    await applyViewSelection(snapshot);
    return snapshot;
  });
  ipcMain.handle(openPreferredUiChannel, () => openPreferredUiInMainWindow());
  ipcMain.handle(showSettingsPageChannel, () => showSettingsPageInMainWindow());
  ipcMain.handle(setBridgeOverrideChannel, (_event: IpcMainInvokeEvent, baseUrl: string | null) =>
    connectionCoordinator.setBridgeOverride(baseUrl).then(async (snapshot) => {
      await applyViewSelection(snapshot);
      return snapshot;
    }),
  );

  mainWindow = createMainWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  startConnectionMonitor();
  void refreshConnectionRouting().catch((error) => {
    console.warn('Initial connection routing failed.', error);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      mainWindow.on('closed', () => {
        mainWindow = null;
      });
      void refreshConnectionRouting().catch((error) => {
        console.warn('Connection routing on activate failed.', error);
      });
    }
  });
});

function isExpectedNavigationAbort(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('ERR_ABORTED');
}

app.on('window-all-closed', () => {
  if (connectionMonitorInterval) {
    clearInterval(connectionMonitorInterval);
    connectionMonitorInterval = null;
  }

  if (overlaySyncInterval) {
    clearInterval(overlaySyncInterval);
    overlaySyncInterval = null;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});