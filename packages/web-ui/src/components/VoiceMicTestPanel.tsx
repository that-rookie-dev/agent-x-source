import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { useMicrophonePermission } from '../hooks/useMicrophonePermission';
import { hasSeenMicPreprompt, markMicPrepromptSeen } from '../utils/microphone-permission';
import { VoicePermissionDialog } from './VoicePermissionDialog';
import {
  settingsBtnGhostSx,
  settingsHelperSx,
  settingsStatusBadgeSx,
  settingsTheme,
} from '../styles/settings-theme';

function permissionState(state: string): { label: string; badge: 'active' | 'idle' | 'warn' } {
  if (state === 'granted') return { label: 'MIC OK', badge: 'active' };
  if (state === 'denied') return { label: 'BLOCKED', badge: 'warn' };
  if (state === 'prompt') return { label: 'STANDBY', badge: 'idle' };
  return { label: 'UNKNOWN', badge: 'idle' };
}

interface VoiceMicTestPanelProps {
  compact?: boolean;
}

export function VoiceMicTestPanel({ compact = false }: VoiceMicTestPanelProps) {
  const mic = useMicrophonePermission();
  const [prepromptOpen, setPrepromptOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const perm = permissionState(mic.state);

  const stopTest = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setTesting(false);
    setLevel(0);
  }, []);

  useEffect(() => () => { stopTest(); }, [stopTest]);

  const runLevelMeter = useCallback(async () => {
    setError(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) sum += Math.abs(data[i]! - 128);
      setLevel(Math.min(1, sum / data.length / 64));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    setTesting(true);
  }, []);

  const handleTestMic = async () => {
    if (mic.state !== 'granted') {
      if (!hasSeenMicPreprompt()) {
        setPrepromptOpen(true);
        return;
      }
      const ok = await mic.requestAccess();
      if (!ok) return;
    }
    stopTest();
    try {
      await runLevelMeter();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone test failed');
      stopTest();
    }
  };

  const handlePrepromptContinue = async () => {
    markMicPrepromptSeen();
    setPrepromptOpen(false);
    const ok = await mic.requestAccess();
    if (ok) await handleTestMic();
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: compact ? 1 : 1.5 }}>
        <Box sx={settingsStatusBadgeSx(perm.badge)}>{perm.label}</Box>
        <Button
          size="small"
          onClick={() => { void handleTestMic(); }}
          disabled={mic.blocked && mic.state === 'denied'}
          sx={settingsBtnGhostSx}
        >
          {testing ? 'Listening…' : 'Test microphone'}
        </Button>
        {testing && (
          <Button size="small" onClick={stopTest} sx={settingsBtnGhostSx}>Stop</Button>
        )}
      </Box>

      {testing && (
        <LinearProgress
          variant="determinate"
          value={level * 100}
          sx={{
            mb: 1,
            height: 4,
            borderRadius: 1,
            bgcolor: `${settingsTheme.accent.hud}18`,
            '& .MuiLinearProgress-bar': { bgcolor: settingsTheme.accent.signal },
          }}
        />
      )}

      {testing && (
        <Typography sx={{ ...settingsHelperSx, mb: 1, color: settingsTheme.accent.signal }}>
          Speak — the bar should move with your voice.
        </Typography>
      )}

      {mic.blocked && (
        <Alert severity="warning" sx={{ mb: 1, fontSize: '0.72rem' }}>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {mic.setupInstructions.map((line) => (
              <Typography key={line} component="li" sx={settingsHelperSx}>{line}</Typography>
            ))}
          </Box>
          <Button size="small" sx={{ ...settingsBtnGhostSx, mt: 1 }} onClick={() => { void mic.openSettings(); }}>
            Open system settings
          </Button>
        </Alert>
      )}

      {error && <Alert severity="error" sx={{ fontSize: '0.72rem' }}>{error}</Alert>}

      <VoicePermissionDialog
        open={prepromptOpen}
        helpText={mic.helpText}
        setupInstructions={mic.setupInstructions}
        preprompt
        onRequest={() => { void handlePrepromptContinue(); }}
        onClose={() => setPrepromptOpen(false)}
        onOpenSettings={() => { void mic.openSettings(); }}
      />
    </Box>
  );
}
