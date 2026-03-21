import { contextBridge, ipcRenderer } from 'electron';
import {
  clearStoredConnectionStateChannel,
  getConnectionSnapshotChannel,
  openPreferredUiChannel,
  refreshConnectionChannel,
  setBridgeOverrideChannel,
} from '@shared/connection';
import { runtimeInfoChannel, showSettingsPageChannel, type DviDesktopApi } from '@shared/runtime';

const api: DviDesktopApi = {
  clearStoredConnectionState: () => ipcRenderer.invoke(clearStoredConnectionStateChannel),
  getConnectionSnapshot: () => ipcRenderer.invoke(getConnectionSnapshotChannel),
  getRuntimeInfo: () => ipcRenderer.invoke(runtimeInfoChannel),
  openPreferredUi: () => ipcRenderer.invoke(openPreferredUiChannel),
  refreshConnection: () => ipcRenderer.invoke(refreshConnectionChannel),
  setBridgeOverride: (baseUrl: string | null) => ipcRenderer.invoke(setBridgeOverrideChannel, baseUrl),
  showSettingsPage: () => ipcRenderer.invoke(showSettingsPageChannel),
};

contextBridge.exposeInMainWorld('dviDesktop', api);