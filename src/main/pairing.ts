export interface PairingRequestPayload {
  deviceName?: string;
  metadata?: Record<string, string | number | boolean>;
  pairingCode?: string;
}

export interface PairingToken {
  pairedAt: Date;
  token: string;
}

const DEFAULT_PAIR_PATHS = ['/pair', '/api/pair'];

export async function pairWithBridge(
  baseUrl: string,
  payload: PairingRequestPayload = {},
): Promise<PairingToken> {
  const pairPaths = getPairPaths();
  const requestBody = JSON.stringify({
    deviceName: payload.deviceName ?? 'DVI Heatpump Desktop',
    metadata: payload.metadata,
    pairingCode: payload.pairingCode,
  });
  const attemptFailures: string[] = [];

  for (const pairPath of pairPaths) {
    const pairUrl = new URL(pairPath, `${baseUrl}/`);

    try {
      const response = await fetch(pairUrl, {
        body: requestBody,
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        attemptFailures.push(`${pairUrl.toString()} -> HTTP ${response.status}`);
        continue;
      }

      const token = extractTokenFromResponse(await readResponseBody(response));

      if (!token) {
        throw new Error(`Pairing response from ${pairUrl.toString()} did not include a token.`);
      }

      return {
        pairedAt: new Date(),
        token,
      };
    } catch (error) {
      attemptFailures.push(`${pairUrl.toString()} -> ${getErrorMessage(error)}`);
    }
  }

  throw new Error(`Pairing failed. Attempts: ${attemptFailures.join('; ')}`);
}

function getPairPaths(): string[] {
  const configuredPaths = (process.env.DVI_PAIR_PATHS ?? process.env.DVI_PAIR_PATH ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizePath);

  return [...new Set([...configuredPaths, ...DEFAULT_PAIR_PATHS])];
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const rawText = await response.text();

  if (!rawText.trim()) {
    return null;
  }

  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return rawText.trim();
  }
}

function extractTokenFromResponse(payload: unknown): string | null {
  if (typeof payload === 'string') {
    return payload;
  }

  return findStringValue(payload, ['token', 'accessToken', 'bearerToken', 'jwt']);
}

function findStringValue(payload: unknown, keys: string[]): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  for (const key of keys) {
    const value = Reflect.get(payload, key);

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  for (const value of Object.values(payload as Record<string, unknown>)) {
    const nestedValue = findStringValue(value, keys);

    if (nestedValue) {
      return nestedValue;
    }
  }

  return null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected pairing error.';
}