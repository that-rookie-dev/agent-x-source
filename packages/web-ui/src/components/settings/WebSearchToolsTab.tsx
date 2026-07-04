import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import KeyIcon from '@mui/icons-material/Key';
import PublicIcon from '@mui/icons-material/Public';
import type { WebSearchToolsConfig } from '@agentx/shared';
import { settings } from '../../api';
import {
  settingsTheme,
  settingsScanlineSx,
  settingsMonoSx,
  settingsTextFieldSx,
  settingsBtnGhostSx,
  settingsStatusBadgeSx,
} from '../../styles/settings-theme';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import { SettingsCard } from './SettingsCard';

export interface WebSearchToolsTabProps {
  value: WebSearchToolsConfig;
  onChange: (next: WebSearchToolsConfig) => void;
}

type PaidProviderId = 'brave' | 'exa' | 'tavily';

interface ProviderMeta {
  id: PaidProviderId | 'duckduckgo';
  name: string;
  tagline: string;
  accent: string;
  free: boolean;
  keyUrl?: string;
  keyPlaceholder?: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    tagline: 'Open-source HTML search — no API key required',
    accent: settingsTheme.accent.signal,
    free: true,
  },
  {
    id: 'brave',
    name: 'Brave Search',
    tagline: 'High-quality SERP via Brave Search API',
    accent: settingsTheme.accent.amber,
    free: false,
    keyUrl: 'https://brave.com/search/api/',
    keyPlaceholder: 'BSA…',
  },
  {
    id: 'exa',
    name: 'Exa',
    tagline: 'Neural search optimized for research agents',
    accent: settingsTheme.accent.hud,
    free: false,
    keyUrl: 'https://dashboard.exa.ai/api-keys',
    keyPlaceholder: 'exa-…',
  },
  {
    id: 'tavily',
    name: 'Tavily',
    tagline: 'Agent-focused search with rich snippets',
    accent: settingsTheme.accent.purple,
    free: false,
    keyUrl: 'https://app.tavily.com/home',
    keyPlaceholder: 'tvly-…',
  },
];

function isProviderActive(id: ProviderMeta['id'], cfg: WebSearchToolsConfig): boolean {
  if (id === 'duckduckgo') return cfg.duckduckgo?.enabled !== false;
  const p = cfg[id];
  return Boolean(p?.enabled && p.apiKey?.trim());
}

function activeProviderLabels(cfg: WebSearchToolsConfig): string[] {
  return PROVIDERS.filter((p) => isProviderActive(p.id, cfg)).map((p) => p.name);
}

function providerCardSx(accent: string, active: boolean) {
  return {
    position: 'relative' as const,
    borderRadius: '6px',
    bgcolor: settingsTheme.bg.inset,
    border: `1px solid ${active ? `${accent}55` : settingsTheme.border.default}`,
    p: 2,
    mb: 1.5,
    overflow: 'hidden',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    boxShadow: active ? `0 0 0 1px ${accent}18` : 'none',
    '&:hover': {
      borderColor: active ? `${accent}88` : settingsTheme.border.hud,
    },
  };
}

export function WebSearchToolsTab({ value, onChange }: WebSearchToolsTabProps) {
  const activeLabels = activeProviderLabels(value);
  const hasSearchProvider = PROVIDERS.some((p) => isProviderActive(p.id, value));
  const [testing, setTesting] = useState<PaidProviderId | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<PaidProviderId, { ok: boolean; message: string }>>>({});

  const runProviderTest = async (id: PaidProviderId) => {
    const apiKey = value[id]?.apiKey?.trim() ?? '';
    if (!apiKey) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, message: 'Enter an API key first' } }));
      return;
    }
    setTesting(id);
    try {
      const result = await settings.webSearch.test(id, apiKey);
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          ok: result.ok,
          message: result.ok
            ? `Connected (${result.latencyMs ?? 0}ms)`
            : (result.error ?? 'Connection failed'),
        },
      }));
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, message: 'Test request failed' } }));
    } finally {
      setTesting(null);
    }
  };

  const setDuckDuckGo = (enabled: boolean) => {
    onChange({ ...value, duckduckgo: { enabled } });
  };

  const setPaid = (id: PaidProviderId, patch: { enabled?: boolean; apiKey?: string }) => {
    onChange({
      ...value,
      [id]: { ...value[id], ...patch },
    });
  };

  return (
    <Box>
      <SettingsSectionHeader
        icon={<TravelExploreIcon sx={{ fontSize: 16 }} />}
        title="Web Search"
        subtitle={activeLabels.length > 0 ? `Active: ${activeLabels.join(', ')}` : 'No providers active'}
      />

      {!hasSearchProvider && (
        <Box sx={{
          mb: 1.5, p: 1.5, borderRadius: '6px',
          border: `1px dashed ${settingsTheme.accent.alert}55`,
          bgcolor: `${settingsTheme.accent.alert}08`,
        }}>
          <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.accent.alert, ...settingsMonoSx }}>
            All search providers disabled. Enable DuckDuckGo or configure a paid provider.
          </Typography>
        </Box>
      )}

      {PROVIDERS.map((provider) => {
        const isDdg = provider.id === 'duckduckgo';
        const enabled = isDdg
          ? value.duckduckgo?.enabled !== false
          : Boolean(value[provider.id]?.enabled);
        const apiKey = isDdg ? '' : (value[provider.id as PaidProviderId]?.apiKey ?? '');
        const ready = isProviderActive(provider.id, value);
        const needsKey = !isDdg && enabled && !apiKey.trim();

        return (
          <Box key={provider.id} sx={providerCardSx(provider.accent, ready)}>
            <Box sx={settingsScanlineSx} />
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, position: 'relative', zIndex: 1 }}>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, flexWrap: 'wrap' }}>
                  <Typography sx={{ ...settingsMonoSx, fontSize: '0.72rem', fontWeight: 700, color: settingsTheme.text.primary }}>
                    {provider.name}
                  </Typography>
                  {provider.free ? (
                    <Box sx={settingsStatusBadgeSx('active')}>FREE</Box>
                  ) : (
                    <Box sx={{ ...settingsStatusBadgeSx('idle'), color: provider.accent, borderColor: `${provider.accent}44` }}>BYOK</Box>
                  )}
                  {ready && <Box sx={settingsStatusBadgeSx('active')}>ACTIVE</Box>}
                  {needsKey && <Box sx={settingsStatusBadgeSx('warn')}>KEY REQUIRED</Box>}
                </Box>
                <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.dim, mb: isDdg ? 0 : 1.25, ...settingsMonoSx }}>
                  {provider.tagline}
                </Typography>
                {!isDdg && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, maxWidth: 480 }}>
                    <TextField
                      fullWidth
                      size="small"
                      type="password"
                      disabled={!enabled}
                      placeholder={provider.keyPlaceholder}
                      value={apiKey}
                      onChange={(e) => setPaid(provider.id as PaidProviderId, { apiKey: e.target.value })}
                      slotProps={{
                        input: {
                          sx: { fontSize: '0.75rem', fontFamily: "'JetBrains Mono', monospace" },
                          startAdornment: (
                            <InputAdornment position="start">
                              <KeyIcon sx={{ fontSize: 14, color: settingsTheme.text.dim }} />
                            </InputAdornment>
                          ),
                        },
                      }}
                      sx={settingsTextFieldSx}
                    />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Button
                        size="small"
                        disabled={!enabled || !apiKey.trim() || testing === provider.id}
                        onClick={() => runProviderTest(provider.id as PaidProviderId)}
                        sx={{ ...settingsBtnGhostSx, borderColor: `${provider.accent}55`, color: provider.accent }}
                        variant="outlined"
                      >
                        {testing === provider.id ? <CircularProgress size={14} /> : 'Test key'}
                      </Button>
                      {testResults[provider.id as PaidProviderId] && (
                        <Typography sx={{
                          fontSize: '0.62rem',
                          color: testResults[provider.id as PaidProviderId]!.ok
                            ? settingsTheme.accent.signal
                            : settingsTheme.accent.alert,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>
                          {testResults[provider.id as PaidProviderId]!.message}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                )}
                {!isDdg && provider.keyUrl && (
                  <Link href={provider.keyUrl} target="_blank" rel="noopener noreferrer"
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 1, fontSize: '0.62rem', color: provider.accent }}>
                    <PublicIcon sx={{ fontSize: 12 }} />
                    Get API key →
                  </Link>
                )}
              </Box>
              <Switch
                checked={enabled}
                onChange={(e) => {
                  if (isDdg) setDuckDuckGo(e.target.checked);
                  else setPaid(provider.id as PaidProviderId, { enabled: e.target.checked });
                }}
                sx={{
                  '& .MuiSwitch-switchBase.Mui-checked': { color: provider.accent },
                  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: `${provider.accent}66` },
                }}
              />
            </Box>
          </Box>
        );
      })}

      <SettingsCard title="Agent Routing">
        <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.secondary, lineHeight: 1.7, ...settingsMonoSx }}>
          <Box component="span" sx={{ color: settingsTheme.text.primary, fontWeight: 600 }}>deep_web_search</Box> — primary research tool.{' '}
          <Box component="span" sx={{ color: settingsTheme.text.primary, fontWeight: 600 }}>web_search</Box> — quick snippets.{' '}
          <Box component="span" sx={{ color: settingsTheme.text.primary, fontWeight: 600 }}>web_fetch / web_scrape</Box> — read a URL.{' '}
          <Box component="span" sx={{ color: settingsTheme.text.primary, fontWeight: 600 }}>web_browse</Box> — Playwright for JS-heavy pages.
        </Typography>
      </SettingsCard>
    </Box>
  );
}

export function defaultWebSearchConfig(): WebSearchToolsConfig {
  return {
    duckduckgo: { enabled: true },
    brave: { enabled: false, apiKey: '' },
    exa: { enabled: false, apiKey: '' },
    tavily: { enabled: false, apiKey: '' },
  };
}

export function mergeWebSearchConfig(existing?: WebSearchToolsConfig | null): WebSearchToolsConfig {
  const defaults = defaultWebSearchConfig();
  return {
    duckduckgo: { enabled: existing?.duckduckgo?.enabled ?? defaults.duckduckgo!.enabled },
    brave: { ...defaults.brave!, ...existing?.brave },
    exa: { ...defaults.exa!, ...existing?.exa },
    tavily: { ...defaults.tavily!, ...existing?.tavily },
  };
}
