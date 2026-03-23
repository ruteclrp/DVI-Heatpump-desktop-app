import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  screen,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
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
const SHELL_DEFAULT_HEIGHT_PX = 940;
const SHELL_DEFAULT_VIEWPORT_MARGIN_PX = 80;
const SHELL_DESIRED_CONTENT_WIDTH_PX = 1080;
const SHELL_GAP_PX = 16;
const SHELL_MIN_CONTENT_WIDTH_PX = 860;
const SHELL_MIN_HEIGHT_PX = 760;
const SHELL_PADDING_PX = 16;
const SHELL_SIDEPANEL_WIDTH_PX = 360;
let mainWindow: BrowserWindow | null = null;
let bridgeView: WebContentsView | null = null;
let bridgeViewAttached = false;
let protectedOrigin: string | null = null;
let protectedOriginToken: string | null = null;
let authHandlerRegistered = false;
let connectionMonitorInterval: NodeJS.Timeout | null = null;
let activeNavigationTarget: string | null = null;
let activeNavigationPromise: Promise<string | null> | null = null;
let selectedView: 'auto' | 'settings' | 'ui' = 'auto';
const popupWindows = new Set<BrowserWindow>();

if (disableHardwareAcceleration) {
  app.disableHardwareAcceleration();
}

function createMainWindow(): BrowserWindow {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const desiredWindowWidth = getShellWindowWidth(SHELL_DESIRED_CONTENT_WIDTH_PX);
  const minWindowWidth = getShellWindowWidth(SHELL_MIN_CONTENT_WIDTH_PX);
  const width = Math.min(desiredWindowWidth, Math.max(minWindowWidth, workArea.width - SHELL_DEFAULT_VIEWPORT_MARGIN_PX));
  const height = Math.max(
    SHELL_MIN_HEIGHT_PX,
    Math.min(SHELL_DEFAULT_HEIGHT_PX, workArea.height - SHELL_DEFAULT_VIEWPORT_MARGIN_PX),
  );

  const window = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(minWindowWidth, workArea.width),
    minHeight: Math.min(SHELL_MIN_HEIGHT_PX, workArea.height),
    autoHideMenuBar: true,
    backgroundColor: '#dbe7ee',
    webPreferences: {
      preload: join(currentDir, '../preload/index.cjs'),
    },
  });

  registerTunnelAuthHandler(window);
  registerPopupHandling(window.webContents, window, false);
  registerWebContentsDiagnostics(window.webContents, 'shell');
  registerShellWindow(window);
  void loadShellPage(window);

  return window;
}

function getShellWindowWidth(contentWidth: number): number {
  return contentWidth + SHELL_SIDEPANEL_WIDTH_PX + SHELL_GAP_PX + SHELL_PADDING_PX * 2;
}

function registerShellWindow(window: BrowserWindow): void {
  window.on('resize', () => {
    updateBridgeViewBounds(window);
  });

  window.webContents.on('did-finish-load', () => {
    updateBridgeViewBounds(window);
  });
}

function registerPopupHandling(
  sourceContents: WebContents,
  parentWindow: BrowserWindow,
  allowInAppPopups: boolean,
): void {
  sourceContents.setWindowOpenHandler(({ url }) => {
    if (!allowInAppPopups || !isSupportedPopupUrl(url)) {
      void shell.openExternal(url).catch((error) => {
        console.warn('Failed to open external popup target.', error);
      });

      return { action: 'deny' };
    }

    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        height: 760,
        minHeight: 520,
        minWidth: 720,
        modal: true,
        parent: parentWindow,
        show: false,
        width: 980,
      },
    };
  });

  sourceContents.on('did-create-window', (childWindow) => {
    popupWindows.add(childWindow);
    registerWebContentsDiagnostics(childWindow.webContents, 'popup');

    childWindow.once('ready-to-show', () => {
      if (!childWindow.isDestroyed()) {
        childWindow.show();
      }
    });

    childWindow.on('closed', () => {
      popupWindows.delete(childWindow);
    });
  });
}

function ensureBridgeView(window: BrowserWindow): WebContentsView {
  if (bridgeView && !bridgeView.webContents.isDestroyed()) {
    return bridgeView;
  }

  const view = new WebContentsView();
  bridgeView = view;
  bridgeViewAttached = false;
  registerPopupHandling(view.webContents, window, true);
  registerWebContentsDiagnostics(view.webContents, 'bridge');

  view.webContents.on('did-finish-load', () => {
    void installBridgeUiGuards(view.webContents).catch((error) => {
      console.warn('Failed to install bridge UI guards.', error);
    });
  });

  view.webContents.on('destroyed', () => {
    if (bridgeView === view) {
      bridgeView = null;
      bridgeViewAttached = false;
      activeNavigationPromise = null;
      activeNavigationTarget = null;
    }
  });

  return view;
}

function attachBridgeView(window: BrowserWindow): WebContentsView {
  const view = ensureBridgeView(window);

  if (!bridgeViewAttached) {
    window.contentView.addChildView(view);
    bridgeViewAttached = true;
  }

  updateBridgeViewBounds(window);
  return view;
}

function detachBridgeView(window: BrowserWindow): void {
  if (bridgeView && bridgeViewAttached) {
    window.contentView.removeChildView(bridgeView);
    bridgeViewAttached = false;
  }

  clearBridgeViewState();
}

function clearBridgeViewState(): void {
  bridgeViewAttached = false;

  protectedOrigin = null;
  protectedOriginToken = null;
  activeNavigationTarget = null;
  activeNavigationPromise = null;
}

function updateBridgeViewBounds(window: BrowserWindow): void {
  if (!bridgeView || !bridgeViewAttached || window.isDestroyed()) {
    return;
  }

  const [contentWidth, contentHeight] = window.getContentSize();
  const width = Math.max(
    SHELL_MIN_CONTENT_WIDTH_PX,
    contentWidth - SHELL_PADDING_PX * 2 - SHELL_GAP_PX - SHELL_SIDEPANEL_WIDTH_PX,
  );
  const height = Math.max(320, contentHeight - SHELL_PADDING_PX * 2);

  bridgeView.setBounds({
    x: SHELL_PADDING_PX,
    y: SHELL_PADDING_PX,
    width,
    height,
  });
}

async function installBridgeUiGuards(webContents: WebContents): Promise<void> {
  if (webContents.isDestroyed()) {
    return;
  }

  try {
    await webContents.executeJavaScript(
      `(() => {
        if (window.top !== window || window.opener) {
          return;
        }

        if (window.__dviDesktopMainWindowCloseGuardInstalled) {
          return;
        }

        Object.defineProperty(window, '__dviDesktopMainWindowCloseGuardInstalled', {
          configurable: false,
          enumerable: false,
          value: true,
          writable: false,
        });

        const blockedClose = () => {
          window.dispatchEvent(new CustomEvent('dvi-desktop-main-window-close-blocked'));
        };

        Object.defineProperty(window, 'close', {
          configurable: true,
          enumerable: false,
          value: blockedClose,
          writable: false,
        });
      })();`,
      true,
    );
  } catch (error) {
    if (!isExpectedTransientWindowError(error)) {
      throw error;
    }
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
  await applyViewSelection(snapshot);

  return bridgeView && !bridgeView.webContents.isDestroyed() ? bridgeView.webContents.getURL() : null;
}

async function showSettingsPageInMainWindow(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  selectedView = 'settings';
  detachBridgeView(mainWindow);
}

async function navigateBridgeViewToSnapshot(snapshot: ConnectionSnapshot): Promise<string | null> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  const navigationContext = await connectionCoordinator.getPreferredUiNavigationContext(snapshot);

  if (!navigationContext.url) {
    detachBridgeView(mainWindow);
    return null;
  }

  const targetUrl = new URL(navigationContext.url);
  const targetNavigationUrl = navigationContext.url;
  const isRemoteTunnelNavigation = snapshot.remoteTunnel?.tunnelUrl === navigationContext.url;

  protectedOrigin = isRemoteTunnelNavigation ? targetUrl.origin : null;
  protectedOriginToken = isRemoteTunnelNavigation ? navigationContext.authorizationToken : null;

  const view = attachBridgeView(mainWindow);
  const currentUrl = view.webContents.getURL() || null;

  if (shouldPreserveCurrentBridgeLocation(currentUrl, targetNavigationUrl)) {
    updateBridgeViewBounds(mainWindow);
    return currentUrl;
  }

  if (activeNavigationTarget === targetNavigationUrl && activeNavigationPromise) {
    return activeNavigationPromise;
  }

  const navigationTask = (async () => {
    try {
      if (currentUrl !== targetNavigationUrl) {
        await view.webContents.loadURL(targetNavigationUrl);
      }
    } catch (error) {
      if (!isExpectedTransientWindowError(error)) {
        throw error;
      }
    } finally {
      if (activeNavigationTarget === targetNavigationUrl) {
        activeNavigationTarget = null;
        activeNavigationPromise = null;
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      updateBridgeViewBounds(mainWindow);
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

  if (selectedView === 'settings') {
    detachBridgeView(mainWindow);
    return;
  }

  if (!snapshot.preferredUiUrl) {
    detachBridgeView(mainWindow);
    return;
  }

  await navigateBridgeViewToSnapshot(snapshot);
}

async function loadShellPage(window: BrowserWindow): Promise<void> {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;

  if (devServerUrl) {
    try {
      const currentUrl = window.webContents.getURL();

      if (currentUrl !== devServerUrl) {
        await window.loadURL(devServerUrl);
      }
    } catch (error) {
      if (!isExpectedTransientWindowError(error)) {
        throw error;
      }
    }

    return;
  }

  try {
    await window.loadFile(join(currentDir, '../renderer/index.html'));
  } catch (error) {
    if (!isExpectedTransientWindowError(error)) {
      throw error;
    }
  }
}

function registerWebContentsDiagnostics(webContents: WebContents, label: 'bridge' | 'popup' | 'shell'): void {
  webContents.on('render-process-gone', (_event, details) => {
    console.warn(`${label} renderer exited.`, details);
  });

  webContents.on('unresponsive', () => {
    console.warn(`${label} renderer became unresponsive.`);
  });
}

function shouldPreserveCurrentBridgeLocation(
  currentUrl: string | null,
  targetNavigationUrl: string,
): boolean {
  if (!currentUrl) {
    return false;
  }

  if (currentUrl === targetNavigationUrl) {
    return true;
  }

  return tryGetOrigin(currentUrl) !== null && tryGetOrigin(currentUrl) === tryGetOrigin(targetNavigationUrl);
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

function isSupportedPopupUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
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
    clearBridgeViewState();
    bridgeView = null;
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
        clearBridgeViewState();
        bridgeView = null;
        mainWindow = null;
      });
      void refreshConnectionRouting().catch((error) => {
        console.warn('Connection routing on activate failed.', error);
      });
    }
  });
});

function isExpectedTransientWindowError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('ERR_ABORTED') ||
    error.message.includes('Object has been destroyed') ||
    error.message.includes('Render frame was disposed') ||
    error.message.includes('WebContents was destroyed')
  );
}

app.on('window-all-closed', () => {
  popupWindows.clear();
  bridgeView = null;
  bridgeViewAttached = false;

  if (connectionMonitorInterval) {
    clearInterval(connectionMonitorInterval);
    connectionMonitorInterval = null;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});