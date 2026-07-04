export {
  INTEGRATION_CATALOG,
  INTEGRATION_PROVIDERS,
  getCatalogProvider,
  getCatalogStats,
  listCatalogProviders,
  listIntegrationCategories,
} from './registry.js';
export {
  loadRemoteCatalog,
  loadIntegrationHubSettings,
  saveIntegrationHubSettings,
  getIntegrationHubSettings,
  listAllProviders,
  getProviderById,
  isProviderAllowed,
  fetchRemoteCatalog,
  refreshRemoteCatalogFromUrl,
} from './loader.js';

import { getProviderById, listAllProviders } from './loader.js';

export function getIntegrationProvider(id: string) {
  return getProviderById(id);
}

export function listIntegrationProviders() {
  return listAllProviders();
}
