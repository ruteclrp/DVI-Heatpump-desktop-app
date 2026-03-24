import type { ConnectionSnapshot } from './connection';

export interface AppDateTimeFormatInfo {
  locale: string;
  shortDatePattern: string | null;
  shortTimePattern: string | null;
}

export interface AppRuntimeInfo {
  dateTimeFormat: AppDateTimeFormatInfo;
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