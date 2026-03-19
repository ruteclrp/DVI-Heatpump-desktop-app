import { contextBridge, ipcRenderer } from 'electron';
import {
  getConnectionSnapshotChannel,
  openPreferredUiChannel,
  pairBridgeChannel,
  refreshConnectionChannel,
  setBridgeOverrideChannel,
  type PairingRequest,
} from '@shared/connection';
import { runtimeInfoChannel, showSettingsPageChannel, type DviDesktopApi } from '@shared/runtime';

const api: DviDesktopApi = {
  getConnectionSnapshot: () => ipcRenderer.invoke(getConnectionSnapshotChannel),
  getRuntimeInfo: () => ipcRenderer.invoke(runtimeInfoChannel),
  openPreferredUi: () => ipcRenderer.invoke(openPreferredUiChannel),
  pairBridge: (request: PairingRequest) => ipcRenderer.invoke(pairBridgeChannel, request),
  refreshConnection: () => ipcRenderer.invoke(refreshConnectionChannel),
  setBridgeOverride: (baseUrl: string | null) => ipcRenderer.invoke(setBridgeOverrideChannel, baseUrl),
  showSettingsPage: () => ipcRenderer.invoke(showSettingsPageChannel),
};

contextBridge.exposeInMainWorld('dviDesktop', api);