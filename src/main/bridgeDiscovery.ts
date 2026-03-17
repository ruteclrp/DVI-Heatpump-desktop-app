import { networkInterfaces } from 'node:os';

export interface DiscoveredBridge {
  baseUrl: string;
  discoveredAt: Date;
  source: 'configured' | 'subnet-scan';
}

interface DiscoveryCandidate {
  baseUrl: string;
  source: DiscoveredBridge['source'];
}

const DEFAULT_BRIDGE_PORT = Number(process.env.DVI_BRIDGE_PORT ?? '80');
const DEFAULT_BRIDGE_PROTOCOL = process.env.DVI_BRIDGE_PROTOCOL === 'https' ? 'https' : 'http';
const DEFAULT_DISCOVERY_PATH = process.env.DVI_BRIDGE_DISCOVERY_PATH ?? '/';
const DEFAULT_DISCOVERY_TIMEOUT_MS = Number(process.env.DVI_BRIDGE_DISCOVERY_TIMEOUT_MS ?? '350');
const DEFAULT_DISCOVERY_CONCURRENCY = Number(process.env.DVI_BRIDGE_DISCOVERY_CONCURRENCY ?? '24');

export async function discoverBridge(): Promise<DiscoveredBridge | null> {
  const candidates = buildDiscoveryCandidates();

  if (candidates.length === 0) {
    return null;
  }

  const reachableBaseUrl = await findFirstReachableBaseUrl(candidates);

  if (!reachableBaseUrl) {
    return null;
  }

  return {
    ...reachableBaseUrl,
    discoveredAt: new Date(),
  };
}

function buildDiscoveryCandidates(): DiscoveryCandidate[] {
  const configuredCandidates = getConfiguredCandidates();
  const subnetCandidates = getSubnetCandidates();

  return dedupeCandidates([...configuredCandidates, ...subnetCandidates]);
}

function getConfiguredCandidates(): DiscoveryCandidate[] {
  const configuredValue = process.env.DVI_BRIDGE_URLS ?? process.env.DVI_BRIDGE_URL ?? '';

  return configuredValue
    .split(',')
    .map((value: string) => value.trim())
    .filter(Boolean)
    .map((value: string) => ({
      baseUrl: normalizeBaseUrl(value),
      source: 'configured' as const,
    }));
}

function getSubnetCandidates(): DiscoveryCandidate[] {
  const interfaces = networkInterfaces();
  const candidates: DiscoveryCandidate[] = [];

  for (const adapterName of Object.keys(interfaces)) {
    const adapterEntries = interfaces[adapterName];

    if (!adapterEntries) {
      continue;
    }

    for (const entry of adapterEntries) {
      if (entry.family !== 'IPv4' || entry.internal || !isPrivateIpv4Address(entry.address)) {
        continue;
      }

      const subnetPrefix = entry.address.split('.').slice(0, 3).join('.');

      for (let host = 1; host <= 254; host += 1) {
        candidates.push({
          baseUrl: `${DEFAULT_BRIDGE_PROTOCOL}://${subnetPrefix}.${host}:${DEFAULT_BRIDGE_PORT}`,
          source: 'subnet-scan',
        });
      }
    }
  }

  return candidates;
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

function isPrivateIpv4Address(address: string): boolean {
  if (address.startsWith('10.')) {
    return true;
  }

  if (address.startsWith('192.168.')) {
    return true;
  }

  const octets = address.split('.').map((segment) => Number(segment));

  return octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;
}

function normalizeBaseUrl(value: string): string {
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value.replace(/\/+$/, '');
  }

  return `${DEFAULT_BRIDGE_PROTOCOL}://${value.replace(/\/+$/, '')}`;
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

async function probeBridge(baseUrl: string): Promise<boolean> {
  const probeUrl = new URL(DEFAULT_DISCOVERY_PATH, `${baseUrl}/`);

  try {
    const headResponse = await fetch(probeUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(DEFAULT_DISCOVERY_TIMEOUT_MS),
    });

    if (headResponse.status < 500) {
      return true;
    }
  } catch {
    return probeWithGet(probeUrl);
  }

  return probeWithGet(probeUrl);
}

async function probeWithGet(probeUrl: URL): Promise<boolean> {
  try {
    const response = await fetch(probeUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(DEFAULT_DISCOVERY_TIMEOUT_MS),
    });

    return response.status < 500;
  } catch {
    return false;
  }
}