import type * as KeytarModule from 'keytar';

type KeytarApi = Pick<typeof KeytarModule, 'deletePassword' | 'getPassword' | 'setPassword'>;

export interface TokenRecord {
  service: string;
  account: string;
  token: string;
}

let keytarPromise: Promise<KeytarApi> | null = null;

export async function saveToken(record: TokenRecord): Promise<void> {
  const keytar = await getKeytar();

  await keytar.setPassword(record.service, record.account, record.token);
}

export async function loadToken(service: string, account: string): Promise<string | null> {
  const keytar = await getKeytar();

  return keytar.getPassword(service, account);
}

export async function deleteToken(service: string, account: string): Promise<boolean> {
  const keytar = await getKeytar();

  return keytar.deletePassword(service, account);
}

async function getKeytar(): Promise<KeytarApi> {
  if (!keytarPromise) {
    keytarPromise = import('keytar')
      .then((module) => normalizeKeytarModule(module))
      .catch((error: unknown) => {
        throw new Error(
          `Keytar could not be loaded for secure token storage: ${getErrorMessage(error)}`,
        );
      });
  }

  return keytarPromise;
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