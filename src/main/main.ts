import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  getConnectionSnapshotChannel,
  pairBridgeChannel,
  refreshConnectionChannel,
  type PairingRequest,
} from '@shared/connection';
import { runtimeInfoChannel } from '@shared/runtime';
import { ConnectionCoordinator } from './connectionCoordinator';

const currentDir = dirname(fileURLToPath(import.meta.url));
const connectionCoordinator = new ConnectionCoordinator();

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(currentDir, '../preload/index.js'),
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(currentDir, '../renderer/index.html'));
  }

  return window;
}

app.whenReady().then(() => {
  ipcMain.handle(runtimeInfoChannel, () => connectionCoordinator.getRuntimeInfo());
  ipcMain.handle(getConnectionSnapshotChannel, () => connectionCoordinator.getSnapshot());
  ipcMain.handle(refreshConnectionChannel, () => connectionCoordinator.refreshConnection());
  ipcMain.handle(pairBridgeChannel, (_event: IpcMainInvokeEvent, request: PairingRequest) =>
    connectionCoordinator.pairBridge(request),
  );

  void connectionCoordinator.refreshConnection();

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});