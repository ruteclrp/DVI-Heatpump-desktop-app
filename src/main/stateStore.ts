import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import type { TunnelInfo } from './tunnel';

interface PersistedState {
  remoteTunnel: PersistedTunnelInfo | null;
}

interface PersistedTunnelInfo {
  authorizationMode: 'bearer';
  fetchedAt: string;
  tunnelUrl: string;
}

export async function loadCachedTunnel(): Promise<TunnelInfo | null> {
  const state = await loadStateFile();

  if (!state.remoteTunnel) {
    return null;
  }

  return {
    authorizationMode: state.remoteTunnel.authorizationMode,
    fetchedAt: new Date(state.remoteTunnel.fetchedAt),
    tunnelUrl: state.remoteTunnel.tunnelUrl,
  };
}

export async function saveCachedTunnel(tunnel: TunnelInfo): Promise<void> {
  await writeStateFile({
    remoteTunnel: {
      authorizationMode: tunnel.authorizationMode,
      fetchedAt: tunnel.fetchedAt.toISOString(),
      tunnelUrl: tunnel.tunnelUrl,
    },
  });
}

async function loadStateFile(): Promise<PersistedState> {
  try {
    const stateJson = await readFile(getStateFilePath(), 'utf8');
    return normalizePersistedState(JSON.parse(stateJson) as Partial<PersistedState>);
  } catch {
    return { remoteTunnel: null };
  }
}

async function writeStateFile(state: PersistedState): Promise<void> {
  const filePath = getStateFilePath();

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
}

function normalizePersistedState(state: Partial<PersistedState>): PersistedState {
  if (!state.remoteTunnel?.tunnelUrl || !state.remoteTunnel.fetchedAt) {
    return { remoteTunnel: null };
  }

  return {
    remoteTunnel: {
      authorizationMode: 'bearer',
      fetchedAt: state.remoteTunnel.fetchedAt,
      tunnelUrl: state.remoteTunnel.tunnelUrl,
    },
  };
}

function getStateFilePath(): string {
  return join(app.getPath('userData'), 'runtime-state.json');
}