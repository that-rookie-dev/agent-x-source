import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import { colors, alphaColor } from '../../theme';
import { models, providers, type ModelInfo } from '../../api';
import { ExecutionStatusChip } from '../../chat/ExecutionStatusChip';
import { BypassPermissionsToggle } from './BypassPermissionsToggle';
import { useChatMessagesContext, useChatTurnControlContext } from './ChatSessionProvider';

export interface ProviderProfile {
  id: string;
  label: string;
  providerId: string;
}

export interface ChatToolbarProps {
  isCrewPrivateSession: boolean;
  bypassPermissions: boolean;
  toggleBypassPermissions: () => void;
  revokeSessionPermissions: () => void;
  providerList: ProviderProfile[];
  currentProvider: string;
  providerMenuAnchor: HTMLElement | null;
  setProviderMenuAnchor: (el: HTMLElement | null) => void;
  setCurrentProvider: (id: string) => void;
  setCurrentModel: (id: string) => void;
  setModelList: (list: ModelInfo[]) => void;
  modelMenuAnchor: HTMLElement | null;
  setModelMenuAnchor: (el: HTMLElement | null) => void;
  currentModel: string;
  modelList: ModelInfo[];
  loadingModels: boolean;
  currentProviderId: string;
  setTokenTotal: (n: number) => void;
  setTokenReserved: (n: number) => void;
}

export function ChatToolbar(props: ChatToolbarProps) {
  const {
    isCrewPrivateSession, bypassPermissions, toggleBypassPermissions, revokeSessionPermissions,
    providerList, currentProvider,
    providerMenuAnchor, setProviderMenuAnchor,
    setCurrentProvider, setCurrentModel, setModelList,
    modelMenuAnchor, setModelMenuAnchor,
    currentModel, modelList, loadingModels, currentProviderId,
    setTokenTotal, setTokenReserved,
  } = props;
  // Subscribe here (not in ChatInputArea) so stream chunks don't re-render the composer.
  const { streaming } = useChatTurnControlContext();
  const { turnActivity } = useChatMessagesContext();

  return (
    <>
      {/* Bypass permissions & revoke controls */}
      {!isCrewPrivateSession && (
        <>
          <BypassPermissionsToggle enabled={bypassPermissions} onToggle={toggleBypassPermissions} />
          <Tooltip title="Clear all session-level Allow Always / Deny overrides and turn Bypass off" arrow>
            <Chip
              size="small"
              label="Revoke all permissions"
              onClick={revokeSessionPermissions}
              sx={{
                fontSize: '0.55rem', height: 20, cursor: 'pointer',
                bgcolor: colors.bg.tertiary,
                border: `1px solid ${colors.border.default}`,
                borderRadius: '10px',
                color: colors.text.secondary,
                '&:hover': { bgcolor: colors.bg.primary },
                '& .MuiChip-label': { px: 1 },
              }}
            />
          </Tooltip>
        </>
      )}

      {/* Provider Profile */}
      <Tooltip title="Provider Profile" arrow>
        <Chip
          size="small"
          label={(() => {
            const p = providerList.find(pr => pr.id === currentProvider);
            const raw = p?.label || currentProvider || 'Provider';
            return typeof raw === 'string' ? raw : String((raw as { label?: unknown })?.label ?? 'Provider');
          })()}
          onClick={(e) => setProviderMenuAnchor(e.currentTarget)}
          sx={{
            fontSize: '0.55rem',
            height: 20,
            cursor: 'pointer',
            bgcolor: colors.bg.tertiary,
            border: `1px solid ${colors.border.default}`,
            borderRadius: '10px',
            color: currentProvider ? colors.text.secondary : colors.text.dim,
            '&:hover': { bgcolor: colors.bg.primary },
            '& .MuiChip-label': { px: 1 },
          }}
        />
      </Tooltip>

      <Menu anchorEl={providerMenuAnchor} open={Boolean(providerMenuAnchor)} onClose={() => setProviderMenuAnchor(null)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, minWidth: 200 } }}>
        {providerList.filter(Boolean).map((profile) => (
          <MenuItem key={profile.id} onClick={() => {
            setCurrentProvider(profile.id);
            setCurrentModel('');
            setModelList([]);
            providers.switchProfile(profile.providerId, profile.id).catch(() => {});
            setProviderMenuAnchor(null);
          }} selected={profile.id === currentProvider} sx={{ fontSize: '0.7rem' }}>
            <Box>
              <Typography sx={{ fontSize: '0.7rem' }}>{profile.label}</Typography>
              <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>{profile.providerId}</Typography>
            </Box>
          </MenuItem>
        ))}
        {providerList.length === 0 && (
          <MenuItem disabled sx={{ fontSize: '0.65rem', color: colors.text.dim }}>No providers configured</MenuItem>
        )}
      </Menu>

      {/* Model */}
      <Tooltip title="Model" arrow>
        <Chip
          size="small"
          label={currentModel || 'Model'}
          onClick={(e) => setModelMenuAnchor(e.currentTarget)}
          sx={{
            fontSize: '0.55rem',
            height: 20,
            cursor: 'pointer',
            bgcolor: colors.bg.tertiary,
            border: `1px solid ${currentModel ? alphaColor(colors.accent.blue, '40') : colors.border.default}`,
            borderRadius: '10px',
            color: currentModel ? colors.accent.blue : colors.text.dim,
            '&:hover': { bgcolor: colors.bg.primary },
            '& .MuiChip-label': { px: 1 },
          }}
        />
      </Tooltip>

      <Menu anchorEl={modelMenuAnchor} open={Boolean(modelMenuAnchor)} onClose={() => setModelMenuAnchor(null)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, minWidth: 200, maxHeight: 300 } }}>
        {loadingModels && <MenuItem disabled sx={{ fontSize: '0.65rem' }}><CircularProgress size={12} sx={{ mr: 1 }} />Loading...</MenuItem>}
        {!loadingModels && modelList.length === 0 && (
          <MenuItem disabled sx={{ fontSize: '0.65rem', color: colors.text.dim }}>
            {currentProvider
              ? 'No cleared models — run a benchmark in Providers'
              : 'Select a provider first'}
          </MenuItem>
        )}
        {modelList.filter(Boolean).map((m) => {
            const caps = m.capabilities ?? [];
            const hasFC = caps.includes('function_calling');
            const hasVision = caps.includes('vision');
            const hasReasoning = caps.includes('reasoning');
            const hasJson = caps.includes('json_mode');
            return (
            <MenuItem key={m.id} onClick={() => {
              setCurrentModel(m.id);
              if (m.contextWindow) {
                setTokenTotal(m.contextWindow);
                const reserved = Math.min(20000, Math.round(m.contextWindow * 0.15));
                setTokenReserved(reserved);
              }
              const profile = providerList.find(p => p.id === currentProvider);
              const providerId = profile?.providerId || currentProviderId || currentProvider;
              if (m.providerId && m.providerId !== providerId) {
                setCurrentProvider(m.providerId);
                providers.switch(m.providerId).then(() => {
                  models.switch(m.id, { contextWindow: m.contextWindow, providerId: m.providerId }).catch(() => {});
                }).catch(() => {});
              } else {
                models.switch(m.id, { contextWindow: m.contextWindow, providerId }).catch(() => {});
              }
              setModelMenuAnchor(null);
            }} selected={m.id === currentModel} sx={{ fontSize: '0.65rem' }}>
              <Box sx={{ width: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography sx={{ fontSize: '0.65rem', fontWeight: m.id === currentModel ? 600 : 400 }}>{m.name || m.id}</Typography>
                  {hasFC && <Typography sx={{ fontSize: '0.45rem', color: colors.accent.blue, bgcolor: alphaColor(colors.accent.blue, '18'), px: 0.4, py: 0.05, borderRadius: 0.5, fontWeight: 600 }}>FC</Typography>}
                  {hasVision && <Typography sx={{ fontSize: '0.45rem', color: colors.accent.green, bgcolor: alphaColor(colors.accent.green, '18'), px: 0.4, py: 0.05, borderRadius: 0.5, fontWeight: 600 }}>V</Typography>}
                  {hasReasoning && <Typography sx={{ fontSize: '0.45rem', color: colors.accent.purple, bgcolor: alphaColor(colors.accent.purple, '18'), px: 0.4, py: 0.05, borderRadius: 0.5, fontWeight: 600 }}>R</Typography>}
                  {hasJson && <Typography sx={{ fontSize: '0.45rem', color: colors.accent.cyan, bgcolor: alphaColor(colors.accent.cyan, '18'), px: 0.4, py: 0.05, borderRadius: 0.5, fontWeight: 600 }}>JSON</Typography>}
                </Box>
                {m.contextWindow && <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>{(m.contextWindow / 1000).toFixed(0)}k context</Typography>}
              </Box>
            </MenuItem>
            );
          })}
      </Menu>

      {/* Spacer */}
      <Box sx={{ flex: 1 }} />

      {streaming && (
        <ExecutionStatusChip
          stage={turnActivity?.stage}
          step={turnActivity?.step}
          elapsedMs={turnActivity?.elapsedMs}
        />
      )}
    </>
  );
}
