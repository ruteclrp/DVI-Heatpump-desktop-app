export type ConnectionTransport = 'local' | 'remote' | 'offline';

export interface BridgeConnectionInfo {
  baseUrl: string;
  discoveredAt: string;
  source: 'configured' | 'manual' | 'mdns';
}

export interface RemoteTunnelConnectionInfo {
  authorizationMode: 'bearer';
  fetchedAt: string;
  tunnelUrl: string;
}

export interface ConnectionSnapshot {
  activeTransport: ConnectionTransport;
  bridgeOverrideUrl: string | null;
  hasStoredToken: boolean;
  lastError: string | null;
  lastUpdatedAt: string;
  localBridge: BridgeConnectionInfo | null;
  preferredUiUrl: string | null;
  remoteTunnel: RemoteTunnelConnectionInfo | null;
}

export const clearStoredConnectionStateChannel = 'connection:clear-stored-state';
export const getConnectionSnapshotChannel = 'connection:get-snapshot';
export const openPreferredUiChannel = 'connection:open-preferred-ui';
export const refreshConnectionChannel = 'connection:refresh';
export const setBridgeOverrideChannel = 'connection:set-bridge-override';