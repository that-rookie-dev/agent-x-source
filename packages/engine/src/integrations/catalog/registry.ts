import type { IntegrationCatalogStatus, IntegrationCategory, IntegrationProvider } from '@agentx/shared';
import { SHIPPED_PROVIDERS } from './shipped.js';
import { CATALOG_CANDIDATES } from './candidates.js';
import { withProviderHighlights } from './provider-highlights.js';

export interface CatalogListOptions {
  includeCandidates?: boolean;
  includeDeprecated?: boolean;
  status?: IntegrationCatalogStatus | IntegrationCatalogStatus[];
}

function matchesStatus(provider: IntegrationProvider, options: CatalogListOptions): boolean {
  const status = provider.catalogStatus ?? 'active';
  if (status === 'deprecated' && !options.includeDeprecated) return false;
  if (options.status) {
    const allowed = Array.isArray(options.status) ? options.status : [options.status];
    return allowed.includes(status);
  }
  if (status === 'candidate' && !options.includeCandidates) return false;
  return true;
}

/** Full catalog: shipped + candidates (+ remote overrides applied in loader). */
export const INTEGRATION_CATALOG: IntegrationProvider[] = [
  ...SHIPPED_PROVIDERS,
  ...CATALOG_CANDIDATES,
];

export function listCatalogProviders(options: CatalogListOptions = {}): IntegrationProvider[] {
  return INTEGRATION_CATALOG
    .filter((provider) => matchesStatus(provider, options))
    .map(withProviderHighlights);
}

export function getCatalogProvider(id: string): IntegrationProvider | undefined {
  return INTEGRATION_CATALOG.find((provider) => provider.id === id);
}

export function listIntegrationCategories(): IntegrationCategory[] {
  return [...new Set(listCatalogProviders({ includeCandidates: true }).map((provider) => provider.category))];
}

export function getCatalogStats(): Record<IntegrationCatalogStatus, number> {
  const stats: Record<IntegrationCatalogStatus, number> = {
    active: 0,
    candidate: 0,
    testing: 0,
    deprecated: 0,
  };
  for (const provider of INTEGRATION_CATALOG) {
    const status = provider.catalogStatus ?? 'active';
    stats[status] += 1;
  }
  return stats;
}

/** @deprecated Use listCatalogProviders */
export const INTEGRATION_PROVIDERS = listCatalogProviders({ includeCandidates: false });

export function getIntegrationProvider(id: string): IntegrationProvider | undefined {
  return getCatalogProvider(id);
}

export function listIntegrationProviders(): IntegrationProvider[] {
  return listCatalogProviders({ includeCandidates: false });
}
