import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import KeyIcon from '@mui/icons-material/Key';
import PublicIcon from '@mui/icons-material/Public';
import type { WebSearchToolsConfig } from '@agentx/shared';
import { settings } from '../../api';
import { crewTheme, crewHubScanlineSx, crewOverlineSx } from '../../styles/crew-theme';

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
    accent: crewTheme.accent.signal,
    free: true,
  },
  {
    id: 'brave',
    name: 'Brave Search',
    tagline: 'High-quality SERP via Brave Search API',
    accent: crewTheme.accent.amber,
    free: false,
    keyUrl: 'https://brave.com/search/api/',
    keyPlaceholder: 'BSA…',
  },
  {
    id: 'exa',
    name: 'Exa',
    tagline: 'Neural search optimized for research agents',
    accent: crewTheme.accent.hud,
    free: false,
    keyUrl: 'https://dashboard.exa.ai/api-keys',
    keyPlaceholder: 'exa-…',
  },
  {
    id: 'tavily',
    name: 'Tavily',
    tagline: 'Agent-focused search with rich snippets',
    accent: crewTheme.accent.purple,
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
    borderRadius: '8px',
    bgcolor: crewTheme.bg.inset,
    border: `1px solid ${active ? `${accent}55` : crewTheme.border.default}`,
    p: 2.5,
    mb: 2,
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    boxShadow: active ? `0 0 0 1px ${accent}22, 0 8px 32px rgba(0,0,0,0.35)` : 'none',
    '&:hover': {
      borderColor: active ? `${accent}88` : crewTheme.border.strong,
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
      <Box sx={{
        position: 'relative',
        borderRadius: '8px',
        border: `1px solid ${crewTheme.border.default}`,
        bgcolor: crewTheme.bg.panel,
        backgroundImage: `linear-gradient(135deg, ${crewTheme.bg.elevated} 0%, ${crewTheme.bg.panel} 60%)`,
        p: 3,
        mb: 3,
        overflow: 'hidden',
      }}>
        <Box sx={crewHubScanlineSx} />
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, position: 'relative' }}>
          <Box sx={{
            width: 44, height: 44, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: `${crewTheme.accent.hud}18`, border: `1px solid ${crewTheme.accent.hud}44`,
          }}>
            <TravelExploreIcon sx={{ fontSize: 22, color: crewTheme.accent.hud }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ ...crewOverlineSx, mb: 0.75 }}>Tools · Web Search</Typography>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 600, color: crewTheme.text.primary, mb: 0.5 }}>
              Search Provider Configuration
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: crewTheme.text.secondary, lineHeight: 1.6, maxWidth: 560 }}>
              DuckDuckGo is enabled by default — free and open. Optionally bring your own API keys for Brave, Exa, or Tavily.
              Enable one, several, or none of the paid providers. Results merge and dedupe automatically.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.5 }}>
              {activeLabels.length > 0 ? activeLabels.map((label) => (
                <Chip key={label} size="small" label={label} sx={{
                  height: 22, fontSize: '0.6rem', fontFamily: "'JetBrains Mono', monospace",
                  bgcolor: `${crewTheme.accent.signal}18`, color: crewTheme.accent.signal,
                  border: `1px solid ${crewTheme.accent.signal}44`,
                }} />
              )) : (
                <Chip size="small" label="NO PROVIDERS ACTIVE" sx={{
                  height: 22, fontSize: '0.6rem', fontFamily: "'JetBrains Mono', monospace",
                  bgcolor: `${crewTheme.accent.alert}18`, color: crewTheme.accent.alert,
                  border: `1px solid ${crewTheme.accent.alert}44`,
                }} />
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      {!hasSearchProvider && (
        <Box sx={{
          mb: 2, p: 2, borderRadius: '8px',
          border: `1px dashed ${crewTheme.accent.alert}55`,
          bgcolor: `${crewTheme.accent.alert}08`,
        }}>
          <Typography sx={{ fontSize: '0.7rem', color: crewTheme.accent.alert, fontFamily: "'JetBrains Mono', monospace" }}>
            WARNING — All search providers disabled. Enable DuckDuckGo or configure a BYOK provider.
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
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography sx={{
                    fontSize: '0.82rem', fontWeight: 600, color: crewTheme.text.primary,
                    fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.5px',
                  }}>
                    {provider.name.toUpperCase()}
                  </Typography>
                  {provider.free ? (
                    <Chip label="FREE / OSS" size="small" sx={{
                      height: 18, fontSize: '0.5rem', fontWeight: 700, letterSpacing: '1px',
                      bgcolor: `${crewTheme.accent.signal}15`, color: crewTheme.accent.signal,
                      border: `1px solid ${crewTheme.accent.signal}33`,
                    }} />
                  ) : (
                    <Chip label="BYOK" size="small" sx={{
                      height: 18, fontSize: '0.5rem', fontWeight: 700, letterSpacing: '1px',
                      bgcolor: `${provider.accent}15`, color: provider.accent,
                      border: `1px solid ${provider.accent}33`,
                    }} />
                  )}
                  {ready && (
                    <Chip label="ACTIVE" size="small" sx={{
                      height: 18, fontSize: '0.5rem', fontWeight: 700,
                      bgcolor: `${crewTheme.accent.signal}22`, color: crewTheme.accent.signal,
                    }} />
                  )}
                  {needsKey && (
                    <Chip label="KEY REQUIRED" size="small" sx={{
                      height: 18, fontSize: '0.5rem', fontWeight: 700,
                      bgcolor: `${crewTheme.accent.amber}22`, color: crewTheme.accent.amber,
                    }} />
                  )}
                </Box>
                <Typography sx={{ fontSize: '0.68rem', color: crewTheme.text.dim, mb: isDdg ? 0 : 1.5 }}>
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
                              <KeyIcon sx={{ fontSize: 14, color: crewTheme.text.dim }} />
                            </InputAdornment>
                          ),
                        },
                      }}
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          bgcolor: crewTheme.bg.void,
                          '& fieldset': { borderColor: crewTheme.border.subtle },
                          '&:hover fieldset': { borderColor: crewTheme.border.default },
                          '&.Mui-focused fieldset': { borderColor: `${provider.accent}88` },
                        },
                      }}
                    />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Button
                        size="small"
                        disabled={!enabled || !apiKey.trim() || testing === provider.id}
                        onClick={() => runProviderTest(provider.id as PaidProviderId)}
                        sx={{
                          fontSize: '0.62rem', fontFamily: "'JetBrains Mono', monospace",
                          textTransform: 'uppercase', letterSpacing: '0.5px',
                          color: provider.accent, borderColor: `${provider.accent}55`,
                        }}
                        variant="outlined"
                      >
                        {testing === provider.id ? <CircularProgress size={14} /> : 'Test key'}
                      </Button>
                      {testResults[provider.id as PaidProviderId] && (
                        <Typography sx={{
                          fontSize: '0.62rem',
                          color: testResults[provider.id as PaidProviderId]!.ok
                            ? crewTheme.accent.signal
                            : crewTheme.accent.alert,
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

      <Box sx={{
        mt: 1, p: 2, borderRadius: '8px',
        border: `1px solid ${crewTheme.border.subtle}`,
        bgcolor: crewTheme.bg.inset,
      }}>
        <Typography sx={{ ...crewOverlineSx, mb: 1 }}>Agent routing</Typography>
        <Typography sx={{ fontSize: '0.68rem', color: crewTheme.text.secondary, lineHeight: 1.7 }}>
          <strong style={{ color: crewTheme.text.primary }}>deep_web_search</strong> — primary research tool (multi-query, fetch, score, rich cards).{' '}
          <strong style={{ color: crewTheme.text.primary }}>web_search</strong> — quick snippets.{' '}
          <strong style={{ color: crewTheme.text.primary }}>web_fetch / web_scrape</strong> — read a known URL.{' '}
          <strong style={{ color: crewTheme.text.primary }}>web_browse</strong> — Playwright for JS-heavy pages.
        </Typography>
      </Box>
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
