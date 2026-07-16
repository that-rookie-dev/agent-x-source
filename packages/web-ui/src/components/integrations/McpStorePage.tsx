import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import { settingsTheme, settingsMonoSx, settingsTextFieldSx } from '../../styles/settings-theme';
import { StoreProviderCard } from './StoreProviderCard';
import { ProviderDetailModal } from './ProviderDetailModal';
import { IntegrationAuditPanel } from './IntegrationAuditPanel';
import { StoreCardGrid, StoreSectionTitle } from './StoreLayout';
import { useIntegrationsHub } from './useIntegrationsHub';
import { CATEGORY_LABELS, CATEGORY_ORDER, isInstalledConnection, matchesProviderSearch } from './integration-ui';
import type { IntegrationProvider } from '../../api';

type StoreTab = 'browse' | 'installed' | 'activity';
type CategoryFilter = 'all' | 'connected' | (typeof CATEGORY_ORDER)[number];

function renderProviderGrid(
  providers: IntegrationProvider[],
  connectionByProvider: Map<string, import('../../api').IntegrationConnection>,
  onOpen: (p: IntegrationProvider) => void,
  onConnect: (p: IntegrationProvider) => void,
  onSignIn: (p: IntegrationProvider) => void,
) {
  return (
    <StoreCardGrid>
      {providers.map((provider) => (
        <StoreProviderCard
          key={provider.id}
          provider={provider}
          connection={connectionByProvider.get(provider.id)}
          onOpen={onOpen}
          onConnect={onConnect}
          onSignIn={onSignIn}
        />
      ))}
    </StoreCardGrid>
  );
}

export function McpStorePage() {
  const hub = useIntegrationsHub();
  const [tab, setTab] = useState<StoreTab>('browse');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [search, setSearch] = useState('');

  const filteredProviders = useMemo(() => {
    let list = hub.providers;
    if (tab === 'installed') {
      list = list.filter((p) => isInstalledConnection(hub.connectionByProvider.get(p.id)));
    } else if (category === 'connected') {
      list = list.filter((p) => isInstalledConnection(hub.connectionByProvider.get(p.id)));
    } else if (category !== 'all') {
      list = list.filter((p) => p.category === category);
    }
    if (search.trim()) {
      list = list.filter((p) => matchesProviderSearch(p, search));
    }
    return list;
  }, [hub.providers, hub.connectionByProvider, tab, category, search]);

  const connectedCount = useMemo(
    () => hub.connections.filter((c) => isInstalledConnection(c)).length,
    [hub.connections],
  );

  const groupedByCategory = useMemo(() => {
    if (tab !== 'browse' || category !== 'all' || search.trim()) return null;
    const groups = new Map<string, IntegrationProvider[]>();
    for (const provider of hub.providers) {
      const list = groups.get(provider.category) ?? [];
      list.push(provider);
      groups.set(provider.category, list);
    }
    return CATEGORY_ORDER
      .filter((cat) => groups.has(cat))
      .map((cat) => ({ category: cat, providers: groups.get(cat)! }));
  }, [hub.providers, tab, category, search]);

  const sidebarItems: Array<{ id: CategoryFilter; label: string; count: number }> = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of hub.providers) {
      counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    }
    return [
      { id: 'all', label: 'All', count: hub.providers.length },
      { id: 'connected', label: 'Installed', count: connectedCount },
      ...CATEGORY_ORDER
        .filter((cat) => counts.has(cat))
        .map((cat) => ({ id: cat, label: CATEGORY_LABELS[cat] ?? cat, count: counts.get(cat)! })),
    ];
  }, [hub.providers, connectedCount]);

  if (hub.loading) {
    return (
      <Typography sx={{ fontSize: '0.75rem', color: settingsTheme.text.dim, p: 4, ...settingsMonoSx }}>
        Loading MCP Store…
      </Typography>
    );
  }

  return (
    <Box sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      bgcolor: settingsTheme.bg.void,
    }}>
      <Box sx={{ px: 3, pt: 3, pb: 1, flexShrink: 0 }}>
        <Typography sx={{
          fontSize: { xs: '2.5rem', md: '3.25rem' },
          fontWeight: 800,
          color: settingsTheme.text.primary,
          letterSpacing: '-0.04em',
          lineHeight: 1,
        }}>
          MCP Store
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', color: settingsTheme.text.dim, mt: 1, ...settingsMonoSx }}>
          Connect services to your agent
        </Typography>
      </Box>

      <Box sx={{
        display: 'flex',
        gap: 0.5,
        px: 3,
        py: 1,
        borderBottom: `1px solid ${settingsTheme.border.default}`,
        flexShrink: 0,
        overflowX: 'auto',
      }}>
        {([
          { id: 'browse' as const, label: 'Browse' },
          { id: 'installed' as const, label: `Installed (${connectedCount})` },
          { id: 'activity' as const, label: 'Activity' },
        ]).map((item) => (
          <Button
            key={item.id}
            onClick={() => setTab(item.id)}
            sx={{
              fontSize: '0.72rem',
              textTransform: 'none',
              color: tab === item.id ? settingsTheme.text.primary : settingsTheme.text.dim,
              borderBottom: tab === item.id ? `2px solid ${settingsTheme.text.primary}` : '2px solid transparent',
              borderRadius: 0,
              px: 2,
              minHeight: 40,
              fontWeight: tab === item.id ? 700 : 400,
            }}
          >
            {item.label}
          </Button>
        ))}
      </Box>

      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {hub.message && (
          <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, px: 3, pt: 2, flexShrink: 0, ...settingsMonoSx }}>
            {hub.message}
          </Typography>
        )}

        {tab === 'activity' && (
          <Box sx={{ flex: 1, overflow: 'auto', px: 3, py: 2 }}>
            <IntegrationAuditPanel />
          </Box>
        )}

        {(tab === 'browse' || tab === 'installed') && (
          <Box sx={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            gap: 3,
            minHeight: 0,
            px: 3,
          }}>
            {tab === 'browse' && (
              <Box sx={{
                width: 168,
                flexShrink: 0,
                display: { xs: 'none', md: 'block' },
                pt: 2,
                pb: 2,
                overflowY: 'auto',
                position: 'sticky',
                top: 0,
                alignSelf: 'flex-start',
                maxHeight: '100%',
              }}>
                {sidebarItems.map((item) => {
                  const active = category === item.id;
                  return (
                    <Button
                      key={item.id}
                      onClick={() => setCategory(item.id)}
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        width: '100%',
                        fontSize: '0.72rem',
                        textTransform: 'none',
                        color: active ? settingsTheme.text.primary : settingsTheme.text.dim,
                        fontWeight: active ? 600 : 400,
                        borderRadius: '6px',
                        py: 0.85,
                        px: 1,
                        mb: 0.25,
                      }}
                    >
                      {item.label}
                      <Typography component="span" sx={{ fontSize: '0.62rem', color: settingsTheme.text.dim }}>
                        {item.count}
                      </Typography>
                    </Button>
                  );
                })}
              </Box>
            )}

            <Box sx={{ flex: 1, minWidth: 0, overflowY: 'auto', py: 2, pb: 6 }}>
              <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                <TextField
                  size="small"
                  placeholder="Search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon sx={{ fontSize: 18, color: settingsTheme.text.dim }} />
                      </InputAdornment>
                    ),
                  }}
                  sx={{ flex: 1, minWidth: 180, maxWidth: 360, ...settingsTextFieldSx }}
                />
              </Box>

              {tab === 'browse' && (
                <Box sx={{ gap: 0.75, mb: 2, overflowX: 'auto', pb: 0.5, display: { xs: 'flex', md: 'none' } }}>
                  {sidebarItems.map((item) => (
                    <Button
                      key={item.id}
                      size="small"
                      onClick={() => setCategory(item.id)}
                      sx={{
                        flexShrink: 0,
                        fontSize: '0.65rem',
                        textTransform: 'none',
                        borderRadius: '20px',
                        color: category === item.id ? settingsTheme.text.primary : settingsTheme.text.dim,
                        bgcolor: category === item.id ? settingsTheme.bg.elevated : 'transparent',
                        border: `1px solid ${category === item.id ? settingsTheme.border.strong : settingsTheme.border.subtle}`,
                      }}
                    >
                      {item.label}
                    </Button>
                  ))}
                </Box>
              )}

              {filteredProviders.length === 0 ? (
                <Typography sx={{ fontSize: '0.8rem', color: settingsTheme.text.dim, py: 6 }}>
                  {tab === 'installed' ? 'Nothing installed yet.' : 'No matches.'}
                </Typography>
              ) : groupedByCategory ? (
                groupedByCategory.map(({ category: cat, providers }) => (
                  <Box key={cat}>
                    <StoreSectionTitle
                      title={CATEGORY_LABELS[cat] ?? cat}
                      count={providers.length}
                    />
                    {renderProviderGrid(providers, hub.connectionByProvider, hub.openDetail, hub.startConnect, hub.openDetailForSignIn)}
                  </Box>
                ))
              ) : (
                <>
                  <StoreSectionTitle
                    title={
                      tab === 'installed'
                        ? 'Installed'
                        : category === 'all'
                          ? 'All'
                          : CATEGORY_LABELS[category] ?? category
                    }
                    count={filteredProviders.length}
                  />
                  {renderProviderGrid(filteredProviders, hub.connectionByProvider, hub.openDetail, hub.startConnect, hub.openDetailForSignIn)}
                </>
              )}
            </Box>
          </Box>
        )}
      </Box>

      {hub.detailProvider && (
        <ProviderDetailModal
          provider={hub.detailProvider}
          connection={hub.connectionByProvider.get(hub.detailProvider.id)}
          connecting={hub.connectingProvider?.id === hub.detailProvider.id}
          busy={hub.busyId === hub.detailProvider.id || hub.busyId === hub.connectionByProvider.get(hub.detailProvider.id)?.id}
          onClose={hub.closeDetail}
          onConnect={hub.startConnect}
          onDisconnect={hub.handleDisconnect}
          onSync={hub.handleSync}
          onConnectSubmit={hub.handleConnect}
          onOAuthStart={hub.handleOAuthStart}
          onOAuthComplete={() => { void hub.refresh(); }}
          onCancelConnect={hub.cancelConnect}
          showConnectWizard={hub.connectingProvider?.id === hub.detailProvider.id}
          autoStartSignIn={hub.signInOnOpen}
          onAutoStartSignInConsumed={hub.clearSignInOnOpen}
        />
      )}
    </Box>
  );
}
