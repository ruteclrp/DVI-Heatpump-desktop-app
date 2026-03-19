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
  const bridgeOverrideInput = document.querySelector<HTMLInputElement>('#bridge-override-url');
  const openPreferredUiButton = document.querySelector<HTMLButtonElement>('#open-preferred-ui');

  if (!connectionInfoElement || !connectionSummaryElement) {
    return;
  }

  const connectionSnapshot = snapshot ?? (await window.dviDesktop.getConnectionSnapshot());
  const tunnelStatus = getTunnelStatus(connectionSnapshot);

  connectionSummaryElement.textContent = connectionSnapshot.lastError
    ? `Tunnel status: ${tunnelStatus}. Last error: ${connectionSnapshot.lastError}`
    : `Preferred transport: ${connectionSnapshot.activeTransport}. Tunnel status: ${tunnelStatus}.`;

  if (bridgeOverrideInput) {
    bridgeOverrideInput.value = connectionSnapshot.bridgeOverrideUrl ?? '';
  }

  if (openPreferredUiButton) {
    openPreferredUiButton.disabled = !connectionSnapshot.preferredUiUrl;
  }

  connectionInfoElement.innerHTML = `
    <div><dt>Transport</dt><dd>${escapeHtml(connectionSnapshot.activeTransport)}</dd></div>
    <div><dt>Token stored</dt><dd>${connectionSnapshot.hasStoredToken ? 'yes' : 'no'}</dd></div>
    <div><dt>Bridge override</dt><dd>${renderTextValue(connectionSnapshot.bridgeOverrideUrl, 'not set')}</dd></div>
    <div><dt>Local bridge</dt><dd>${renderUrlValue(connectionSnapshot.localBridge?.baseUrl, 'not found')}</dd></div>
    <div><dt>Bridge source</dt><dd>${escapeHtml(connectionSnapshot.localBridge?.source ?? 'n/a')}</dd></div>
    <div><dt>Tunnel status</dt><dd>${escapeHtml(tunnelStatus)}</dd></div>
    <div><dt>Tunnel fetched at</dt><dd>${renderDateValue(connectionSnapshot.remoteTunnel?.fetchedAt, 'not fetched')}</dd></div>
    <div><dt>Tunnel URL</dt><dd>${renderUrlValue(connectionSnapshot.remoteTunnel?.tunnelUrl, 'not available')}</dd></div>
    <div><dt>Preferred UI URL</dt><dd>${renderUrlValue(connectionSnapshot.preferredUiUrl, 'offline')}</dd></div>
    <div><dt>Updated</dt><dd>${escapeHtml(new Date(connectionSnapshot.lastUpdatedAt).toLocaleString())}</dd></div>
  `;
}

function bindRefreshAction(): void {
  const refreshButton = document.querySelector<HTMLButtonElement>('#refresh-connection');
  const connectionSummaryElement = document.querySelector<HTMLElement>('#connection-summary');

  refreshButton?.addEventListener('click', async () => {
    refreshButton.disabled = true;

    try {
      const snapshot = await window.dviDesktop.refreshConnection();
      await renderConnectionSnapshot(snapshot);
    } catch (error) {
      if (connectionSummaryElement) {
        connectionSummaryElement.textContent = getErrorMessage(error);
      }
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

function bindBridgeOverrideForm(): void {
  const bridgeOverrideForm = document.querySelector<HTMLFormElement>('#bridge-override-form');
  const bridgeOverrideStatusElement = document.querySelector<HTMLElement>('#bridge-override-status');
  const clearButton = document.querySelector<HTMLButtonElement>('#clear-bridge-override');

  bridgeOverrideForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!bridgeOverrideStatusElement) {
      return;
    }

    if (!supportsBridgeOverride()) {
      bridgeOverrideStatusElement.textContent =
        'Bridge override is not available in the current preload script. Restart npm run dev and try again.';
      return;
    }

    const formData = new FormData(bridgeOverrideForm);
    const bridgeOverrideUrl = getOptionalFormValue(formData.get('bridgeOverrideUrl')) ?? null;

    bridgeOverrideStatusElement.textContent = 'Saving bridge override...';

    try {
      const snapshot = await window.dviDesktop.setBridgeOverride(bridgeOverrideUrl);
      bridgeOverrideStatusElement.textContent = snapshot.bridgeOverrideUrl
        ? 'Bridge override saved. Refreshing via the configured URL.'
        : 'Bridge override cleared.';
      await renderConnectionSnapshot(snapshot);
    } catch (error) {
      bridgeOverrideStatusElement.textContent = getErrorMessage(error);
    }
  });

  clearButton?.addEventListener('click', async () => {
    if (!bridgeOverrideStatusElement) {
      return;
    }

    if (!supportsBridgeOverride()) {
      bridgeOverrideStatusElement.textContent =
        'Bridge override is not available in the current preload script. Restart npm run dev and try again.';
      return;
    }

    bridgeOverrideStatusElement.textContent = 'Clearing bridge override...';

    try {
      const snapshot = await window.dviDesktop.setBridgeOverride(null);
      bridgeOverrideStatusElement.textContent = 'Bridge override cleared.';
      await renderConnectionSnapshot(snapshot);
    } catch (error) {
      bridgeOverrideStatusElement.textContent = getErrorMessage(error);
    }
  });
}

function bindOpenPreferredUiAction(): void {
  const openPreferredUiButton = document.querySelector<HTMLButtonElement>('#open-preferred-ui');
  const connectionSummaryElement = document.querySelector<HTMLElement>('#connection-summary');

  openPreferredUiButton?.addEventListener('click', async () => {
    openPreferredUiButton.disabled = true;

    try {
      const openedUrl = await window.dviDesktop.openPreferredUi();

      if (!openedUrl && connectionSummaryElement) {
        connectionSummaryElement.textContent = 'No preferred UI URL is available yet.';
      }
    } catch (error) {
      if (connectionSummaryElement) {
        connectionSummaryElement.textContent = `UI navigation failed: ${getErrorMessage(error)}`;
      }
    } finally {
      openPreferredUiButton.disabled = false;
    }
  });
}

function supportsBridgeOverride(): boolean {
  return typeof window.dviDesktop?.setBridgeOverride === 'function';
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

function getTunnelStatus(snapshot: ConnectionSnapshot): string {
  if (snapshot.remoteTunnel) {
    return 'fetched';
  }

  if (snapshot.hasStoredToken) {
    return 'requested but unavailable';
  }

  return 'not requested';
}

function renderTextValue(value: string | null | undefined, fallback: string): string {
  return escapeHtml(value?.trim() ? value : fallback);
}

function renderDateValue(value: string | null | undefined, fallback: string): string {
  if (!value) {
    return escapeHtml(fallback);
  }

  return escapeHtml(new Date(value).toLocaleString());
}

function renderUrlValue(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) {
    return escapeHtml(fallback);
  }

  const escapedUrl = escapeHtml(value);
  return `<a href="${escapedUrl}" target="_blank" rel="noreferrer">${escapedUrl}</a>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

void renderRuntimeInfo();
void renderConnectionSnapshot();
bindRefreshAction();
bindPairingForm();
bindBridgeOverrideForm();
bindOpenPreferredUiAction();