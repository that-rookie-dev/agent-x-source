import { useCallback, useEffect, useRef, useState } from 'react';
import { voice, type VoiceSidecarHealth } from '../api';
import { voiceDisabledReason } from '../voice/support';

export type VoiceWarmupPhase = 'idle' | 'disabled' | 'booting' | 'ready' | 'failed';

export interface VoiceWarmupState {
  phase: VoiceWarmupPhase;
  health?: VoiceSidecarHealth;
  error: string | null;
  label: string;
  retry: () => void;
}

function warmupLabel(phase: VoiceWarmupPhase, error: string | null): string {
  switch (phase) {
    case 'disabled':
      return 'Voice off';
    case 'booting':
      return 'Voice warming…';
    case 'ready':
      return 'Voice ready';
    case 'failed':
      return error ? 'Voice offline' : 'Voice failed';
    default:
      return 'Voice standby';
  }
}

export function useVoiceWarmup(voiceEnabled: boolean, canRunWeb: boolean): VoiceWarmupState {
  const [phase, setPhase] = useState<VoiceWarmupPhase>('idle');
  const [health, setHealth] = useState<VoiceSidecarHealth | undefined>();
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef(0);

  const runWarmup = useCallback(async () => {
    const runId = ++runIdRef.current;
    if (voiceDisabledReason()) {
      setPhase('disabled');
      setError(null);
      setHealth(undefined);
      return;
    }
    if (!voiceEnabled || !canRunWeb) {
      setPhase('disabled');
      setError(null);
      setHealth(undefined);
      return;
    }

    setPhase('booting');
    setError(null);
    try {
      const result = await voice.ensureSidecar();
      if (runId !== runIdRef.current) return;
      const sidecarHealth = result.sidecar?.health;
      setHealth(sidecarHealth);
      if (result.ok !== false && result.sidecar?.state === 'ready' && sidecarHealth?.ok) {
        setPhase('ready');
        setError(null);
      } else {
        setPhase('failed');
        setError(result.error ?? 'Voice engine failed to start');
      }
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setPhase('failed');
      setError(err instanceof Error ? err.message : 'Voice engine offline');
      setHealth(undefined);
    }
  }, [voiceEnabled, canRunWeb]);

  useEffect(() => {
    void runWarmup();
  }, [runWarmup]);

  useEffect(() => {
    const onVoiceUpdated = () => { void runWarmup(); };
    window.addEventListener('agentx:voice-updated', onVoiceUpdated);
    return () => window.removeEventListener('agentx:voice-updated', onVoiceUpdated);
  }, [runWarmup]);

  return {
    phase,
    health,
    error,
    label: warmupLabel(phase, error),
    retry: () => { void runWarmup(); },
  };
}
