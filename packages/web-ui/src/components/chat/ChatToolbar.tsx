import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import MicIcon from '@mui/icons-material/Mic';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import { colors, alphaColor } from '../../theme';
import { hyperdrive } from '../../styles/brands';
import { sessionSettings, models, providers, type AgentMode, type ModelInfo } from '../../api';
import { ExecutionStatusChip } from '../../chat/ExecutionStatusChip';

export interface ProviderProfile {
  id: string;
  label: string;
  providerId: string;
}

export interface ChatToolbarProps {
  hyperdriveMode: boolean;
  isCrewPrivateSession: boolean;
  agentMode: AgentMode;
  modeMenuAnchor: HTMLElement | null;
  setModeMenuAnchor: (el: HTMLElement | null) => void;
  setAgentMode: (mode: AgentMode) => void;
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
  streaming: boolean;
  turnActivity: { stage: string; step: number; elapsedMs: number } | null;
  composerMode: 'text' | 'voice';
  setComposerMode: (fn: (m: 'text' | 'voice') => 'text' | 'voice') => void;
  voiceReady: boolean;
  handleHyperdriveToggle: () => void;
  hyperdriveShimmer: boolean;
}

export function ChatToolbar(props: ChatToolbarProps) {
  const {
    hyperdriveMode, isCrewPrivateSession, agentMode,
    modeMenuAnchor, setModeMenuAnchor, setAgentMode,
    providerList, currentProvider,
    providerMenuAnchor, setProviderMenuAnchor,
    setCurrentProvider, setCurrentModel, setModelList,
    modelMenuAnchor, setModelMenuAnchor,
    currentModel, modelList, loadingModels, currentProviderId,
    setTokenTotal, setTokenReserved,
    streaming, turnActivity,
    composerMode, setComposerMode, voiceReady,
    handleHyperdriveToggle, hyperdriveShimmer,
  } = props;

  return (
    <>
      {/* Hyperdrive */}
      {!isCrewPrivateSession && (
      <Tooltip title={hyperdriveMode ? 'HYPERDRIVE ENGAGED — Full autonomous mode. All permissions bypassed.' : 'Engage Hyperdrive — full autonomous mode (no permission prompts)'} arrow>
        <Chip
          size="small"
          label={hyperdriveMode ? 'hyperdriving' : 'Hyperdrive'}
          onClick={handleHyperdriveToggle}
          sx={{
            fontSize: '0.55rem', height: 20, cursor: 'pointer',
            bgcolor: hyperdriveMode ? alphaColor(hyperdrive.magenta, '12') : colors.bg.tertiary,
            border: `1px solid ${hyperdriveMode ? alphaColor(hyperdrive.magenta, '30') : colors.border.default}`,
            borderRadius: '10px',
            color: hyperdriveMode ? hyperdrive.magenta : colors.text.secondary,
            position: 'relative', overflow: 'hidden',
            ...(hyperdriveShimmer ? {
              '&::after': {
                content: '""',
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                background: 'linear-gradient(120deg, transparent 35%, rgba(255,0,255,0.25) 45%, rgba(255,0,255,0.35) 50%, rgba(255,0,255,0.25) 55%, transparent 65%)',
                backgroundSize: '200% 100%',
                animation: 'agentx-shimmer 0.8s ease-in-out',
                borderRadius: '10px',
                pointerEvents: 'none',
              },
            } : {}),
            '&:hover': { bgcolor: hyperdriveMode ? alphaColor(hyperdrive.magenta, '20') : colors.bg.primary },
          }}
        />
      </Tooltip>
      )}

      {/* Agent Mode — hidden for crew private and while hyperdriving */}
      {!hyperdriveMode && !isCrewPrivateSession && (
      <Tooltip title={agentMode === 'agent' ? 'Agent — full access, executes tools freely' : 'Plan — outlines steps, no write access'} arrow>
        <Chip
          size="small"
          label={agentMode === 'agent' ? 'Agent' : 'Plan'}
          onClick={(e) => setModeMenuAnchor(e.currentTarget)}
          sx={{
            fontSize: '0.55rem', height: 20, cursor: 'pointer',
            bgcolor: agentMode === 'agent' ? alphaColor(colors.accent.orange, '12') : colors.bg.tertiary,
            border: `1px solid ${agentMode === 'agent' ? alphaColor(colors.accent.orange, '30') : colors.border.default}`,
            borderRadius: '10px',
            color: agentMode === 'agent' ? colors.accent.orange : colors.text.secondary,
            '&:hover': { bgcolor: agentMode === 'agent' ? alphaColor(colors.accent.orange, '20') : colors.bg.primary },
          }}
        />
      </Tooltip>
      )}

      <Menu anchorEl={modeMenuAnchor} open={Boolean(modeMenuAnchor)} onClose={() => setModeMenuAnchor(null)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, minWidth: 220 } }}>
        <MenuItem onClick={() => { setAgentMode('agent'); sessionSettings.setMode('agent').catch(() => {}); setModeMenuAnchor(null); }}
          selected={agentMode === 'agent'} sx={{ fontSize: '0.7rem', py: 0.75, borderLeft: agentMode === 'agent' ? `3px solid ${colors.accent.orange}` : '3px solid transparent' }}>
          <Box>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.accent.orange }}>Agent</Typography>
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Full access — executes tools freely</Typography>
          </Box>
        </MenuItem>
        <MenuItem onClick={() => { setAgentMode('plan'); sessionSettings.setMode('plan').catch(() => {}); setModeMenuAnchor(null); }}
          selected={agentMode === 'plan'} sx={{ fontSize: '0.7rem', py: 0.75, borderLeft: agentMode === 'plan' ? `3px solid ${colors.text.secondary}` : '3px solid transparent' }}>
          <Box>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.text.secondary }}>Plan</Typography>
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Outlines steps — no write access</Typography>
          </Box>
        </MenuItem>
      </Menu>

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
            fontSize: '0.55rem', height: 20, cursor: 'pointer',
            bgcolor: 'transparent', border: 'none',
            color: currentProvider ? colors.text.secondary : colors.text.dim,
            '&:hover': { bgcolor: colors.bg.primary },
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
              fontSize: '0.55rem', height: 20, cursor: 'pointer',
              bgcolor: 'transparent', border: 'none',
              color: currentModel ? colors.accent.blue : colors.text.dim,
              '&:hover': { bgcolor: colors.bg.primary },
          }}
        />
      </Tooltip>

      <Menu anchorEl={modelMenuAnchor} open={Boolean(modelMenuAnchor)} onClose={() => setModelMenuAnchor(null)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, minWidth: 200, maxHeight: 300 } }}>
        {loadingModels && <MenuItem disabled sx={{ fontSize: '0.65rem' }}><CircularProgress size={12} sx={{ mr: 1 }} />Loading...</MenuItem>}
        {!loadingModels && modelList.length === 0 && (
          <MenuItem disabled sx={{ fontSize: '0.65rem', color: colors.text.dim }}>
            {currentProvider ? 'No models found' : 'Select a provider first'}
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

      {/* Text / Voice composer toggle */}
      {voiceReady && (
        <Tooltip title={composerMode === 'text' ? 'Switch to voice' : 'Switch to text'} arrow>
          <Chip
            size="small"
            icon={composerMode === 'text' ? <MicIcon sx={{ fontSize: '14px !important' }} /> : <KeyboardIcon sx={{ fontSize: '14px !important' }} />}
            label={composerMode === 'text' ? 'Voice' : 'Text'}
            onClick={() => {
              setComposerMode((m) => {
                const next = m === 'text' ? 'voice' : 'text';
                if (next === 'voice') {
                  requestAnimationFrame(() => {
                    (document.activeElement as HTMLElement | null)?.blur?.();
                  });
                }
                return next;
              });
            }}
            sx={{
              fontSize: '0.55rem', height: 20, cursor: 'pointer',
              bgcolor: composerMode === 'voice' ? alphaColor(colors.accent.green, '18') : colors.bg.tertiary,
              border: `1px solid ${composerMode === 'voice' ? alphaColor(colors.accent.green, '40') : colors.border.default}`,
              borderRadius: '10px',
              color: composerMode === 'voice' ? colors.accent.green : colors.text.secondary,
              '& .MuiChip-icon': { color: 'inherit' },
              '&:hover': { bgcolor: composerMode === 'voice' ? alphaColor(colors.accent.green, '28') : colors.bg.primary },
            }}
          />
        </Tooltip>
      )}
    </>
  );
}
