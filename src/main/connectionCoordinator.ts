import { app } from 'electron';
import type { ConnectionSnapshot } from '@shared/connection';
import type { AppRuntimeInfo } from '@shared/runtime';
import {
  discoverBridge,
  normalizeBridgeBaseUrl,
  type DiscoveredBridge,
} from './bridgeDiscovery';
import { pairWithBridge } from './pairing';
import { deleteToken, loadToken, saveToken } from './secureStore';
import {
  clearCachedTunnel,
  loadCachedTunnel,
  loadConfiguredBridgeUrl,
  saveCachedTunnel,
  saveConfiguredBridgeUrl,
} from './stateStore';
import { fetchTunnelInfo, type TunnelInfo } from './tunnel';

const TOKEN_ACCOUNT = 'bridge-token';
const TOKEN_SERVICE = 'com.dvi.heatpump.desktop';

export class ConnectionCoordinator {
  private lastSnapshot: ConnectionSnapshot | null = null;

  async getSnapshot(): Promise<ConnectionSnapshot> {
    if (this.lastSnapshot) {
      return this.lastSnapshot;
    }

    return this.refreshConnection();
  }

  async refreshConnection(): Promise<ConnectionSnapshot> {
    const cachedTunnel = await loadCachedTunnel();
    const configuredBridgeUrl = await loadConfiguredBridgeUrl();
    const storedToken = await this.tryLoadToken();
    let localBridge: DiscoveredBridge | null = null;
    let remoteTunnel = cachedTunnel;
    let effectiveToken = storedToken;
    let lastError: string | null = null;

    try {
      localBridge = await discoverBridge({
        configuredBridgeUrls: configuredBridgeUrl ? [configuredBridgeUrl] : [],
      });
    } catch (error) {
      lastError = getErrorMessage(error);
    }

    if (localBridge) {
      const syncResult = await this.syncLocalBridgeState(localBridge, storedToken);
      effectiveToken = syncResult.token;
      remoteTunnel = syncResult.remoteTunnel ?? remoteTunnel;
      lastError = syncResult.lastError;
    }

    const snapshot = this.buildSnapshot({
      configuredBridgeUrl,
      lastError,
      localBridge,
      remoteTunnel,
      storedToken: effectiveToken,
    });

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  async clearStoredConnectionState(): Promise<ConnectionSnapshot> {
    await Promise.all([
      deleteToken(TOKEN_SERVICE, TOKEN_ACCOUNT),
      clearCachedTunnel(),
    ]);

    const configuredBridgeUrl = await loadConfiguredBridgeUrl();
    let localBridge: DiscoveredBridge | null = null;
    let lastError: string | null = null;

    try {
      localBridge = await discoverBridge({
        configuredBridgeUrls: configuredBridgeUrl ? [configuredBridgeUrl] : [],
      });
    } catch (error) {
      lastError = getErrorMessage(error);
    }

    const snapshot = this.buildSnapshot({
      configuredBridgeUrl,
      lastError,
      localBridge,
      remoteTunnel: null,
      storedToken: null,
    });

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  async setBridgeOverride(baseUrl: string | null): Promise<ConnectionSnapshot> {
    const normalizedUrl = baseUrl?.trim() ? normalizeBridgeBaseUrl(baseUrl.trim()) : null;

    await saveConfiguredBridgeUrl(normalizedUrl);
    this.lastSnapshot = null;

    return this.refreshConnection();
  }

  getRuntimeInfo(): AppRuntimeInfo {
    return {
      platform: process.platform,
      shell: 'electron',
      version: app.getVersion(),
    };
  }

  async getPreferredUiNavigationContext(snapshot?: ConnectionSnapshot): Promise<{
    authorizationToken: string | null;
    url: string | null;
  }> {
    const resolvedSnapshot = snapshot ?? (await this.getSnapshot());
    const targetUrl = resolvedSnapshot.preferredUiUrl;

    if (!targetUrl) {
      return {
        authorizationToken: null,
        url: null,
      };
    }

    return {
      authorizationToken:
        resolvedSnapshot.remoteTunnel?.tunnelUrl === targetUrl ? await this.tryLoadToken() : null,
      url: targetUrl,
    };
  }

  private async tryLoadToken(): Promise<string | null> {
    try {
      return await loadToken(TOKEN_SERVICE, TOKEN_ACCOUNT);
    } catch (error) {
      this.lastSnapshot = null;
      return null;
    }
  }

  private async syncLocalBridgeState(
    localBridge: DiscoveredBridge,
    storedToken: string | null,
  ): Promise<{
    lastError: string | null;
    remoteTunnel: TunnelInfo | null;
    token: string | null;
  }> {
    let effectiveToken = storedToken;
    let remoteTunnel: TunnelInfo | null = null;
    let tokenRefreshError: string | null = null;
    let tunnelRefreshError: string | null = null;

    try {
      const pairingResult = await pairWithBridge(localBridge.baseUrl, {
        deviceName: 'DVI Heatpump Desktop',
      });

      if (pairingResult.token !== effectiveToken) {
        await saveToken({
          account: TOKEN_ACCOUNT,
          service: TOKEN_SERVICE,
          token: pairingResult.token,
        });
      }

      effectiveToken = pairingResult.token;
    } catch (error) {
      tokenRefreshError = `Automatic token refresh failed: ${getErrorMessage(error)}`;
    }

    try {
      remoteTunnel = await fetchTunnelInfo(
        localBridge.baseUrl,
        effectiveToken
          ? {
              token: effectiveToken,
            }
          : {},
      );
      await saveCachedTunnel(remoteTunnel);
    } catch (error) {
      tunnelRefreshError = `Tunnel refresh failed: ${getErrorMessage(error)}`;
    }

    return {
      lastError: tunnelRefreshError ?? (!effectiveToken ? tokenRefreshError : null),
      remoteTunnel,
      token: effectiveToken,
    };
  }

  private buildSnapshot({
    configuredBridgeUrl,
    lastError,
    localBridge,
    remoteTunnel,
    storedToken,
  }: {
    configuredBridgeUrl: string | null;
    lastError: string | null;
    localBridge: DiscoveredBridge | null;
    remoteTunnel: TunnelInfo | null;
    storedToken: string | null;
  }): ConnectionSnapshot {
    return {
      activeTransport: localBridge ? 'local' : storedToken && remoteTunnel ? 'remote' : 'offline',
      bridgeOverrideUrl: configuredBridgeUrl,
      hasStoredToken: Boolean(storedToken),
      lastError,
      lastUpdatedAt: new Date().toISOString(),
      localBridge: localBridge
        ? {
            baseUrl: localBridge.baseUrl,
            discoveredAt: localBridge.discoveredAt.toISOString(),
            source: localBridge.source,
          }
        : null,
      preferredUiUrl: localBridge?.baseUrl ?? remoteTunnel?.tunnelUrl ?? null,
      remoteTunnel: remoteTunnel
        ? {
            authorizationMode: remoteTunnel.authorizationMode,
            fetchedAt: remoteTunnel.fetchedAt.toISOString(),
            tunnelUrl: remoteTunnel.tunnelUrl,
          }
        : null,
    };
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown connection error.';
}