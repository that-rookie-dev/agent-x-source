import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Link from '@mui/material/Link';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PublicIcon from '@mui/icons-material/Public';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import type { WebSearchProviderId, WebSearchToolsConfig } from '@agentx/shared';
import { settings } from '../../api';
import { hasConfiguredSecret, isRedactedSecret } from '../../utils/secret-field';
import {
  settingsTheme,
  settingsScanlineSx,
  settingsMonoSx,
  settingsTextFieldSx,
  settingsBtnGhostSx,
  settingsStatusBadgeSx,
  settingsHelperSx,
  settingsCardSx,
  settingsOverlineSx,
} from '../../styles/settings-theme';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import { SettingsCard } from './SettingsCard';

import { alphaColor } from '../../theme';
export interface WebSearchToolsTabProps {
  value: WebSearchToolsConfig;
  onChange: (next: WebSearchToolsConfig) => void;
}

type PaidProviderId = 'brave' | 'exa' | 'tavily';

const DEFAULT_PROVIDER_ORDER: WebSearchProviderId[] = ['duckduckgo', 'brave', 'exa', 'tavily'];

function normalizeProviderOrder(order?: WebSearchProviderId[] | null): WebSearchProviderId[] {
  const out: WebSearchProviderId[] = [];
  const seen = new Set<WebSearchProviderId>();
  for (const id of order ?? []) {
    if (!DEFAULT_PROVIDER_ORDER.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of DEFAULT_PROVIDER_ORDER) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

interface ProviderMeta {
  id: PaidProviderId | 'duckduckgo';
  name: string;
  tagline: string;
  accent: string;
  free: boolean;
  keyUrl?: string;
  keyPlaceholder?: string;
  instructions: string[];
}

const SEARCH_PROVIDERS: ProviderMeta[] = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    tagline: 'Open HTML search — no API key',
    accent: settingsTheme.accent.signal,
    free: true,
    instructions: [
      'Turn on the switch — no account or API key required.',
      'Best for quick lookups and privacy-friendly search.',
    ],
  },
  {
    id: 'brave',
    name: 'Brave Search',
    tagline: 'High-quality SERP via Brave Search API',
    accent: settingsTheme.accent.amber,
    free: false,
    keyUrl: 'https://brave.com/search/api/',
    keyPlaceholder: 'BSA…',
    instructions: [
      'Create a Brave Search API key from the dashboard.',
      'Paste the key once, then use Test key to verify.',
    ],
  },
  {
    id: 'exa',
    name: 'Exa',
    tagline: 'Neural search for research agents',
    accent: settingsTheme.accent.hud,
    free: false,
    keyUrl: 'https://dashboard.exa.ai/api-keys',
    keyPlaceholder: 'exa-…',
    instructions: [
      'Sign in to Exa and create an API key.',
      'Enable the provider and test the connection.',
    ],
  },
  {
    id: 'tavily',
    name: 'Tavily',
    tagline: 'Agent-focused search with rich snippets',
    accent: settingsTheme.accent.purple,
    free: false,
    keyUrl: 'https://app.tavily.com/home',
    keyPlaceholder: 'tvly-…',
    instructions: [
      'Create a Tavily API key from your account home.',
      'Enable and test before relying on deep web search.',
    ],
  },
];

function isProviderActive(id: ProviderMeta['id'], cfg: WebSearchToolsConfig): boolean {
  if (id === 'duckduckgo') return cfg.duckduckgo?.enabled !== false;
  const entry = cfg[id];
  return Boolean(entry?.enabled && hasConfiguredSecret(entry.apiKey));
}

function providerStatus(id: ProviderMeta['id'], cfg: WebSearchToolsConfig, enabled: boolean): string {
  if (!enabled) return 'OFF';
  if (id === 'duckduckgo') return 'READY';
  const entry = cfg[id as PaidProviderId];
  if (hasConfiguredSecret(entry?.apiKey)) return 'READY';
  if (entry?.apiKey && isRedactedSecret(entry.apiKey)) return 'READY';
  return 'SETUP';
}

function SearchPriorityCard({
  value,
  onChange,
}: {
  value: WebSearchToolsConfig;
  onChange: (next: WebSearchToolsConfig) => void;
}) {
  const order = useMemo(() => normalizeProviderOrder(value.providerOrder), [value.providerOrder]);
  const metaById = useMemo(
    () => Object.fromEntries(SEARCH_PROVIDERS.map((p) => [p.id, p])) as Record<WebSearchProviderId, ProviderMeta>,
    [],
  );
  const activeIds = order.filter((id) => isProviderActive(id, value));
  const inactiveIds = order.filter((id) => !isProviderActive(id, value));
  const [dragId, setDragId] = useState<WebSearchProviderId | null>(null);
  const [overId, setOverId] = useState<WebSearchProviderId | null>(null);

  const commitOrder = (nextActive: WebSearchProviderId[]) => {
    onChange({
      ...value,
      providerOrder: normalizeProviderOrder([...nextActive, ...inactiveIds]),
    });
  };

  const move = (fromId: WebSearchProviderId, toId: WebSearchProviderId) => {
    if (fromId === toId) return;
    const next = [...activeIds];
    const from = next.indexOf(fromId);
    const to = next.indexOf(toId);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, fromId);
    commitOrder(next);
  };

  return (
    <SettingsCard
      title="Search priority"
      subtitle="Drag ready tools to set try-order. The agent falls through if a tool returns little or no data."
      accent={settingsTheme.accent.hud}
      active={activeIds.length > 0}
      sx={{ mb: 1.5 }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {activeIds.map((id, index) => {
          const meta = metaById[id];
          const isDragging = dragId === id;
          const isOver = overId === id && dragId !== id;
          return (
            <Box
              key={id}
              draggable
              onDragStart={(e) => {
                setDragId(id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (overId !== id) setOverId(id);
              }}
              onDragLeave={() => {
                if (overId === id) setOverId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = (e.dataTransfer.getData('text/plain') || dragId) as WebSearchProviderId | null;
                if (from) move(from, id);
                setDragId(null);
                setOverId(null);
              }}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1,
                py: 0.65,
                borderRadius: '8px',
                cursor: 'grab',
                userSelect: 'none',
                border: `1px solid ${isOver ? meta.accent : alphaColor(meta.accent, '35')}`,
                bgcolor: isDragging
                  ? alphaColor(meta.accent, '18')
                  : isOver
                    ? alphaColor(meta.accent, '12')
                    : alphaColor(meta.accent, '06'),
                opacity: isDragging ? 0.55 : 1,
                transform: isOver ? 'translateY(1px) scale(1.01)' : 'none',
                transition: 'border-color 120ms ease, background-color 120ms ease, transform 120ms ease, opacity 120ms ease',
                '&:active': { cursor: 'grabbing' },
              }}
            >
              <Box
                sx={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  bgcolor: alphaColor(meta.accent, '22'),
                  border: `1px solid ${alphaColor(meta.accent, '55')}`,
                  color: meta.accent,
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  ...settingsMonoSx,
                }}
              >
                {index + 1}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: settingsTheme.text.primary, lineHeight: 1.2 }}>
                  {meta.name}
                </Typography>
                <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.text.dim, ...settingsMonoSx, letterSpacing: '0.4px' }}>
                  {meta.free ? 'FREE · READY' : 'BYOK · READY'}
                  {index === 0 ? ' · FIRST PICK' : ''}
                </Typography>
              </Box>
              <DragIndicatorIcon sx={{ fontSize: 16, color: alphaColor(meta.accent, '90'), opacity: 0.85 }} />
            </Box>
          );
        })}

        {activeIds.length === 0 && (
          <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.accent.alert, py: 0.5, ...settingsMonoSx }}>
            Enable a provider below to start ranking.
          </Typography>
        )}

        {inactiveIds.length > 0 && (
          <>
            <Typography sx={{ ...settingsOverlineSx, mt: activeIds.length ? 0.75 : 0, mb: 0.25, letterSpacing: '1.5px' }}>
              Waiting · not in rotation
            </Typography>
            {inactiveIds.map((id) => {
              const meta = metaById[id];
              return (
                <Box
                  key={id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1,
                    py: 0.55,
                    borderRadius: '8px',
                    border: `1px dashed ${settingsTheme.border.subtle}`,
                    bgcolor: alphaColor(settingsTheme.text.dim, '06'),
                    opacity: 0.72,
                  }}
                >
                  <Box
                    sx={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      border: `1px dashed ${settingsTheme.border.default}`,
                      color: settingsTheme.text.dim,
                      fontSize: '0.55rem',
                      ...settingsMonoSx,
                    }}
                  >
                    —
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.7rem', color: settingsTheme.text.secondary, lineHeight: 1.2 }}>
                      {meta.name}
                    </Typography>
                    <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
                      {meta.free ? 'OFF' : 'NEEDS KEY / OFF'}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </>
        )}
      </Box>
    </SettingsCard>
  );
}

function SearchProviderCard({
  meta,
  value,
  onChange,
  testing,
  testResult,
  onTest,
}: {
  meta: ProviderMeta;
  value: WebSearchToolsConfig;
  onChange: (next: WebSearchToolsConfig) => void;
  testing: boolean;
  testResult?: { ok: boolean; message: string };
  onTest: () => void;
}) {
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [editingKey, setEditingKey] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const isDdg = meta.id === 'duckduckgo';
  const enabled = isDdg
    ? value.duckduckgo?.enabled !== false
    : Boolean(value[meta.id as PaidProviderId]?.enabled);
  const storedKey = isDdg ? '' : (value[meta.id as PaidProviderId]?.apiKey ?? '');
  const keyConfigured = isDdg || hasConfiguredSecret(storedKey) || isRedactedSecret(storedKey);
  const status = providerStatus(meta.id, value, enabled);
  const ready = isProviderActive(meta.id, value);

  const setEnabled = (checked: boolean) => {
    if (isDdg) {
      onChange({ ...value, duckduckgo: { enabled: checked } });
      return;
    }
    onChange({
      ...value,
      [meta.id]: { ...value[meta.id as PaidProviderId], enabled: checked },
    });
  };

  const saveDraftKey = () => {
    if (isDdg) return;
    onChange({
      ...value,
      [meta.id]: {
        ...value[meta.id as PaidProviderId],
        enabled: true,
        apiKey: draftKey.trim(),
      },
    });
    setEditingKey(false);
    setDraftKey('');
  };

  const resetKey = () => {
    if (isDdg) return;
    setEditingKey(true);
    setDraftKey('');
    onChange({
      ...value,
      [meta.id]: { ...value[meta.id as PaidProviderId], enabled: false, apiKey: '' },
    });
  };

  const headerRow = (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: settingsTheme.text.primary }}>
          {meta.name}
        </Typography>
        <Typography sx={{
          fontSize: '0.55rem',
          color: ready ? settingsTheme.accent.signal : settingsTheme.text.dim,
          ...settingsMonoSx,
          letterSpacing: '0.08em',
        }}>
          {status}
        </Typography>
        {meta.free && <Box sx={settingsStatusBadgeSx('active')}>FREE</Box>}
        {ready && !meta.free && <Box sx={settingsStatusBadgeSx('active')}>ACTIVE</Box>}
      </Box>
      <Switch
        size="small"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
        sx={{
          '& .MuiSwitch-switchBase.Mui-checked': { color: meta.accent },
          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: meta.accent },
        }}
      />
    </Box>
  );

  if (!enabled) {
    return (
      <Box sx={{ ...settingsCardSx(meta.accent, false), mb: 1, py: 1, px: 1.25 }}>
        {headerRow}
        <Typography sx={{ ...settingsHelperSx, mt: 0.5 }}>{meta.tagline}</Typography>
      </Box>
    );
  }

  return (
    <SettingsCard title={meta.name} subtitle={meta.tagline} accent={meta.accent} active={ready} sx={{ mb: 1.5 }}>
      <Box sx={{ mb: 1 }}>{headerRow}</Box>

      <Box
        onClick={() => setInstructionsOpen((open) => !open)}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', py: 0.5, userSelect: 'none' }}
      >
        <ExpandMoreIcon sx={{
          fontSize: 16,
          color: settingsTheme.text.dim,
          transform: instructionsOpen ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s',
        }} />
        <Typography sx={{ ...settingsOverlineSx, mb: 0 }}>Setup instructions</Typography>
      </Box>
      <Collapse in={instructionsOpen}>
        <Box sx={{ mb: 1, pl: 0.5 }}>
          {meta.instructions.map((line, index) => (
            <Typography key={line} sx={{ ...settingsHelperSx, fontSize: '0.62rem', mb: 0.35 }}>
              {index + 1}. {line}
            </Typography>
          ))}
          {!isDdg && meta.keyUrl && (
            <Link href={meta.keyUrl} target="_blank" rel="noopener noreferrer"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 0.5, fontSize: '0.62rem', color: meta.accent }}>
              <PublicIcon sx={{ fontSize: 12 }} />
              Get API key →
            </Link>
          )}
        </Box>
      </Collapse>

      {!isDdg && (
        <Box sx={{ mt: 0.5 }}>
          {keyConfigured && !editingKey ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
              <Box sx={settingsStatusBadgeSx('active')}>KEY CONFIGURED</Box>
              <Button size="small" onClick={resetKey} sx={settingsBtnGhostSx}>Reset key</Button>
              <Button
                size="small"
                disabled={testing}
                onClick={onTest}
                sx={{ ...settingsBtnGhostSx, borderColor: `${alphaColor(meta.accent, '55')}`, color: meta.accent }}
                variant="outlined"
              >
                {testing ? <CircularProgress size={14} /> : 'Test key'}
              </Button>
              {testResult && (
                <Typography sx={{
                  fontSize: '0.62rem',
                  color: testResult.ok ? settingsTheme.accent.signal : settingsTheme.accent.alert,
                  ...settingsMonoSx,
                }}>
                  {testResult.message}
                </Typography>
              )}
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 480 }}>
              <TextField
                fullWidth
                size="small"
                type="password"
                label="API key"
                placeholder={meta.keyPlaceholder}
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                sx={settingsTextFieldSx}
                autoFocus={editingKey}
              />
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  size="small"
                  disabled={!draftKey.trim()}
                  onClick={saveDraftKey}
                  sx={{ ...settingsBtnGhostSx, borderColor: `${alphaColor(meta.accent, '55')}`, color: meta.accent }}
                  variant="outlined"
                >
                  Save key
                </Button>
                {editingKey && keyConfigured && (
                  <Button size="small" onClick={() => { setEditingKey(false); setDraftKey(''); }} sx={settingsBtnGhostSx}>
                    Cancel
                  </Button>
                )}
              </Box>
            </Box>
          )}
        </Box>
      )}
    </SettingsCard>
  );
}

export function WebSearchToolsTab({ value, onChange }: WebSearchToolsTabProps) {
  const [testing, setTesting] = useState<PaidProviderId | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<PaidProviderId, { ok: boolean; message: string }>>>({});

  const activeLabels = SEARCH_PROVIDERS.filter((p) => isProviderActive(p.id, value)).map((p) => p.name);
  const hasSearchProvider = SEARCH_PROVIDERS.some((p) => isProviderActive(p.id, value));

  const runProviderTest = async (id: PaidProviderId) => {
    const rawKey = value[id]?.apiKey?.trim() ?? '';
    const useStored = !rawKey || isRedactedSecret(rawKey);
    if (!useStored && !rawKey) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, message: 'Save an API key first' } }));
      return;
    }
    setTesting(id);
    try {
      const result = await settings.webSearch.test(id, useStored ? undefined : rawKey);
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

  return (
    <Box>
      <SettingsSectionHeader
        icon={<TravelExploreIcon sx={{ fontSize: 16 }} />}
        title="Web Search"
        subtitle={activeLabels.length > 0 ? `Active: ${activeLabels.join(', ')}` : 'No search providers active'}
      />

      {!hasSearchProvider && (
        <Box sx={{
          mb: 1.5, p: 1.5, borderRadius: '6px',
          border: `1px dashed ${alphaColor(settingsTheme.accent.alert, '55')}`,
          bgcolor: `${alphaColor(settingsTheme.accent.alert, '08')}`,
        }}>
          <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.accent.alert, ...settingsMonoSx }}>
            No search providers active. Enable DuckDuckGo or configure a paid provider below.
          </Typography>
        </Box>
      )}

      <SearchPriorityCard value={value} onChange={onChange} />

      <Box sx={{ position: 'relative' }}>
        <Box sx={settingsScanlineSx} />
        <Box sx={{ position: 'relative', zIndex: 1 }}>
          {SEARCH_PROVIDERS.map((meta) => (
            <SearchProviderCard
              key={meta.id}
              meta={meta}
              value={value}
              onChange={onChange}
              testing={testing === meta.id}
              testResult={meta.id !== 'duckduckgo' ? testResults[meta.id as PaidProviderId] : undefined}
              onTest={() => { void runProviderTest(meta.id as PaidProviderId); }}
            />
          ))}
        </Box>
      </Box>

      <SettingsCard title="Agent routing">
        <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.secondary, lineHeight: 1.7, ...settingsMonoSx }}>
          <Box component="span" sx={{ color: settingsTheme.text.primary, fontWeight: 600 }}>deep_web_search</Box> — primary research.{' '}
          <Box component="span" sx={{ color: settingsTheme.text.primary, fontWeight: 600 }}>web_search</Box> — quick snippets.{' '}
          <Box component="span" sx={{ color: settingsTheme.text.primary, fontWeight: 600 }}>web_fetch / web_scrape</Box> — read a URL.{' '}
          <Box component="span" sx={{ color: settingsTheme.text.primary, fontWeight: 600 }}>web_browse</Box> — JS-heavy pages.
          {' '}Search tools follow the priority order above.
        </Typography>
      </SettingsCard>

      <Typography sx={{ ...settingsHelperSx, mt: 1 }}>
        Changes save automatically. Enable a provider and follow the setup steps below.
      </Typography>
    </Box>
  );
}

export function defaultWebSearchConfig(): WebSearchToolsConfig {
  return {
    duckduckgo: { enabled: true },
    brave: { enabled: false, apiKey: '' },
    exa: { enabled: false, apiKey: '' },
    tavily: { enabled: false, apiKey: '' },
    providerOrder: [...DEFAULT_PROVIDER_ORDER],
  };
}

export function mergeWebSearchConfig(existing?: WebSearchToolsConfig | null): WebSearchToolsConfig {
  const defaults = defaultWebSearchConfig();
  return {
    duckduckgo: { enabled: existing?.duckduckgo?.enabled ?? defaults.duckduckgo!.enabled },
    brave: { ...defaults.brave!, ...existing?.brave },
    exa: { ...defaults.exa!, ...existing?.exa },
    tavily: { ...defaults.tavily!, ...existing?.tavily },
    providerOrder: normalizeProviderOrder(existing?.providerOrder ?? defaults.providerOrder),
  };
}
