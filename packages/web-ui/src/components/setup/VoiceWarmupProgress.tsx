/**
 * Warmup-phase progress UI for the voice setup wizard.
 *
 * Shown after installation completes — displays a separate progress bar
 * for the voice engine warm-up, then auto-plays a TTS greeting.
 */
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { voice } from '../../api';
import { markVoiceOutputUnlocked } from '../../voice/support';
import { wizardTheme, WIZARD_MONO } from './wizard-theme';
import { colors, alphaColor } from '../../theme';

export type WarmupPhase = 'warming' | 'greeting' | 'playing' | 'done' | 'error';

export interface VoiceWarmupProgressProps {
  /** User callsign — used to generate a personalised greeting. */
  callsign: string;
  /** Agent persona name — used in the fallback greeting. */
  agentName?: string;
  /** Fired when the entire warmup+greeting flow finishes successfully. */
  onComplete: () => void;
  /** Fired when an unrecoverable error occurs. */
  onError: (message: string) => void;
}

const PHASE_LABELS: Record<WarmupPhase, string> = {
  warming: 'WARMING ENGINE',
  greeting: 'GENERATING GREETING',
  playing: 'TRANSMITTING',
  done: 'COMMS ONLINE',
  error: 'SIGNAL LOST',
};

const PHASE_PROGRESS: Record<WarmupPhase, number> = {
  warming: 30,
  greeting: 70,
  playing: 90,
  done: 100,
  error: 100,
};

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes('abort') || msg.includes('timeout') || msg.includes('timed out')
    || msg.includes('not ready') || msg.includes('econnrefused') || msg.includes('fetch');
}

export function VoiceWarmupProgress({ callsign, agentName, onComplete, onError }: VoiceWarmupProgressProps) {
  const [phase, setPhase] = useState<WarmupPhase>('warming');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Loading speech models…');
  const completedRef = useRef(false);

  // Animate the progress bar toward the phase target.
  useEffect(() => {
    const target = PHASE_PROGRESS[phase];
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= target) { clearInterval(timer); return target; }
        return Math.min(target, prev + 2);
      });
    }, 40);
    return () => clearInterval(timer);
  }, [phase]);

  // Drive the warmup → greeting → TTS pipeline.
  useEffect(() => {
    if (completedRef.current) return;
    let cancelled = false;

    const run = async () => {
      // Phase 1: Warm the sidecar.
      setPhase('warming');
      setMessage('Loading speech models so TTS responds instantly…');
      try {
        await voice.ensureSidecar();
      } catch {
        // Warmup failure is non-fatal — cold-start TTS can still work.
      }
      if (cancelled) return;

      // Phase 2: Generate a personalised greeting via the default LLM.
      setPhase('greeting');
      setMessage('Composing greeting via default LLM…');
      let greetingText: string;
      try {
        const result = await voice.generateGreeting(callsign);
        greetingText = result.text;
      } catch {
        const agent = agentName?.trim() || 'Agent-X';
        greetingText = `Hey ${callsign}, ${agent} here. Voice is live and I'm ready to go.`;
      }
      if (cancelled) return;

      // Phase 3: Synthesise and auto-play the greeting.
      setPhase('playing');
      setMessage('Transmitting greeting…');
      markVoiceOutputUnlocked();
      try {
        const result = await voice.preview(greetingText, 'kokoro', 'kokoro-af');
        if (cancelled) return;
        const audio = new Audio(`data:${result.mimeType};base64,${result.audioBase64}`);
        await audio.play();
        // Wait for playback to finish.
        await new Promise<void>((resolve) => {
          audio.addEventListener('ended', () => resolve(), { once: true });
          audio.addEventListener('error', () => resolve(), { once: true });
          // Safety timeout — don't block forever if 'ended' never fires.
          setTimeout(resolve, 15_000);
        });
      } catch (err) {
        if (!isTransientError(err)) {
          if (!cancelled) { setPhase('error'); onError(err instanceof Error ? err.message : 'TTS playback failed'); }
          return;
        }
        // Retry once after a brief pause for cold-start sidecars.
        try {
          await new Promise((r) => setTimeout(r, 800));
          const result = await voice.preview(greetingText, 'kokoro', 'kokoro-af');
          if (cancelled) return;
          const audio = new Audio(`data:${result.mimeType};base64,${result.audioBase64}`);
          await audio.play();
          await new Promise<void>((resolve) => {
            audio.addEventListener('ended', () => resolve(), { once: true });
            audio.addEventListener('error', () => resolve(), { once: true });
            setTimeout(resolve, 15_000);
          });
        } catch (retryErr) {
          if (!cancelled) { setPhase('error'); onError(retryErr instanceof Error ? retryErr.message : 'TTS playback failed'); }
          return;
        }
      }
      if (cancelled) return;

      // Phase 4: Done.
      setPhase('done');
      setMessage('Voice comms ready.');
      completedRef.current = true;
      // Brief pause so the user sees the 100% state.
      setTimeout(() => { if (!cancelled) onComplete(); }, 600);
    };

    void run();
    return () => { cancelled = true; };
  }, [callsign, agentName, onComplete, onError]);

  const isError = phase === 'error';

  return (
    <Box sx={{ mt: 2, pt: 2, borderTop: `1px solid ${wizardTheme.panelBorder}` }}>
      <Typography sx={{ fontSize: '0.58rem', fontFamily: WIZARD_MONO, color: wizardTheme.textSecondary, mb: 0.5 }}>
        {PHASE_LABELS[phase]} · {Math.round(progress)}%
      </Typography>
      <Typography sx={{ fontSize: '0.62rem', color: wizardTheme.textDim, mb: 1 }}>
        {message}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={progress}
        sx={{
          height: 3,
          borderRadius: 1,
          bgcolor: alphaColor(colors.ink, 0.06),
          '& .MuiLinearProgress-bar': {
            bgcolor: isError ? wizardTheme.accentErr : phase === 'done' ? wizardTheme.accentOk : wizardTheme.accentSignal,
          },
        }}
      />
    </Box>
  );
}
