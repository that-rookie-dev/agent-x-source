import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors, alphaColor } from '../../theme';
import { VoiceWaveform } from './VoiceWaveform';
import { CommsEllipsis, CommsSpinner } from './CommsSpinner';
import type { CommsPhase } from './voice-comms-phase';
import { pipelineShowsLoader, type VoiceTurnPipeline } from '../../voice/voice-turn-pipeline';

export type VoiceWaveCardMode = 'idle' | 'user' | 'agent';

const WAVE_ACCENT: Record<VoiceWaveCardMode, string> = {
  idle: colors.text.dim,
  user: colors.accent.green,
  agent: colors.accent.purple,
};

export interface VoiceWaveCardProps {
  phase: CommsPhase;
  waveMode: VoiceWaveCardMode;
  waveLevel: number;
  turnPipeline?: VoiceTurnPipeline;
  standbyHint?: string;
  statusLabel?: string;
  error?: string | null;
  height?: number;
}

function phaseLabel(phase: CommsPhase, standbyHint: string): string {
  switch (phase) {
    case 'boot': return 'Warming voice engine…';
    case 'link': return 'Opening session…';
    case 'standby': return standbyHint;
    case 'operator_record': return 'Recording · release Space';
    case 'operator_stt': return 'Transcribing…';
    case 'relay_process': return 'Agent thinking…';
    case 'agent_prep': return 'Preparing audio…';
    case 'agent_tx': return 'Agent speaking';
    default: return standbyHint;
  }
}

function PhaseLoader({ phase }: { phase: CommsPhase }) {
  if (phase === 'operator_stt') {
    return <CommsEllipsis color={colors.accent.cyan} />;
  }
  if (phase === 'relay_process') {
    return <CommsSpinner color={colors.accent.orange} size={22} />;
  }
  if (phase === 'agent_prep') {
    return <CommsSpinner color={colors.accent.purple} size={22} />;
  }
  if (phase === 'boot' || phase === 'link') {
    return <CommsSpinner color={colors.text.secondary} size={22} />;
  }
  return null;
}

function resolveShowLoader(phase: CommsPhase, turnPipeline?: VoiceTurnPipeline): boolean {
  if (turnPipeline && turnPipeline !== 'idle') {
    return pipelineShowsLoader(turnPipeline);
  }
  return phase === 'boot'
    || phase === 'link'
    || phase === 'operator_stt'
    || phase === 'relay_process'
    || phase === 'agent_prep';
}

export function VoiceWaveCard({
  phase,
  waveMode,
  waveLevel,
  turnPipeline,
  standbyHint = 'Hold Space to speak',
  statusLabel,
  error,
  height = 52,
}: VoiceWaveCardProps) {
  const waveAccent = WAVE_ACCENT[waveMode];
  const showWave = waveMode !== 'idle';
  const showLoader = resolveShowLoader(phase, turnPipeline);
  const label = statusLabel ?? phaseLabel(phase, standbyHint);

  return (
    <Box sx={{
      px: 0.75,
      py: 0.5,
      borderRadius: 1,
      bgcolor: colors.bg.secondary,
      border: `1px solid ${showWave ? `${alphaColor(waveAccent, '44')}` : colors.border.default}`,
      transition: 'border-color 0.25s',
      minHeight: height,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
    }}>
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.75,
        minHeight: 26,
        position: 'relative',
      }}>
        {showLoader && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <PhaseLoader phase={phase} />
          </Box>
        )}
        {showWave && (
          <Box sx={{ width: '100%', transition: 'opacity 0.2s' }}>
            <VoiceWaveform
              level={waveLevel}
              active
              accent={waveAccent}
              height={26}
              bars={22}
            />
          </Box>
        )}
        {!showWave && !showLoader && (
          <Box sx={{ width: '100%', height: 26 }} />
        )}
      </Box>
      <Typography sx={{
        fontSize: '0.62rem',
        color: showWave ? waveAccent : colors.text.secondary,
        fontFamily: "'JetBrains Mono', monospace",
        textAlign: 'center',
        width: '100%',
        mt: 0.4,
        lineHeight: 1.35,
        transition: 'color 0.2s',
      }}>
        {label}
      </Typography>
      {error && (
        <Typography sx={{ fontSize: '0.56rem', color: colors.accent.orange, textAlign: 'center', width: '100%', mt: 0.35 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
