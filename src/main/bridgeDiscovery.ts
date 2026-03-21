import * as BonjourService from 'bonjour-service';
import type { Service } from 'bonjour-service';

export interface DiscoveredBridge {
  baseUrl: string;
  discoveredAt: Date;
  source: 'configured' | 'manual' | 'mdns';
}

interface DiscoveryCandidate {
  baseUrl: string;
  source: DiscoveredBridge['source'];
}

interface DiscoveryOptions {
  configuredBridgeUrls?: string[];
}

const DEFAULT_BRIDGE_PORT = Number(process.env.DVI_BRIDGE_PORT ?? '5000');
const DEFAULT_BRIDGE_PROTOCOL = process.env.DVI_BRIDGE_PROTOCOL === 'https' ? 'https' : 'http';
const DEFAULT_DISCOVERY_PATH = process.env.DVI_BRIDGE_DISCOVERY_PATH ?? '/api/pump_type';
const DEFAULT_DISCOVERY_TIMEOUT_MS = Number(process.env.DVI_BRIDGE_DISCOVERY_TIMEOUT_MS ?? '350');
const DEFAULT_DISCOVERY_CONCURRENCY = Number(process.env.DVI_BRIDGE_DISCOVERY_CONCURRENCY ?? '24');
const DEFAULT_DISCOVERY_WINDOW_MS = Number(process.env.DVI_BRIDGE_DISCOVERY_WINDOW_MS ?? '10000');
const DEFAULT_DISCOVERY_PATHS = [DEFAULT_DISCOVERY_PATH, '/api/pump_type'];
const DEFAULT_MDNS_SERVICE_TYPE = process.env.DVI_BRIDGE_MDNS_SERVICE_TYPE ?? 'dvi-bridge';
const BonjourConstructor = getBonjourConstructor();

export async function discoverBridge(options: DiscoveryOptions = {}): Promise<DiscoveredBridge | null> {
  const configuredCandidates = dedupeCandidates(getConfiguredCandidates(options.configuredBridgeUrls ?? []));
  const configuredBridge = await findPreferredReachableBaseUrl(configuredCandidates);

  if (configuredBridge) {
    return {
      ...configuredBridge,
      discoveredAt: new Date(),
    };
  }

  const mdnsCandidates = dedupeCandidates(await getMdnsCandidates());

  if (mdnsCandidates.length === 0) {
    return null;
  }

  return {
    ...mdnsCandidates[0],
    discoveredAt: new Date(),
  };
}

function getConfiguredCandidates(configuredBridgeUrls: string[]): DiscoveryCandidate[] {
  const manualCandidates = configuredBridgeUrls
    .map((value: string) => value.trim())
    .filter(Boolean)
    .map((value: string) => ({
      baseUrl: normalizeBridgeBaseUrl(value),
      source: 'manual' as const,
    }));

  const configuredValue = process.env.DVI_BRIDGE_URLS ?? process.env.DVI_BRIDGE_URL ?? '';
  const envCandidates = configuredValue
    .split(',')
    .map((value: string) => value.trim())
    .filter(Boolean)
    .map((value: string) => ({
      baseUrl: normalizeBridgeBaseUrl(value),
      source: 'configured' as const,
    }));

  return [...manualCandidates, ...envCandidates];
}

function dedupeCandidates(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    if (seen.has(candidate.baseUrl)) {
      return false;
    }

    seen.add(candidate.baseUrl);
    return true;
  });
}

export function normalizeBridgeBaseUrl(value: string): string {
  const trimmedValue = value.trim().replace(/\/+$/, '');

  if (trimmedValue.startsWith('http://') || trimmedValue.startsWith('https://')) {
    return trimmedValue;
  }

  if (isLocalBridgeHost(trimmedValue)) {
    const withPort = hasExplicitPort(trimmedValue) ? trimmedValue : `${trimmedValue}:${DEFAULT_BRIDGE_PORT}`;
    return `http://${withPort}`;
  }

  return `https://${trimmedValue}`;
}

async function findFirstReachableBaseUrl(
  candidates: DiscoveryCandidate[],
): Promise<DiscoveryCandidate | null> {
  const queue = [...candidates];
  const workerCount = Math.max(1, Math.min(DEFAULT_DISCOVERY_CONCURRENCY, queue.length));
  let resolvedCandidate: DiscoveryCandidate | null = null;

  async function worker(): Promise<void> {
    while (queue.length > 0 && resolvedCandidate === null) {
      const candidate = queue.shift();

      if (!candidate) {
        return;
      }

      if (await probeBridge(candidate.baseUrl)) {
        resolvedCandidate = candidate;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return resolvedCandidate;
}

async function findPreferredReachableBaseUrl(
  candidates: DiscoveryCandidate[],
): Promise<DiscoveryCandidate | null> {
  const sourcePriority: Array<DiscoveryCandidate['source']> = ['manual', 'configured'];

  for (const source of sourcePriority) {
    const sourceCandidates = candidates.filter((candidate) => candidate.source === source);

    if (sourceCandidates.length === 0) {
      continue;
    }

    const reachableCandidate = await findFirstReachableBaseUrl(sourceCandidates);

    if (reachableCandidate) {
      return reachableCandidate;
    }
  }

  return null;
}

async function getMdnsCandidates(): Promise<DiscoveryCandidate[]> {
  const services = await discoverMdnsServices();

  return services.flatMap((service) => buildMdnsCandidates(service));
}

async function discoverMdnsServices(): Promise<Service[]> {
  const bonjour = new BonjourConstructor();
  const discoveredServices = new Map<string, Service>();
  const browser = bonjour.find({
    protocol: 'tcp',
    type: DEFAULT_MDNS_SERVICE_TYPE,
  });

  const rememberService = (service: Service): void => {
    discoveredServices.set(service.fqdn ?? `${service.name}:${service.port}`, service);
  };

  browser.on('up', rememberService);
  browser.on('txt-update', rememberService);

  try {
    await wait(DEFAULT_DISCOVERY_WINDOW_MS);
  } finally {
    browser.stop();
    bonjour.destroy();
  }

  return [...discoveredServices.values()];
}

function buildMdnsCandidates(service: Service): DiscoveryCandidate[] {
  const port = service.port > 0 ? service.port : DEFAULT_BRIDGE_PORT;
  const txtHostname = getTxtValue(service, 'hostname');
  const candidateHosts = dedupeTextValues([
    normalizeMdnsHost(txtHostname),
    ...getIpv4Addresses(service),
    normalizeMdnsHost(service.host),
  ]);

  return candidateHosts.map((host) => ({
    baseUrl: `${DEFAULT_BRIDGE_PROTOCOL}://${host}:${port}`,
    source: 'mdns',
  }));
}

function getTxtValue(service: Service, key: string): string | null {
  const value = service.txt?.[key];

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeMdnsHost(value: string | undefined | null): string | null {
  if (!value?.trim()) {
    return null;
  }

  const host = value.trim().replace(/\.$/, '');

  if (isIpv4Address(host)) {
    return host;
  }

  if (host.endsWith('.local') || host.includes('.')) {
    return host;
  }

  return `${host}.local`;
}

function getIpv4Addresses(service: Service): string[] {
  return (service.addresses ?? []).filter((address) => isIpv4Address(address));
}

function isIpv4Address(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

function dedupeTextValues(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const dedupedValues: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    dedupedValues.push(value);
  }

  return dedupedValues;
}

function isLocalBridgeHost(value: string): boolean {
  const host = value.split('/')[0].split(':')[0];

  if (host.endsWith('.local')) {
    return true;
  }

  if (/^pump-\d+-owner$/i.test(host)) {
    return true;
  }

  return isIpv4Address(host);
}

function hasExplicitPort(value: string): boolean {
  const lastColonIndex = value.lastIndexOf(':');

  if (lastColonIndex === -1) {
    return false;
  }

  return /^\d+$/.test(value.slice(lastColonIndex + 1));
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function getBonjourConstructor(): new () => {
  destroy(callback?: () => void): void;
  find(
    options: { protocol: 'tcp' | 'udp'; type: string },
  ): {
    on(event: 'up' | 'txt-update', listener: (service: Service) => void): void;
    stop(): void;
  };
} {
  const constructorCandidate =
    typeof BonjourService.Bonjour === 'function'
      ? BonjourService.Bonjour
      : typeof BonjourService.default === 'function'
        ? BonjourService.default
        : null;

  if (!constructorCandidate) {
    throw new Error('Bonjour service module did not expose a constructor.');
  }

  return constructorCandidate as new () => {
    destroy(callback?: () => void): void;
    find(
      options: { protocol: 'tcp' | 'udp'; type: string },
    ): {
      on(event: 'up' | 'txt-update', listener: (service: Service) => void): void;
      stop(): void;
    };
  };
}

async function probeBridge(baseUrl: string): Promise<boolean> {
  for (const path of getDiscoveryProbePaths()) {
    const probeUrl = new URL(path, `${baseUrl}/`);

    if (await probeBridgeEndpoint(probeUrl)) {
      return true;
    }
  }

  return false;
}

async function probeBridgeEndpoint(probeUrl: URL): Promise<boolean> {
  try {
    const response = await fetch(probeUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(DEFAULT_DISCOVERY_TIMEOUT_MS),
    });

    if (!response.ok) {
      return false;
    }

    if (probeUrl.pathname === '/api/pump_type') {
      const payload = (await response.json()) as { pump_type?: unknown };
      return typeof payload.pump_type === 'string' && payload.pump_type.trim().length > 0;
    }

    return true;
  } catch {
    return false;
  }
}

function getDiscoveryProbePaths(): string[] {
  const configuredPaths = [process.env.DVI_BRIDGE_DISCOVERY_PATHS]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .flatMap((value) => value.split(','))
    .map((value) => normalizeDiscoveryPath(value))
    .filter((value, index, values) => values.indexOf(value) === index);

  return [...configuredPaths, ...DEFAULT_DISCOVERY_PATHS].filter(
    (value, index, values) => values.indexOf(value) === index,
  );
}

function normalizeDiscoveryPath(path: string): string {
  const trimmedPath = path.trim();

  if (!trimmedPath) {
    return '/api/pump_type';
  }

  return trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;
}