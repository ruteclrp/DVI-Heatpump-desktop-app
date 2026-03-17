export interface TunnelInfo {
  authorizationMode: 'bearer';
  fetchedAt: Date;
  tunnelUrl: string;
}

export interface TunnelFetchOptions {
  token?: string;
}

export async function fetchTunnelInfo(
  baseUrl: string,
  options: TunnelFetchOptions = {},
): Promise<TunnelInfo> {
  const response = await fetch(new URL('/api/tunnel', `${baseUrl}/`), {
    headers: options.token
      ? {
          Authorization: `Bearer ${options.token}`,
        }
      : undefined,
    method: 'GET',
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`Tunnel refresh failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const tunnelUrl = findTunnelUrl(payload);

  if (!tunnelUrl) {
    throw new Error('Tunnel refresh response did not include a tunnel URL.');
  }

  return {
    authorizationMode: 'bearer',
    fetchedAt: new Date(),
    tunnelUrl,
  };
}

function findTunnelUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  for (const key of ['tunnelUrl', 'url', 'endpoint', 'tunnel']) {
    const value = Reflect.get(payload, key);

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  for (const value of Object.values(payload as Record<string, unknown>)) {
    const nestedValue = findTunnelUrl(value);

    if (nestedValue) {
      return nestedValue;
    }
  }

  return null;
}