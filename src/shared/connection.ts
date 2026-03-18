export type ConnectionTransport = 'local' | 'remote' | 'offline';

export interface BridgeConnectionInfo {
  baseUrl: string;
  discoveredAt: string;
  source: 'configured' | 'manual' | 'subnet-scan';
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

export interface PairingRequest {
  deviceName?: string;
  metadata?: Record<string, string | number | boolean>;
  pairingCode?: string;
}

export const getConnectionSnapshotChannel = 'connection:get-snapshot';
export const openPreferredUiChannel = 'connection:open-preferred-ui';
export const pairBridgeChannel = 'connection:pair-bridge';
export const refreshConnectionChannel = 'connection:refresh';
export const setBridgeOverrideChannel = 'connection:set-bridge-override';