import './styles.css';
import type { ConnectionSnapshot } from '@shared/connection';
import type { AppRuntimeInfo, DviDesktopApi } from '@shared/runtime';

declare global {
  interface Window {
    dviDesktop: DviDesktopApi;
  }
}

const runtimeInfoPromise = window.dviDesktop.getRuntimeInfo();

async function renderRuntimeInfo(): Promise<void> {
  const runtimeElement = document.querySelector<HTMLElement>('#runtime-info');

  if (!runtimeElement) {
    return;
  }

  const runtimeInfo = await runtimeInfoPromise;
  runtimeElement.textContent = `Version: ${runtimeInfo.version}`;
}

async function renderConnectionSnapshot(snapshot?: ConnectionSnapshot): Promise<void> {
  const connectionInfoElement = document.querySelector<HTMLDListElement>('#connection-info');
  const connectionSummaryElement = document.querySelector<HTMLElement>('#connection-summary');
  const bridgeOverrideInput = document.querySelector<HTMLInputElement>('#bridge-override-url');
  const clearStoredConnectionStatusElement = document.querySelector<HTMLElement>('#clear-stored-connection-status');
  const openPreferredUiButton = document.querySelector<HTMLButtonElement>('#open-preferred-ui');

  if (!connectionInfoElement || !connectionSummaryElement) {
    return;
  }

  const connectionSnapshot = snapshot ?? (await window.dviDesktop.getConnectionSnapshot());
  const runtimeInfo = await runtimeInfoPromise;
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

  if (clearStoredConnectionStatusElement && !clearStoredConnectionStatusElement.dataset.pending) {
    clearStoredConnectionStatusElement.textContent = '';
  }

  connectionInfoElement.innerHTML = `
    <div><dt>Transport</dt><dd>${escapeHtml(connectionSnapshot.activeTransport)}</dd></div>
    <div><dt>Token stored</dt><dd>${connectionSnapshot.hasStoredToken ? 'yes' : 'no'}</dd></div>
    <div><dt>Bridge override</dt><dd>${renderTextValue(connectionSnapshot.bridgeOverrideUrl, 'not set')}</dd></div>
    <div><dt>Local bridge</dt><dd>${renderUrlValue(connectionSnapshot.localBridge?.baseUrl, 'not found')}</dd></div>
    <div><dt>Bridge source</dt><dd>${escapeHtml(connectionSnapshot.localBridge?.source ?? 'n/a')}</dd></div>
    <div><dt>Tunnel status</dt><dd>${escapeHtml(tunnelStatus)}</dd></div>
    <div><dt>Tunnel fetched</dt><dd>${renderDateValue(connectionSnapshot.remoteTunnel?.fetchedAt, 'not fetched', runtimeInfo)}</dd></div>
    <div><dt>Tunnel URL</dt><dd>${renderUrlValue(connectionSnapshot.remoteTunnel?.tunnelUrl, 'not available')}</dd></div>
    <div><dt>Preferred UI URL</dt><dd>${renderUrlValue(connectionSnapshot.preferredUiUrl, 'offline')}</dd></div>
    <div><dt>Updated</dt><dd>${renderDateValue(connectionSnapshot.lastUpdatedAt, 'n/a', runtimeInfo)}</dd></div>
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

function bindClearStoredConnectionStateAction(): void {
  const clearButton = document.querySelector<HTMLButtonElement>('#clear-stored-connection-state');
  const statusElement = document.querySelector<HTMLElement>('#clear-stored-connection-status');

  clearButton?.addEventListener('click', async () => {
    if (!statusElement) {
      return;
    }

    if (!supportsStoredConnectionReset()) {
      statusElement.textContent =
        'Stored connection reset is not available in the current preload script. Restart npm run dev and try again.';
      return;
    }

    clearButton.disabled = true;
    statusElement.dataset.pending = 'true';
    statusElement.textContent = 'Clearing stored token and cached tunnel...';

    try {
      const snapshot = await window.dviDesktop.clearStoredConnectionState();
      statusElement.textContent = 'Stored token and cached tunnel cleared. Use Refresh to trigger auto-sync again.';
      await renderConnectionSnapshot(snapshot);
    } catch (error) {
      statusElement.textContent = getErrorMessage(error);
    } finally {
      delete statusElement.dataset.pending;
      clearButton.disabled = false;
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

function supportsStoredConnectionReset(): boolean {
  return typeof window.dviDesktop?.clearStoredConnectionState === 'function';
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

function renderDateValue(value: string | null | undefined, fallback: string, runtimeInfo: AppRuntimeInfo): string {
  if (!value) {
    return escapeHtml(fallback);
  }

  return escapeHtml(formatMachineDateTime(new Date(value), runtimeInfo));
}

function formatMachineDateTime(value: Date, runtimeInfo: AppRuntimeInfo): string {
  const { locale, shortDatePattern, shortTimePattern } = runtimeInfo.dateTimeFormat;

  if (!shortDatePattern && !shortTimePattern) {
    return new Intl.DateTimeFormat(locale || undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(value);
  }

  const parts = [
    shortDatePattern ? formatMachinePattern(value, shortDatePattern, locale) : '',
    shortTimePattern ? formatMachinePattern(value, shortTimePattern, locale) : '',
  ].filter(Boolean);

  return parts.join(' ');
}

function formatMachinePattern(value: Date, pattern: string, locale: string): string {
  const tokenPattern = /yyyy|yy|y|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|tt|'[^']*'/g;

  return pattern.replace(tokenPattern, (token) => formatPatternToken(value, token, locale));
}

function formatPatternToken(value: Date, token: string, locale: string): string {
  if (token.startsWith("'")) {
    return token.slice(1, -1);
  }

  switch (token) {
    case 'd':
      return String(value.getDate());
    case 'dd':
      return String(value.getDate()).padStart(2, '0');
    case 'ddd':
      return formatLocalePart(value, locale, { weekday: 'short' });
    case 'dddd':
      return formatLocalePart(value, locale, { weekday: 'long' });
    case 'M':
      return String(value.getMonth() + 1);
    case 'MM':
      return String(value.getMonth() + 1).padStart(2, '0');
    case 'MMM':
      return formatLocalePart(value, locale, { month: 'short' });
    case 'MMMM':
      return formatLocalePart(value, locale, { month: 'long' });
    case 'y':
      return String(value.getFullYear());
    case 'yy':
      return String(value.getFullYear()).slice(-2).padStart(2, '0');
    case 'yyyy':
      return String(value.getFullYear()).padStart(4, '0');
    case 'H':
      return String(value.getHours());
    case 'HH':
      return String(value.getHours()).padStart(2, '0');
    case 'h': {
      const hours = value.getHours() % 12 || 12;
      return String(hours);
    }
    case 'hh': {
      const hours = value.getHours() % 12 || 12;
      return String(hours).padStart(2, '0');
    }
    case 'm':
      return String(value.getMinutes());
    case 'mm':
      return String(value.getMinutes()).padStart(2, '0');
    case 's':
      return String(value.getSeconds());
    case 'ss':
      return String(value.getSeconds()).padStart(2, '0');
    case 'tt':
      return value.getHours() >= 12 ? 'PM' : 'AM';
    default:
      return token;
  }
}

function formatLocalePart(
  value: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale || undefined, options).format(value);
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
bindBridgeOverrideForm();
bindClearStoredConnectionStateAction();
bindOpenPreferredUiAction();