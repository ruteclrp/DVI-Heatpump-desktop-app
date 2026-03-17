import { contextBridge, ipcRenderer } from 'electron';
import {
  getConnectionSnapshotChannel,
  pairBridgeChannel,
  refreshConnectionChannel,
  type PairingRequest,
} from '@shared/connection';
import { runtimeInfoChannel, type DviDesktopApi } from '@shared/runtime';

const api: DviDesktopApi = {
  getConnectionSnapshot: () => ipcRenderer.invoke(getConnectionSnapshotChannel),
  getRuntimeInfo: () => ipcRenderer.invoke(runtimeInfoChannel),
  pairBridge: (request: PairingRequest) => ipcRenderer.invoke(pairBridgeChannel, request),
  refreshConnection: () => ipcRenderer.invoke(refreshConnectionChannel),
};

contextBridge.exposeInMainWorld('dviDesktop', api);