import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IntegrationHubSettings, IntegrationProvider } from '@agentx/shared';
import { getDataDir, getLogger } from '@agentx/shared';
import { getCatalogProvider, listCatalogProviders } from './registry.js';
import { enrichCatalogProviders } from './setup-wizard.js';
import { withProviderHighlights } from './provider-highlights.js';

const logger = getLogger();

let remoteProviders: IntegrationProvider[] = [];
let settings: IntegrationHubSettings = {
  healthPollingEnabled: true,
  healthPollIntervalMs: 5 * 60 * 1000,
};

export function loadRemoteCatalog(baseDir?: string): IntegrationProvider[] {
  const filePath = join(baseDir ?? getDataDir(), 'integrations', 'catalog.json');
  if (!existsSync(filePath)) {
    remoteProviders = [];
    return remoteProviders;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as { providers?: IntegrationProvider[] };
    remoteProviders = Array.isArray(parsed.providers) ? parsed.providers : [];
    return remoteProviders;
  } catch (error) {
    logger.error('INTEGRATION_CATALOG_LOAD_FAILED', error instanceof Error ? error.message : String(error));
    remoteProviders = [];
    return remoteProviders;
  }
}

export async function fetchRemoteCatalog(url: string): Promise<IntegrationProvider[]> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Remote catalog fetch failed (${response.status}): ${response.statusText}`);
  }
  const parsed = await response.json() as { providers?: IntegrationProvider[] };
  if (!Array.isArray(parsed.providers)) {
    throw new Error('Remote catalog must be a JSON object with a "providers" array.');
  }
  return parsed.providers;
}

export async function refreshRemoteCatalogFromUrl(url: string, baseDir?: string): Promise<IntegrationProvider[]> {
  const providers = await fetchRemoteCatalog(url);
  const dir = join(baseDir ?? getDataDir(), 'integrations');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'catalog.json'), JSON.stringify({ providers, fetchedAt: new Date().toISOString() }, null, 2), 'utf-8');
  remoteProviders = providers;
  logger.info('INTEGRATION_CATALOG_REFRESHED', `Loaded ${providers.length} provider(s) from ${url}`);
  return providers;
}

export function loadIntegrationHubSettings(baseDir?: string): IntegrationHubSettings {
  const filePath = join(baseDir ?? getDataDir(), 'integrations', 'settings.json');
  if (!existsSync(filePath)) return settings;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as IntegrationHubSettings;
    settings = { ...settings, ...parsed };
    return settings;
  } catch (error) {
    logger.error('INTEGRATION_SETTINGS_LOAD_FAILED', error instanceof Error ? error.message : String(error));
    return settings;
  }
}

export function getIntegrationHubSettings(): IntegrationHubSettings {
  return settings;
}

export function saveIntegrationHubSettings(next: IntegrationHubSettings, baseDir?: string): IntegrationHubSettings {
  const dir = join(baseDir ?? getDataDir(), 'integrations');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  settings = { ...settings, ...next };
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8');
  return settings;
}

export function listAllProviders(options?: { includeCandidates?: boolean }): IntegrationProvider[] {
  const includeCandidates = options?.includeCandidates ?? true;
  const byId = new Map<string, IntegrationProvider>();
  for (const provider of listCatalogProviders({ includeCandidates })) {
    byId.set(provider.id, provider);
  }
  return enrichCatalogProviders([...byId.values()]);
}

export function getProviderById(id: string): IntegrationProvider | undefined {
  const remote = remoteProviders.find((provider) => provider.id === id);
  const provider = remote ?? getCatalogProvider(id);
  if (!provider) return undefined;
  return enrichCatalogProviders([withProviderHighlights(provider)])[0];
}

export function isProviderAllowed(_providerId: string): boolean {
  return true;
}
