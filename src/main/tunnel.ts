export interface TunnelInfo {
  authorizationMode: 'bearer';
  fetchedAt: Date;
  tunnelUrl: string;
}

export interface TunnelFetchOptions {
  token?: string;
}

const DEFAULT_TUNNEL_PATHS = ['/api/tunnel', '/tunnel'];

export async function fetchTunnelInfo(
  baseUrl: string,
  options: TunnelFetchOptions = {},
): Promise<TunnelInfo> {
  const attemptedEndpoints: string[] = [];

  for (const path of getTunnelPaths()) {
    const endpoint = new URL(path, `${baseUrl}/`);

    try {
      const response = await fetch(endpoint, {
        headers: options.token
          ? {
              Authorization: `Bearer ${options.token}`,
            }
          : undefined,
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        attemptedEndpoints.push(`${endpoint.toString()} -> HTTP ${response.status}`);
        continue;
      }

      const payload = await response.json();
      const tunnelUrl = findTunnelUrl(payload);

      if (!tunnelUrl) {
        attemptedEndpoints.push(
          `${endpoint.toString()} -> no tunnel URL in response: ${summarizePayload(payload)}`,
        );
        continue;
      }

      return {
        authorizationMode: 'bearer',
        fetchedAt: new Date(),
        tunnelUrl,
      };
    } catch (error) {
      attemptedEndpoints.push(`${endpoint.toString()} -> ${getErrorMessage(error)}`);
    }
  }

  throw new Error(`Tunnel refresh failed. Attempted: ${attemptedEndpoints.join('; ')}`);
}

function findTunnelUrl(payload: unknown): string | null {
  if (typeof payload === 'string') {
    return normalizeUrlCandidate(payload);
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;

  for (const key of [
    'tunnelUrl',
    'tunnel_url',
    'url',
    'endpoint',
    'tunnel',
    'remoteUrl',
    'remote_url',
    'publicUrl',
    'public_url',
    'externalUrl',
    'external_url',
    'backendUrl',
    'backend_url',
    'uri',
    'href',
  ]) {
    const value = Reflect.get(payload, key);

    if (typeof value === 'string') {
      const normalizedValue = normalizeUrlCandidate(value);

      if (normalizedValue) {
        return normalizedValue;
      }
    }
  }

  const constructedUrl = constructTunnelUrl(record);

  if (constructedUrl) {
    return constructedUrl;
  }

  for (const value of Object.values(record)) {
    const nestedValue = findTunnelUrl(value);

    if (nestedValue) {
      return nestedValue;
    }
  }

  return null;
}

function getTunnelPaths(): string[] {
  const configuredPaths = [process.env.DVI_TUNNEL_PATH, process.env.DVI_TUNNEL_PATHS]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .flatMap((value) => value.split(','))
    .map((value) => normalizeEndpointPath(value))
    .filter((value, index, values) => values.indexOf(value) === index);

  return [...configuredPaths, ...DEFAULT_TUNNEL_PATHS].filter(
    (value, index, values) => values.indexOf(value) === index,
  );
}

function normalizeEndpointPath(path: string): string {
  const trimmedPath = path.trim();

  if (!trimmedPath) {
    return '/api/tunnel';
  }

  return trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown tunnel refresh error';
}

function normalizeUrlCandidate(value: string): string | null {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  if (trimmedValue.startsWith('http://') || trimmedValue.startsWith('https://')) {
    return trimmedValue;
  }

  return null;
}

function constructTunnelUrl(payload: Record<string, unknown>): string | null {
  const host = getFirstString(payload, ['host', 'hostname', 'domain']);

  if (!host) {
    return null;
  }

  const protocol = getFirstString(payload, ['protocol', 'scheme']) ?? 'https';
  const path = getFirstString(payload, ['path', 'pathname']) ?? '';
  const port = getPortValue(payload.port);

  try {
    const baseUrl = new URL(`${protocol}://${host}`);

    if (port) {
      baseUrl.port = port;
    }

    if (path) {
      baseUrl.pathname = path.startsWith('/') ? path : `/${path}`;
    }

    return baseUrl.toString().replace(/\/$/, path ? '' : '/');
  } catch {
    return null;
  }
}

function getFirstString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getPortValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return value.trim();
  }

  return null;
}

function summarizePayload(payload: unknown): string {
  try {
    const serialized = JSON.stringify(payload);

    if (!serialized) {
      return 'empty payload';
    }

    return serialized.length > 240 ? `${serialized.slice(0, 237)}...` : serialized;
  } catch {
    return 'unserializable payload';
  }
}