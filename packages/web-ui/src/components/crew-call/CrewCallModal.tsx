import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import CallEndIcon from '@mui/icons-material/CallEnd';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import MicIcon from '@mui/icons-material/Mic';
import MinimizeIcon from '@mui/icons-material/Minimize';
import { alphaColor } from '../../theme';
import { friendlyVoiceError } from '../voice/voice-comms-theme';
import { getCrewAccent } from '../../styles/crew-theme';
import { VoiceParticleField } from '../voice/VoiceParticleField';
import type { useVoiceCommsSession } from '../../hooks/useVoiceCommsSession';
import { CallTranscriptDivider } from './CallTranscriptDivider';
import { callTheme, formatCallDuration } from './crew-call-theme';
import { resolveCallParticlePhase } from './resolve-call-particle-phase';
import type { CrewCallPhase, CrewCallTarget, CrewCallTranscriptLine } from './types';

type Comms = ReturnType<typeof useVoiceCommsSession>;

export interface CrewCallModalProps {
  open: boolean;
  phase: CrewCallPhase;
  target: CrewCallTarget | null;
  error: string | null;
  transcript: CrewCallTranscriptLine[];
  elapsedMs: number;
  comms: Comms;
  historyHasMore: boolean;
  historyLoading: boolean;
  onLoadEarlier: () => void;
  onEnd: () => void;
  onHold: () => void;
  onResume: () => void;
  onMinimize: () => void;
  onRetry?: () => void;
}

const PHASE_LABEL: Record<CrewCallPhase, string> = {
  idle: 'STANDBY',
  resolving: 'CONNECTING',
  connecting: 'CONNECTING',
  encoding: 'CONNECTING',
  linked: 'ON CALL',
  on_hold: 'ON HOLD',
  ending: 'ENDING',
  failed: 'FAILED',
};

const CTRL_BTN = {
  width: 40,
  height: 40,
  borderRadius: '8px',
  flexShrink: 0,
} as const;

export function CrewCallModal({
  open,
  phase,
  target,
  error,
  transcript,
  elapsedMs,
  comms,
  historyHasMore,
  historyLoading,
  onLoadEarlier,
  onEnd,
  onHold,
  onResume,
  onMinimize,
  onRetry,
}: CrewCallModalProps) {
  const [mousePttHeld, setMousePttHeld] = useState(false);
  const transcriptBoxRef = useRef<HTMLDivElement>(null);
  const focusSinkRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const accent = getCrewAccent(target?.accent, target?.callsign);
  const isPtt = !comms.isDuplex;
  const linked = phase === 'linked';
  const isOnHold = phase === 'on_hold';
  // Keyboard + mouse PTT both surface through session.holding.
  const pttHeld = mousePttHeld || Boolean(comms.session.holding);
  const { particlePhase, level, label: particleLabel } = useMemo(
    () => resolveCallParticlePhase(phase, comms, elapsedMs),
    [phase, comms, elapsedMs],
  );

  const statusLine = useMemo(() => {
    if (phase === 'failed') return error || 'Call unavailable';
    if (phase === 'on_hold') return 'On hold';
    if (phase === 'resolving' || phase === 'connecting' || phase === 'encoding') {
      return elapsedMs > 0 ? 'Reconnecting…' : 'Connecting…';
    }
    if (phase === 'ending') return 'Ending call…';
    if (comms.session.error) return friendlyVoiceError(comms.session.error);
    if (comms.session.warning) return comms.session.warning;
    if (isPtt && linked && !pttHeld && particlePhase === 'listening') return 'Hold to talk';
    return particleLabel;
  }, [
    phase,
    error,
    elapsedMs,
    comms.session.error,
    comms.session.warning,
    isPtt,
    linked,
    pttHeld,
    particlePhase,
    particleLabel,
  ]);

  const ignoreSpaceActivation = useCallback((e: ReactKeyboardEvent) => {
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
    }
  }, []);

  const scrollTranscriptToEnd = useCallback((smooth: boolean) => {
    const el = transcriptBoxRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useEffect(() => {
    const el = transcriptBoxRef.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = gap < 48;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [open]);

  // Keep pinned to latest message / live partials
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollTranscriptToEnd(true);
  }, [
    transcript.length,
    transcript[transcript.length - 1]?.text,
    comms.session.partialTranscript,
    comms.session.agentText,
    scrollTranscriptToEnd,
  ]);

  useEffect(() => {
    if (!open) return;
    stickToBottomRef.current = true;
    requestAnimationFrame(() => scrollTranscriptToEnd(false));
  }, [open, scrollTranscriptToEnd]);

  const releasePtt = useCallback(() => {
    if (!mousePttHeld) return;
    setMousePttHeld(false);
    void comms.endVoice();
  }, [mousePttHeld, comms]);

  const pressPtt = useCallback(() => {
    if (!linked || !isPtt || comms.pushToTalkBlocked) return;
    setMousePttHeld(true);
    void comms.beginVoice();
  }, [linked, isPtt, comms]);

  useEffect(() => {
    if (!mousePttHeld) return;
    const up = () => releasePtt();
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchend', up);
    };
  }, [mousePttHeld, releasePtt]);

  // Park focus on a stable sink so Dialog / transcript updates don't steal
  // focus mid-Space-hold (which would synthesize a keyup and drop PTT).
  useEffect(() => {
    if (!open) return;
    const focusSink = () => {
      focusSinkRef.current?.focus({ preventScroll: true });
    };
    focusSink();
    const id = window.setTimeout(focusSink, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const callsign = target?.callsign ?? '—';
  const name = target?.displayName ?? 'Unknown';

  return (
    <Dialog
      open={open}
      onClose={(_, reason) => {
        // Escape / dismiss collapses into the footer instead of hanging up.
        if (reason === 'backdropClick') return;
        onMinimize();
      }}
      maxWidth={false}
      disableAutoFocus
      disableEnforceFocus
      disableRestoreFocus
      PaperProps={{
        sx: {
          width: 'min(720px, 94vw)',
          height: 'min(560px, 86vh)',
          maxHeight: '86vh',
          m: 1.5,
          display: 'flex',
          flexDirection: 'column',
          bgcolor: callTheme.bg.void,
          backgroundImage: `
            radial-gradient(ellipse 60% 40% at 12% 0%, ${alphaColor(accent, 0.1)} 0%, transparent 55%),
            linear-gradient(180deg, ${callTheme.bg.panel} 0%, ${callTheme.bg.void} 100%)
          `,
          border: `1px solid ${callTheme.border.line}`,
          borderRadius: '10px',
          boxShadow: `0 20px 64px ${alphaColor('#000', 0.6)}`,
          overflow: 'hidden',
        },
      }}
      slotProps={{
        backdrop: {
          sx: { bgcolor: alphaColor('#020406', 0.78), backdropFilter: 'blur(6px)' },
        },
      }}
    >
      <Box
        ref={focusSinkRef}
        tabIndex={-1}
        aria-hidden
        sx={{
          position: 'absolute',
          width: 1,
          height: 1,
          opacity: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      />
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.75,
          py: 1,
          borderBottom: `1px solid ${callTheme.border.faint}`,
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '7px',
            border: `1px solid ${alphaColor(accent, 0.45)}`,
            bgcolor: alphaColor(accent, 0.1),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: accent,
            fontFamily: callTheme.mono,
            fontSize: '0.62rem',
            fontWeight: 700,
          }}
        >
          {callsign.slice(0, 2).toUpperCase()}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontFamily: callTheme.mono, fontSize: '0.85rem', fontWeight: 700, color: callTheme.text.primary, lineHeight: 1.15 }}>
            {name}
          </Typography>
          <Typography sx={{ fontFamily: callTheme.mono, fontSize: '0.55rem', color: accent }}>
            @{callsign}{target?.title ? ` · ${target.title}` : ''}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right', mr: 0.25 }}>
          <Typography
            sx={{
              fontFamily: callTheme.mono,
              fontSize: '1.1rem',
              fontWeight: 600,
              color: linked ? accent : isOnHold ? callTheme.warn : callTheme.text.dim,
              letterSpacing: '0.06em',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.1,
            }}
          >
            {formatCallDuration(elapsedMs)}
          </Typography>
          <Typography
            sx={{
              fontFamily: callTheme.mono,
              fontSize: '0.48rem',
              letterSpacing: '0.12em',
              color: phase === 'failed' ? callTheme.alert : linked ? accent : isOnHold ? callTheme.warn : callTheme.uplink,
            }}
          >
            {PHASE_LABEL[phase]}
          </Typography>
        </Box>
        <Tooltip title="Minimize — keep call in footer" arrow>
          <IconButton
            onClick={onMinimize}
            onKeyDown={ignoreSpaceActivation}
            size="small"
            aria-label="Minimize call"
            sx={{
              width: 32,
              height: 32,
              borderRadius: '7px',
              border: `1px solid ${callTheme.border.line}`,
              color: callTheme.text.secondary,
              '&:hover': {
                bgcolor: alphaColor(callTheme.uplink, 0.12),
                color: callTheme.uplink,
              },
            }}
          >
            <MinimizeIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Body */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          overflow: 'hidden',
        }}
      >
        {/* Particles */}
        <Box
          sx={{
            position: 'relative',
            minHeight: 0,
            borderRight: { md: `1px solid ${callTheme.border.faint}` },
            bgcolor: callTheme.bg.inset,
            overflow: 'hidden',
          }}
        >
          <VoiceParticleField
            phase={particlePhase}
            active={phase !== 'idle' && phase !== 'failed' && phase !== 'ending'}
            level={level}
          />
          <Box
            sx={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              pointerEvents: 'none',
            }}
          >
            <Typography
              sx={{
                fontFamily: callTheme.mono,
                fontSize: '0.58rem',
                letterSpacing: '0.1em',
                color: callTheme.text.primary,
                px: 0.75,
                py: 0.35,
                borderRadius: '4px',
                bgcolor: alphaColor(callTheme.bg.void, 0.55),
                border: `1px solid ${callTheme.border.line}`,
              }}
            >
              {statusLine}
            </Typography>
          </Box>
        </Box>

        {/* Transcript */}
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <Box
            sx={{
              px: 1.25,
              py: 0.65,
              borderBottom: `1px solid ${callTheme.border.faint}`,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              flexShrink: 0,
            }}
          >
            <Typography sx={{ fontFamily: callTheme.mono, fontSize: '0.5rem', letterSpacing: '0.14em', color: callTheme.text.dim }}>
              TRANSCRIPT
            </Typography>
            <Box sx={{ flex: 1 }} />
            {historyHasMore && (
              <Button
                size="small"
                onClick={() => {
                  stickToBottomRef.current = false;
                  onLoadEarlier();
                }}
                onKeyDown={ignoreSpaceActivation}
                disabled={historyLoading}
                sx={{
                  fontFamily: callTheme.mono,
                  fontSize: '0.48rem',
                  letterSpacing: '0.08em',
                  color: callTheme.uplink,
                  minWidth: 0,
                  py: 0.15,
                  px: 0.6,
                }}
              >
                {historyLoading ? <CircularProgress size={9} sx={{ mr: 0.4 }} /> : null}
                EARLIER
              </Button>
            )}
          </Box>
          <Box
            ref={transcriptBoxRef}
            tabIndex={-1}
            onKeyDown={ignoreSpaceActivation}
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              px: 1.25,
              py: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
              bgcolor: alphaColor(callTheme.bg.inset, 0.45),
              scrollBehavior: 'smooth',
              outline: 'none',
            }}
          >
            {transcript.length === 0 && (
              <Typography sx={{ fontFamily: callTheme.mono, fontSize: '0.6rem', color: callTheme.text.dim, py: 1.5 }}>
                {historyLoading ? 'Loading…' : 'Waiting for the call…'}
              </Typography>
            )}
            {transcript.map((line) => {
              if (line.divider) {
                return (
                  <CallTranscriptDivider
                    key={line.id}
                    label={line.text}
                    variant={line.divider}
                  />
                );
              }
              const color =
                line.role === 'operator' ? callTheme.operator
                  : line.role === 'crew' ? accent
                    : callTheme.text.dim;
              const label = line.role === 'operator' ? 'You' : line.role === 'crew' ? name : 'System';
              return (
                <Box key={line.id}>
                  <Typography sx={{ fontFamily: callTheme.mono, fontSize: '0.48rem', letterSpacing: '0.06em', color, mb: 0.15 }}>
                    {label}
                  </Typography>
                  <Typography sx={{ fontFamily: callTheme.mono, fontSize: '0.65rem', color: callTheme.text.secondary, lineHeight: 1.4 }}>
                    {line.text}
                  </Typography>
                </Box>
              );
            })}
            {linked && (comms.session.partialTranscript || '').trim() && (
              <Box sx={{ opacity: 0.7 }}>
                <Typography sx={{ fontFamily: callTheme.mono, fontSize: '0.48rem', letterSpacing: '0.06em', color: callTheme.operator, mb: 0.15 }}>
                  You · live
                </Typography>
                <Typography sx={{ fontFamily: callTheme.mono, fontSize: '0.65rem', color: callTheme.text.dim }}>
                  {comms.session.partialTranscript}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {/* Controls — equal compact buttons */}
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderTop: `1px solid ${callTheme.border.faint}`,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          flexShrink: 0,
        }}
      >
        {isOnHold ? (
          <Button
            variant="contained"
            startIcon={<PlayArrowIcon sx={{ fontSize: 16 }} />}
            onClick={onResume}
            onKeyDown={ignoreSpaceActivation}
            sx={{
              flex: 1,
              height: 40,
              fontFamily: callTheme.mono,
              fontSize: '0.62rem',
              letterSpacing: '0.08em',
              fontWeight: 700,
              bgcolor: alphaColor(accent, 0.2),
              color: accent,
              border: `1px solid ${alphaColor(accent, 0.5)}`,
              '&:hover': { bgcolor: alphaColor(accent, 0.3) },
            }}
          >
            RESUME
          </Button>
        ) : isPtt && linked ? (
          <Button
            variant="contained"
            startIcon={<MicIcon sx={{ fontSize: 16 }} />}
            onMouseDown={(e) => { e.preventDefault(); pressPtt(); }}
            onTouchStart={(e) => { e.preventDefault(); pressPtt(); }}
            onKeyDown={ignoreSpaceActivation}
            disabled={comms.pushToTalkBlocked && !pttHeld}
            sx={{
              flex: 1,
              height: 40,
              fontFamily: callTheme.mono,
              fontSize: '0.62rem',
              letterSpacing: '0.08em',
              fontWeight: 700,
              bgcolor: pttHeld ? accent : alphaColor(accent, 0.18),
              color: pttHeld ? callTheme.bg.void : accent,
              border: `1px solid ${alphaColor(accent, 0.5)}`,
              '&:hover': { bgcolor: pttHeld ? accent : alphaColor(accent, 0.26) },
            }}
          >
            {pttHeld ? 'SPEAKING…' : 'HOLD TO TALK'}
          </Button>
        ) : (
          <Box
            sx={{
              flex: 1,
              height: 40,
              px: 1.25,
              borderRadius: '8px',
              border: `1px solid ${linked ? alphaColor(accent, 0.35) : callTheme.border.faint}`,
              bgcolor: alphaColor(accent, linked ? 0.08 : 0.03),
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
            }}
          >
            <MicIcon sx={{ fontSize: 16, color: linked ? accent : callTheme.text.dim }} />
            <Typography sx={{ fontFamily: callTheme.mono, fontSize: '0.6rem', color: callTheme.text.secondary }}>
              {linked ? 'Speak anytime' : phase === 'failed' ? 'Call offline' : 'Connecting…'}
            </Typography>
          </Box>
        )}

        {linked && (
          <Tooltip title="Hold" arrow>
            <IconButton
              onClick={onHold}
              onKeyDown={ignoreSpaceActivation}
              sx={{
                ...CTRL_BTN,
                bgcolor: alphaColor(callTheme.warn, 0.12),
                border: `1px solid ${alphaColor(callTheme.warn, 0.4)}`,
                color: callTheme.warn,
                '&:hover': { bgcolor: alphaColor(callTheme.warn, 0.22) },
              }}
            >
              <PauseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}

        {phase === 'failed' && onRetry && (
          <Button
            variant="outlined"
            onClick={onRetry}
            onKeyDown={ignoreSpaceActivation}
            sx={{
              height: 40,
              minWidth: 72,
              fontFamily: callTheme.mono,
              fontSize: '0.58rem',
              letterSpacing: '0.08em',
              borderColor: callTheme.border.line,
              color: callTheme.uplink,
            }}
          >
            RETRY
          </Button>
        )}

        <Tooltip title="End call" arrow>
          <IconButton
            onClick={onEnd}
            onKeyDown={ignoreSpaceActivation}
            sx={{
              ...CTRL_BTN,
              bgcolor: alphaColor(callTheme.alert, 0.16),
              border: `1px solid ${alphaColor(callTheme.alert, 0.5)}`,
              color: callTheme.alert,
              '&:hover': { bgcolor: alphaColor(callTheme.alert, 0.28) },
            }}
          >
            <CallEndIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Dialog>
  );
}
