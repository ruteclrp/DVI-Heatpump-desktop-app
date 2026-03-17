export interface PairingRequestPayload {
  deviceName?: string;
  metadata?: Record<string, string | number | boolean>;
  pairingCode?: string;
}

export interface PairingToken {
  pairedAt: Date;
  token: string;
}

export async function pairWithBridge(
  baseUrl: string,
  payload: PairingRequestPayload = {},
): Promise<PairingToken> {
  const response = await fetch(new URL('/pair', `${baseUrl}/`), {
    body: JSON.stringify({
      deviceName: payload.deviceName ?? 'DVI Heatpump Desktop',
      metadata: payload.metadata,
      pairingCode: payload.pairingCode,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`Pairing failed with status ${response.status}.`);
  }

  const token = extractTokenFromResponse(await readResponseBody(response));

  if (!token) {
    throw new Error('Pairing response did not include a token.');
  }

  return {
    pairedAt: new Date(),
    token,
  };
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