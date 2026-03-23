import type * as KeytarModule from 'keytar';

type KeytarApi = Pick<typeof KeytarModule, 'deletePassword' | 'getPassword' | 'setPassword'>;

export interface TokenRecord {
  service: string;
  account: string;
  token: string;
}

let keytarPromise: Promise<KeytarApi> | null = null;
let keytarUnavailableReason: string | null = null;
let warnedAboutFallback = false;
const inMemoryTokenStore = new Map<string, string>();

export async function saveToken(record: TokenRecord): Promise<void> {
  const keytar = await getKeytar();

  if (!keytar) {
    inMemoryTokenStore.set(getTokenKey(record.service, record.account), record.token);
    return;
  }

  await keytar.setPassword(record.service, record.account, record.token);
}

export async function loadToken(service: string, account: string): Promise<string | null> {
  const keytar = await getKeytar();

  if (!keytar) {
    return inMemoryTokenStore.get(getTokenKey(service, account)) ?? null;
  }

  return keytar.getPassword(service, account);
}

export async function deleteToken(service: string, account: string): Promise<boolean> {
  const keytar = await getKeytar();

  if (!keytar) {
    return inMemoryTokenStore.delete(getTokenKey(service, account));
  }

  return keytar.deletePassword(service, account);
}

async function getKeytar(): Promise<KeytarApi | null> {
  if (keytarUnavailableReason) {
    logFallbackWarning();
    return null;
  }

  if (!keytarPromise) {
    keytarPromise = import('keytar')
      .then((module) => normalizeKeytarModule(module))
      .catch((error: unknown) => {
        keytarUnavailableReason = getErrorMessage(error);
        logFallbackWarning();
        return null;
      });
  }

  return keytarPromise;
}

function getTokenKey(service: string, account: string): string {
  return `${service}:${account}`;
}

function logFallbackWarning(): void {
  if (warnedAboutFallback || !keytarUnavailableReason) {
    return;
  }

  warnedAboutFallback = true;
  console.warn(
    `Secure token storage is unavailable, falling back to in-memory session storage only: ${keytarUnavailableReason}`,
  );
}

function normalizeKeytarModule(module: typeof KeytarModule & { default?: unknown }): KeytarApi {
  const candidate = isKeytarApi(module.default) ? module.default : module;

  if (!isKeytarApi(candidate)) {
    throw new Error('Keytar loaded, but its exported API shape was not recognized.');
  }

  return candidate;
}

function isKeytarApi(value: unknown): value is KeytarApi {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (
    typeof Reflect.get(value, 'setPassword') === 'function' &&
    typeof Reflect.get(value, 'getPassword') === 'function' &&
    typeof Reflect.get(value, 'deletePassword') === 'function'
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown keytar load error.';
}