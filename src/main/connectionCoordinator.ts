import { app } from 'electron';
import type { ConnectionSnapshot, PairingRequest } from '@shared/connection';
import type { AppRuntimeInfo } from '@shared/runtime';
import {
  discoverBridge,
  normalizeBridgeBaseUrl,
  type DiscoveredBridge,
} from './bridgeDiscovery';
import { pairWithBridge } from './pairing';
import { loadToken, saveToken } from './secureStore';
import {
  loadCachedTunnel,
  loadConfiguredBridgeUrl,
  saveCachedTunnel,
  saveConfiguredBridgeUrl,
} from './stateStore';
import { fetchTunnelInfo } from './tunnel';

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
    let lastError: string | null = null;

    try {
      localBridge = await discoverBridge({
        configuredBridgeUrls: configuredBridgeUrl ? [configuredBridgeUrl] : [],
      });
    } catch (error) {
      lastError = getErrorMessage(error);
    }

    if (localBridge && storedToken) {
      try {
        remoteTunnel = await fetchTunnelInfo(localBridge.baseUrl, {
          token: storedToken,
        });
        await saveCachedTunnel(remoteTunnel);
      } catch (error) {
        lastError = getErrorMessage(error);
      }
    }

    const snapshot: ConnectionSnapshot = {
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

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  async pairBridge(request: PairingRequest): Promise<ConnectionSnapshot> {
    const configuredBridgeUrl = await loadConfiguredBridgeUrl();
    const pairingBaseUrl = configuredBridgeUrl ?? (
      await discoverBridge({
        configuredBridgeUrls: configuredBridgeUrl ? [configuredBridgeUrl] : [],
      })
    )?.baseUrl;

    if (!pairingBaseUrl) {
      throw new Error('No reachable local bridge was found for pairing.');
    }

    const pairingResult = await pairWithBridge(pairingBaseUrl, request);

    await saveToken({
      account: TOKEN_ACCOUNT,
      service: TOKEN_SERVICE,
      token: pairingResult.token,
    });

    return this.refreshConnection();
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
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown connection error.';
}