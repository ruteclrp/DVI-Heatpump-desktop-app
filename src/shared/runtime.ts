import type { ConnectionSnapshot, PairingRequest } from './connection';

export interface AppRuntimeInfo {
  platform: NodeJS.Platform;
  shell: 'electron';
  version: string;
}

export interface DviDesktopApi {
  getConnectionSnapshot: () => Promise<ConnectionSnapshot>;
  getRuntimeInfo: () => Promise<AppRuntimeInfo>;
  openPreferredUi: () => Promise<string | null>;
  pairBridge: (request: PairingRequest) => Promise<ConnectionSnapshot>;
  refreshConnection: () => Promise<ConnectionSnapshot>;
  setBridgeOverride: (baseUrl: string | null) => Promise<ConnectionSnapshot>;
}

export const runtimeInfoChannel = 'app:get-runtime-info';