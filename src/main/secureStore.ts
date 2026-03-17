import type * as KeytarModule from 'keytar';

export interface TokenRecord {
  service: string;
  account: string;
  token: string;
}

let keytarPromise: Promise<typeof KeytarModule> | null = null;

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

async function getKeytar(): Promise<typeof KeytarModule> {
  if (!keytarPromise) {
    keytarPromise = import('keytar').catch((error: unknown) => {
      throw new Error(
        `Keytar could not be loaded for secure token storage: ${getErrorMessage(error)}`,
      );
    });
  }

  return keytarPromise;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown keytar load error.';
}