import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import MicIcon from '@mui/icons-material/Mic';
import { voice, type VoiceSetupStatus } from '../../api';
import { useMicrophonePermission } from '../../hooks/useMicrophonePermission';
import { applyVoicePreset, mergeVoiceConfig } from '../../voice/voice-config';
import { markVoiceOutputUnlocked } from '../../voice/support';
import { hasSeenMicPreprompt, markMicPrepromptSeen } from '../../utils/microphone-permission';
import { VoicePermissionDialog } from '../VoicePermissionDialog';
import { WizardStatusLine, WizardStepShell } from './wizard-step-shell';
import { wizardPrimaryBtnSx, wizardTheme, WIZARD_MONO } from './wizard-theme';
import { colors, alphaColor } from '../../theme';

export interface WizardVoiceStepProps {
  onReadyChange?: (ready: boolean) => void;
  /** True while deploy/warmup is in progress — parent should disable Skip/Back. */
  onBusyChange?: (busy: boolean) => void;
}

function micStatusLabel(state: string): string {
  if (state === 'granted') return 'GRANTED';
  if (state === 'denied') return 'BLOCKED';
  if (state === 'prompt') return 'STANDBY';
  return 'UNKNOWN';
}

export function WizardVoiceStep({ onReadyChange, onBusyChange }: WizardVoiceStepProps) {
  const mic = useMicrophonePermission();
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState<VoiceSetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [testingMic, setTestingMic] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [prepromptOpen, setPrepromptOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    void voice.setupStatus().then(({ status }) => {
      if (status.phase === 'complete') setComplete(true);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    onReadyChange?.(complete);
  }, [complete, onReadyChange]);

  useEffect(() => {
    onBusyChange?.(deploying);
  }, [deploying, onBusyChange]);

  const persistVoiceEnabled = async () => {
    const cfg = await voice.getConfig();
    await voice.updateConfig(applyVoicePreset(mergeVoiceConfig(cfg)));
  };

  /** Enable voice, warm the sidecar, then mark the step complete. */
  const finishDeployWithWarmup = async () => {
    setDeployStatus({
      phase: 'runtime',
      message: 'Warming voice engine…',
      detail: 'Loading speech models so Test speaker responds immediately',
      progress: 96,
    });
    try {
      await persistVoiceEnabled();
      await voice.ensureSidecar();
    } catch {
      // Kit is installed; speaker test can still cold-start if warmup fails.
    }
    setDeployStatus({
      phase: 'complete',
      message: 'Voice comms ready',
      progress: 100,
    });
    setDeploying(false);
    setComplete(true);
  };

  const pollSetup = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { status } = await voice.setupStatus();
        setDeployStatus(status);
        if (status.phase === 'complete') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          await finishDeployWithWarmup();
        } else if (status.phase === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setDeploying(false);
          setError(status.error ?? status.message);
        }
      } catch (err) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setDeploying(false);
        setError(err instanceof Error ? err.message : 'Voice calibration failed');
      }
    }, 500);
  };

  const deploy = async () => {
    setDeploying(true);
    setError(null);
    setComplete(false);
    setDeployStatus({
      phase: 'runtime',
      message: 'Initializing comms array…',
      detail: 'Python runtime · ffmpeg · speech models',
      progress: 0,
    });
    try {
      const { status } = await voice.setup();
      setDeployStatus(status);
      if (status.phase === 'complete') {
        await finishDeployWithWarmup();
        return;
      }
      pollSetup();
    } catch (err) {
      setDeploying(false);
      setError(err instanceof Error ? err.message : 'Failed to start voice calibration');
    }
  };

  const stopMicTest = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setTestingMic(false);
    setMicLevel(0);
  }, []);

  const runMicTest = useCallback(async () => {
    setError(null);
    if (mic.state !== 'granted') {
      if (!hasSeenMicPreprompt()) {
        setPrepromptOpen(true);
        return;
      }
      const ok = await mic.requestAccess();
      if (!ok) return;
    }
    stopMicTest();
    try {
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
        setMicLevel(Math.min(1, sum / data.length / 64));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      setTestingMic(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone test failed');
      stopMicTest();
    }
  }, [mic, stopMicTest]);

  const synthAndPlay = async () => {
    const result = await voice.preview(
      'Voice comms online. Agent-X standing by.',
      'kokoro',
      'kokoro-af',
    );
    const audio = new Audio(`data:${result.mimeType};base64,${result.audioBase64}`);
    await audio.play();
  };

  const isTransientTtsError = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    return msg.includes('abort') || msg.includes('timeout') || msg.includes('timed out')
      || msg.includes('not ready') || msg.includes('econnrefused') || msg.includes('fetch');
  };

  const previewSpeaker = async () => {
    setPreviewing(true);
    setError(null);
    markVoiceOutputUnlocked();
    try {
      // The TTS sidecar may still be cold-starting on the first request, which
      // surfaces as an abort/timeout. Retry once transparently before failing.
      try {
        await synthAndPlay();
      } catch (err) {
        if (!isTransientTtsError(err)) throw err;
        await new Promise((r) => setTimeout(r, 600));
        await synthAndPlay();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speaker test failed');
    } finally {
      setPreviewing(false);
    }
  };

  const handlePrepromptContinue = async () => {
    markMicPrepromptSeen();
    setPrepromptOpen(false);
    const ok = await mic.requestAccess();
    if (ok) await runMicTest();
  };

  const phaseLabel = (() => {
    switch (deployStatus?.phase) {
      case 'runtime': return 'ENGINE SYNC';
      case 'download': return 'ASSET ACQUISITION';
      case 'complete': return 'COMMS ONLINE';
      case 'error': return 'SIGNAL LOST';
      default: return 'STANDBY';
    }
  })();

  return (
    <WizardStepShell
      codename="MODULE · VOICE COMMS"
      title="Calibrate Speech Array"
      subtitle="Deploy local STT/TTS on this machine. All audio stays on-device — nothing leaves the cloud."
      icon={<MicIcon sx={{ fontSize: 26 }} />}
    >
      <Box sx={{ position: 'relative', zIndex: 1 }}>
        <WizardStatusLine label="STT ENGINE" value="faster-whisper base.en" />
        <WizardStatusLine label="TTS ENGINE" value="Kokoro 82M (lightweight)" />
        <WizardStatusLine label="EST. PAYLOAD" value="~480 MB download" />
        <WizardStatusLine label="SECURITY" value="LOCAL ONLY · ENCRYPTED AT REST" ok />

        {deployStatus && deploying && (
          <Box sx={{ mt: 2, pt: 2, borderTop: `1px solid ${wizardTheme.panelBorder}` }}>
            <Typography sx={{ fontSize: '0.58rem', fontFamily: WIZARD_MONO, color: wizardTheme.textSecondary, mb: 0.5 }}>
              {phaseLabel} · {Math.round(deployStatus.progress ?? 0)}%
            </Typography>
            <Typography sx={{ fontSize: '0.62rem', color: wizardTheme.textDim, mb: 1 }}>
              {deployStatus.detail ?? deployStatus.message}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={deployStatus.progress ?? 0}
              sx={{
                height: 3,
                borderRadius: 1,
                bgcolor: alphaColor(colors.ink, 0.06),
                '& .MuiLinearProgress-bar': { bgcolor: wizardTheme.text },
              }}
            />
          </Box>
        )}

        {complete && !deploying && (
          <Box sx={{ mt: 2, p: 1.25, borderRadius: 1, border: `1px solid ${wizardTheme.panelBorder}`, bgcolor: alphaColor(colors.ink, 0.02) }}>
            <Typography sx={{ fontSize: '0.62rem', fontFamily: WIZARD_MONO, color: wizardTheme.accentOk }}>
              COMMS ARRAY ONLINE
            </Typography>
          </Box>
        )}

        {!complete && (
          <Button
            fullWidth
            variant="contained"
            onClick={() => { void deploy(); }}
            disabled={deploying}
            sx={{ ...wizardPrimaryBtnSx, mt: 2.5, py: 1.1 }}
          >
            {deploying ? 'CALIBRATING…' : 'INITIATE COMMS DEPLOY'}
          </Button>
        )}

        {complete && (
          <Box sx={{ mt: 2.5, pt: 2, borderTop: `1px solid ${wizardTheme.panelBorder}` }}>
            <Typography sx={{ fontSize: '0.58rem', fontFamily: WIZARD_MONO, color: wizardTheme.textDim, letterSpacing: '1px', mb: 1.5 }}>
              COMMS CHECK
            </Typography>
            <WizardStatusLine label="MIC ACCESS" value={micStatusLabel(mic.state)} ok={mic.state === 'granted' ? true : mic.state === 'denied' ? false : undefined} />

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5, mb: 1 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => { void runMicTest(); }}
                disabled={testingMic || (mic.blocked && mic.state === 'denied')}
                sx={{
                  fontFamily: WIZARD_MONO,
                  fontSize: '0.62rem',
                  color: wizardTheme.textSecondary,
                  borderColor: wizardTheme.panelBorder,
                  '&:hover': { borderColor: wizardTheme.panelBorderStrong, bgcolor: alphaColor(colors.ink, 0.03) },
                  '&.Mui-disabled': {
                    color: testingMic ? wizardTheme.accentSignal : undefined,
                    borderColor: testingMic ? wizardTheme.panelBorder : undefined,
                    opacity: testingMic ? 1 : undefined,
                  },
                }}
              >
                {testingMic ? 'Listening…' : mic.state === 'granted' ? 'Test microphone' : 'Grant & test mic'}
              </Button>
              {testingMic && (
                <Button size="small" onClick={stopMicTest} sx={{ fontFamily: WIZARD_MONO, fontSize: '0.62rem', color: wizardTheme.textDim }}>
                  Stop
                </Button>
              )}
              <Button
                size="small"
                variant="outlined"
                onClick={() => { void previewSpeaker(); }}
                disabled={previewing}
                sx={{
                  fontFamily: WIZARD_MONO,
                  fontSize: '0.62rem',
                  color: wizardTheme.textSecondary,
                  borderColor: wizardTheme.panelBorder,
                  '&:hover': { borderColor: wizardTheme.panelBorderStrong, bgcolor: alphaColor(colors.ink, 0.03) },
                }}
              >
                {previewing ? 'Transmitting…' : 'Test speaker'}
              </Button>
            </Box>

            {testingMic && (
              <>
                <LinearProgress
                  variant="determinate"
                  value={micLevel * 100}
                  sx={{
                    mb: 1,
                    height: 3,
                    borderRadius: 1,
                    bgcolor: alphaColor(colors.ink, 0.06),
                    '& .MuiLinearProgress-bar': { bgcolor: wizardTheme.accentSignal },
                  }}
                />
                <Typography sx={{ fontSize: '0.58rem', fontFamily: WIZARD_MONO, color: wizardTheme.textDim }}>
                  Speak — the bar should move with your voice.
                </Typography>
              </>
            )}
          </Box>
        )}

        {error && (
          <Typography sx={{ mt: 2, fontSize: '0.65rem', fontFamily: WIZARD_MONO, color: wizardTheme.accentErr }}>
            {error}
          </Typography>
        )}

        <Typography sx={{ mt: 1.5, fontSize: '0.55rem', color: wizardTheme.textDim, textAlign: 'center', fontFamily: WIZARD_MONO }}>
          Skip to configure later in Settings → Voice
        </Typography>
      </Box>

      <VoicePermissionDialog
        open={prepromptOpen}
        helpText={mic.helpText}
        setupInstructions={mic.setupInstructions}
        preprompt
        onRequest={() => { void handlePrepromptContinue(); }}
        onClose={() => setPrepromptOpen(false)}
        onOpenSettings={() => { void mic.openSettings(); }}
      />
    </WizardStepShell>
  );
}
