import { app } from 'electron';
import type { ConnectionSnapshot, PairingRequest } from '@shared/connection';
import type { AppRuntimeInfo } from '@shared/runtime';
import { discoverBridge } from './bridgeDiscovery';
import { pairWithBridge } from './pairing';
import { loadToken, saveToken } from './secureStore';
import { loadCachedTunnel, saveCachedTunnel } from './stateStore';
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
    const storedToken = await this.tryLoadToken();
    let localBridge = null;
    let remoteTunnel = cachedTunnel;
    let lastError: string | null = null;

    try {
      localBridge = await discoverBridge();
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
    const localBridge = await discoverBridge();

    if (!localBridge) {
      throw new Error('No reachable local bridge was found for pairing.');
    }

    const pairingResult = await pairWithBridge(localBridge.baseUrl, request);

    await saveToken({
      account: TOKEN_ACCOUNT,
      service: TOKEN_SERVICE,
      token: pairingResult.token,
    });

    return this.refreshConnection();
  }

  getRuntimeInfo(): AppRuntimeInfo {
    return {
      platform: process.platform,
      shell: 'electron',
      version: app.getVersion(),
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