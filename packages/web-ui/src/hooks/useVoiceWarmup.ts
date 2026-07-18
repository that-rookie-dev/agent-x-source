import { useCallback, useEffect, useRef, useState } from 'react';
import { voice, type VoiceSidecarHealth } from '../api';
import { isVoiceWarmupSupported } from '@agentx/shared/browser';
import { mergeVoiceConfig } from '../voice/voice-config';
import { voiceDisabledReason } from '../voice/support';

export type VoiceWarmupPhase = 'idle' | 'disabled' | 'booting' | 'ready' | 'failed';

export interface VoiceWarmupState {
  phase: VoiceWarmupPhase;
  health?: VoiceSidecarHealth;
  error: string | null;
  label: string;
  /** True when Settings → Voice → keep engine running at launch is on. */
  engineWarmAtLaunch: boolean;
  /** Force-start the voice engine (chat voice panel, retry). */
  ensureWarmup: () => void;
  /** Schedule or perform sidecar release (on-demand mode only). */
  releaseSidecar: () => void;
  retry: () => void;
}

function warmupLabel(phase: VoiceWarmupPhase, error: string | null): string {
  switch (phase) {
    case 'disabled':
      return 'Voice off';
    case 'booting':
      return 'Voice warming…';
    case 'ready':
      return 'Ready';
    case 'failed':
      return error ? 'Voice offline' : 'Voice failed';
    default:
      return 'Voice standby';
  }
}

const STATUS_POLL_MS = 20_000;
const BOOTING_POLL_MS = 2_000;
const BOOTING_TIMEOUT_MS = 6 * 60_000;

/** Sidecar process is up and STT/TTS models are loaded. */
function isSidecarFullyReady(state: string, health?: VoiceSidecarHealth): boolean {
  if (state !== 'ready') return false;
  if (health?.ok === false) return false;
  if (!health?.models?.sttLoaded) return false;
  if (!health?.models?.ttsLoaded) return false;
  return true;
}

export function useVoiceWarmup(voiceEnabled: boolean, canRunWeb: boolean): VoiceWarmupState {
  const [phase, setPhase] = useState<VoiceWarmupPhase>('idle');
  const [health, setHealth] = useState<VoiceSidecarHealth | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [engineWarmAtLaunch, setEngineWarmAtLaunch] = useState(false);
  const autoStartRef = useRef(false);
  const warmupAllowedRef = useRef(false);
  const engineXaiRef = useRef(false);
  const xaiConfiguredRef = useRef(false);
  const warmupInFlightRef = useRef<Promise<void> | null>(null);
  const releaseEpochRef = useRef(0);
  const bootingStartedAtRef = useRef<number | null>(null);
  const runWarmupRef = useRef<(force?: boolean) => Promise<void> | undefined>(async () => {});
  /** Tracks whether this is the first warmup attempt on app launch.
   * On first load we always force-start the engine so it becomes visible/active,
   * even if "keep engine running at launch" (autoStart) is disabled. */
  const initialLoadRef = useRef(true);

  const applyReady = useCallback((sidecarHealth?: VoiceSidecarHealth) => {
    bootingStartedAtRef.current = null;
    setHealth(sidecarHealth);
    setPhase('ready');
    setError(null);
  }, []);

  const applyFailed = useCallback((message: string) => {
    bootingStartedAtRef.current = null;
    setPhase('failed');
    setError(message);
    setHealth(undefined);
  }, []);

  const probeSidecarStatus = useCallback(async (): Promise<boolean> => {
    if (engineXaiRef.current) {
      if (xaiConfiguredRef.current) {
        applyReady();
        return true;
      }
      return false;
    }
    const result = await voice.sidecarStatus();
    const sidecar = result.sidecar;
    const sidecarHealth = 'health' in sidecar ? sidecar.health : undefined;
    if (isSidecarFullyReady(sidecar.state, sidecarHealth)) {
      applyReady(sidecarHealth);
      return true;
    }
    return false;
  }, [applyReady]);

  const runWarmup = useCallback(async (force = false) => {
    if (voiceDisabledReason()) {
      bootingStartedAtRef.current = null;
      setPhase('disabled');
      setError(null);
      setHealth(undefined);
      return;
    }
    if (!voiceEnabled || !canRunWeb) {
      bootingStartedAtRef.current = null;
      setPhase('disabled');
      setError(null);
      setHealth(undefined);
      return;
    }

    if (engineXaiRef.current) {
      bootingStartedAtRef.current = null;
      if (xaiConfiguredRef.current) {
        applyReady();
      } else {
        applyFailed('xAI API key is missing');
      }
      return;
    }

    if (!force && !autoStartRef.current) {
      // On initial app load, force-start the engine once so it becomes
      // visible/active even when "keep engine running at launch" is off.
      // The autoStart setting controls whether the engine *stays* running
      // (via releaseSidecar), not whether it starts initially.
      if (initialLoadRef.current) {
        initialLoadRef.current = false;
        // Fall through to the warmup logic below instead of returning.
      } else {
        setError(null);
        try {
          const ready = await probeSidecarStatus();
          if (!ready) {
            setPhase((current) => (current === 'booting' ? current : 'idle'));
            setHealth(undefined);
          }
        } catch {
          setPhase((current) => (current === 'booting' ? current : 'idle'));
          setHealth(undefined);
        }
        return;
      }
    }

    if (warmupInFlightRef.current) {
      return warmupInFlightRef.current;
    }

    const epoch = releaseEpochRef.current;
    setPhase((current) => (current === 'ready' ? current : 'booting'));
    setError(null);
    bootingStartedAtRef.current = Date.now();

    const promise = (async () => {
      try {
        const result = await voice.ensureSidecar();
        if (epoch !== releaseEpochRef.current) return;

        const sidecarHealth = result.sidecar?.health;
        if (
          result.ok !== false
          && result.sidecar?.state === 'ready'
          && isSidecarFullyReady(result.sidecar.state, sidecarHealth)
        ) {
          applyReady(sidecarHealth);
          return;
        }

        applyFailed(result.error ?? 'Voice engine failed to start');
      } catch (err) {
        if (epoch !== releaseEpochRef.current) return;
        const message = err instanceof Error ? err.message : 'Voice engine offline';
        applyFailed(message);
      }
    })();

    warmupInFlightRef.current = promise.finally(() => {
      if (warmupInFlightRef.current === promise) {
        warmupInFlightRef.current = null;
      }
    });

    return warmupInFlightRef.current;
  }, [voiceEnabled, canRunWeb, applyReady, applyFailed, probeSidecarStatus]);

  runWarmupRef.current = runWarmup;

  const syncWarmupConfig = useCallback(() => {
    if (!voiceEnabled || !canRunWeb) {
      autoStartRef.current = false;
      warmupAllowedRef.current = false;
      engineXaiRef.current = false;
      xaiConfiguredRef.current = false;
      setEngineWarmAtLaunch(false);
      setPhase('disabled');
      setHealth(undefined);
      setError(null);
      void voice.releaseSidecar();
      return;
    }
    void Promise.all([
      voice.getConfig(),
      fetch('/api/system/capabilities').then((r) => r.json()).catch(() => null),
    ])
      .then(([cfg, caps]) => {
        const merged = mergeVoiceConfig(cfg);
        const isXai = merged.engine === 'realtime_xai';
        engineXaiRef.current = isXai;
        xaiConfiguredRef.current = isXai && Boolean(merged.xai?.apiKey);
        if (isXai) {
          autoStartRef.current = false;
          warmupAllowedRef.current = false;
          setEngineWarmAtLaunch(false);
          return;
        }
        const totalMemoryGB = typeof caps?.totalMemoryGB === 'number' ? caps.totalMemoryGB : 0;
        const warmupAllowed = typeof caps?.voiceWarmupSupported === 'boolean'
          ? caps.voiceWarmupSupported
          : isVoiceWarmupSupported(totalMemoryGB);
        warmupAllowedRef.current = warmupAllowed;
        const wantsAutoStart = merged.sidecar?.autoStart === true;
        const warmAtLaunch = warmupAllowed && wantsAutoStart;
        autoStartRef.current = warmAtLaunch;
        setEngineWarmAtLaunch(warmAtLaunch);
      })
      .catch(() => {
        autoStartRef.current = false;
        warmupAllowedRef.current = false;
        engineXaiRef.current = false;
        xaiConfiguredRef.current = false;
        setEngineWarmAtLaunch(false);
      })
      .finally(() => {
        // Don't tear down the engine on config-only updates (e.g. switching
        // model/provider/voice). If the engine is already ready or booting,
        // keep it running — only probe to see if it's still healthy.
        setPhase((current) => {
          if (current === 'ready' || current === 'booting') return current;
          // On initial load, force-start the engine regardless of autoStart.
          const force = initialLoadRef.current;
          initialLoadRef.current = false;
          void runWarmupRef.current(force);
          return current;
        });
      });
  }, [voiceEnabled, canRunWeb]);

  useEffect(() => {
    syncWarmupConfig();
  }, [syncWarmupConfig]);

  const ensureWarmup = useCallback(() => {
    setPhase((current) => (current === 'ready' ? current : 'booting'));
    setError(null);
    if (!bootingStartedAtRef.current) {
      bootingStartedAtRef.current = Date.now();
    }
    void runWarmup(true);
  }, [runWarmup]);

  const releaseSidecar = useCallback(() => {
    if (autoStartRef.current) return;

    releaseEpochRef.current += 1;
    warmupInFlightRef.current = null;
    bootingStartedAtRef.current = null;

    if (engineXaiRef.current) {
      // xAI has no local sidecar to release. Keep the engine marked ready as
      // long as the API key is configured so the duplex WebSocket session
      // doesn't drop between turns.
      if (xaiConfiguredRef.current) {
        applyReady();
      } else {
        applyFailed('xAI API key is missing');
      }
      return;
    }

    const epoch = releaseEpochRef.current;
    void voice.releaseSidecar()
      .then(() => {
        if (epoch !== releaseEpochRef.current) return;
        setPhase('idle');
        setHealth(undefined);
        setError(null);
      })
      .catch(() => {
        if (epoch !== releaseEpochRef.current) return;
        setPhase('idle');
        setHealth(undefined);
      });
  }, [applyReady, applyFailed]);

  useEffect(() => {
    const onVoiceUpdated = () => { syncWarmupConfig(); };
    window.addEventListener('agentx:voice-updated', onVoiceUpdated);
    return () => window.removeEventListener('agentx:voice-updated', onVoiceUpdated);
  }, [syncWarmupConfig]);

  useEffect(() => {
    if (phase !== 'booting') return;

    const poll = () => { void probeSidecarStatus(); };
    void poll();
    const interval = window.setInterval(poll, BOOTING_POLL_MS);
    return () => window.clearInterval(interval);
  }, [phase, probeSidecarStatus]);

  useEffect(() => {
    if (phase !== 'booting') return;

    const timeout = window.setTimeout(() => {
      if (bootingStartedAtRef.current && Date.now() - bootingStartedAtRef.current >= BOOTING_TIMEOUT_MS) {
        applyFailed('Voice engine timed out — check Settings → Voice');
      }
    }, BOOTING_TIMEOUT_MS + 500);

    return () => window.clearTimeout(timeout);
  }, [phase, applyFailed]);

  useEffect(() => {
    if (!voiceEnabled || !canRunWeb) return;
    if (phase !== 'ready' && phase !== 'idle') return;
    // xAI realtime has no local sidecar to poll — skip the status probe entirely
    // so we don't mistakenly reset a ready duplex session back to idle.
    if (engineXaiRef.current) return;

    const poll = async () => {
      try {
        const result = await voice.sidecarStatus();
        const sidecar = result.sidecar;
        const sidecarHealth = 'health' in sidecar ? sidecar.health : undefined;
        if (isSidecarFullyReady(sidecar.state, sidecarHealth)) {
          applyReady(sidecarHealth);
        } else if (phase === 'ready' && !isSidecarFullyReady(sidecar.state, sidecarHealth)) {
          setPhase('idle');
          setHealth(undefined);
          setError(null);
        }
      } catch { /* ignore transient probe errors */ }
    };

    const interval = window.setInterval(() => { void poll(); }, STATUS_POLL_MS);
    return () => window.clearInterval(interval);
  }, [phase, voiceEnabled, canRunWeb, applyReady]);

  return {
    phase,
    health,
    error,
    label: warmupLabel(phase, error),
    engineWarmAtLaunch,
    ensureWarmup,
    releaseSidecar,
    retry: ensureWarmup,
  };
}
