import './styles.css';
import type { ConnectionSnapshot, PairingRequest } from '@shared/connection';
import type { DviDesktopApi } from '@shared/runtime';

declare global {
  interface Window {
    dviDesktop: DviDesktopApi;
  }
}

async function renderRuntimeInfo(): Promise<void> {
  const runtimeElement = document.querySelector<HTMLDListElement>('#runtime-info');

  if (!runtimeElement) {
    return;
  }

  const runtimeInfo = await window.dviDesktop.getRuntimeInfo();

  runtimeElement.innerHTML = `
    <div><dt>Shell</dt><dd>${runtimeInfo.shell}</dd></div>
    <div><dt>Platform</dt><dd>${runtimeInfo.platform}</dd></div>
    <div><dt>Version</dt><dd>${runtimeInfo.version}</dd></div>
  `;
}

async function renderConnectionSnapshot(snapshot?: ConnectionSnapshot): Promise<void> {
  const connectionInfoElement = document.querySelector<HTMLDListElement>('#connection-info');
  const connectionSummaryElement = document.querySelector<HTMLElement>('#connection-summary');

  if (!connectionInfoElement || !connectionSummaryElement) {
    return;
  }

  const connectionSnapshot = snapshot ?? (await window.dviDesktop.getConnectionSnapshot());

  connectionSummaryElement.textContent = connectionSnapshot.lastError
    ? `Last error: ${connectionSnapshot.lastError}`
    : `Preferred transport: ${connectionSnapshot.activeTransport}`;

  connectionInfoElement.innerHTML = `
    <div><dt>Transport</dt><dd>${connectionSnapshot.activeTransport}</dd></div>
    <div><dt>Token stored</dt><dd>${connectionSnapshot.hasStoredToken ? 'yes' : 'no'}</dd></div>
    <div><dt>Local bridge</dt><dd>${connectionSnapshot.localBridge?.baseUrl ?? 'not found'}</dd></div>
    <div><dt>Bridge source</dt><dd>${connectionSnapshot.localBridge?.source ?? 'n/a'}</dd></div>
    <div><dt>Remote tunnel</dt><dd>${connectionSnapshot.remoteTunnel?.tunnelUrl ?? 'not available'}</dd></div>
    <div><dt>Preferred UI URL</dt><dd>${connectionSnapshot.preferredUiUrl ?? 'offline'}</dd></div>
    <div><dt>Updated</dt><dd>${new Date(connectionSnapshot.lastUpdatedAt).toLocaleString()}</dd></div>
  `;
}

function bindRefreshAction(): void {
  const refreshButton = document.querySelector<HTMLButtonElement>('#refresh-connection');

  refreshButton?.addEventListener('click', async () => {
    refreshButton.disabled = true;

    try {
      const snapshot = await window.dviDesktop.refreshConnection();
      await renderConnectionSnapshot(snapshot);
    } finally {
      refreshButton.disabled = false;
    }
  });
}

function bindPairingForm(): void {
  const pairingForm = document.querySelector<HTMLFormElement>('#pairing-form');
  const pairingStatusElement = document.querySelector<HTMLElement>('#pairing-status');

  pairingForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!pairingStatusElement) {
      return;
    }

    const formData = new FormData(pairingForm);
    const request: PairingRequest = {
      deviceName: getOptionalFormValue(formData.get('deviceName')),
      pairingCode: getOptionalFormValue(formData.get('pairingCode')),
    };

    pairingStatusElement.textContent = 'Pairing in progress...';

    try {
      const snapshot = await window.dviDesktop.pairBridge(request);
      pairingStatusElement.textContent = 'Pairing succeeded. Token stored securely.';
      await renderConnectionSnapshot(snapshot);
    } catch (error) {
      pairingStatusElement.textContent = getErrorMessage(error);
    }
  });
}

function getOptionalFormValue(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue || undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected pairing error.';
}

void renderRuntimeInfo();
void renderConnectionSnapshot();
bindRefreshAction();
bindPairingForm();