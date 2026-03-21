import type { ConnectionSnapshot } from './connection';

export interface AppRuntimeInfo {
  platform: NodeJS.Platform;
  shell: 'electron';
  version: string;
}

export interface DviDesktopApi {
  clearStoredConnectionState: () => Promise<ConnectionSnapshot>;
  getConnectionSnapshot: () => Promise<ConnectionSnapshot>;
  getRuntimeInfo: () => Promise<AppRuntimeInfo>;
  openPreferredUi: () => Promise<string | null>;
  refreshConnection: () => Promise<ConnectionSnapshot>;
  setBridgeOverride: (baseUrl: string | null) => Promise<ConnectionSnapshot>;
  showSettingsPage: () => Promise<void>;
}

export const runtimeInfoChannel = 'app:get-runtime-info';
export const showSettingsPageChannel = 'app:show-settings-page';