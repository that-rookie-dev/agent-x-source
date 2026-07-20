import type { useVoiceCommsSession } from '../../hooks/useVoiceCommsSession';
import type { ParticlePhase } from '../voice/VoiceParticleField';
import type { CrewCallPhase } from './types';

type Comms = ReturnType<typeof useVoiceCommsSession>;

/** Map crew-call + uplink state to the same particle phases as the call modal. */
export function resolveCallParticlePhase(
  phase: CrewCallPhase,
  comms: Comms,
  elapsedMs: number,
): { particlePhase: ParticlePhase; level: number; label: string } {
  if (phase === 'on_hold') {
    return { particlePhase: 'paused', level: 0, label: 'On hold' };
  }
  if (phase === 'failed' || phase === 'ending' || phase === 'idle') {
    return { particlePhase: 'disabled', level: 0, label: phase === 'failed' ? 'Offline' : 'Ending…' };
  }
  // Dialing / reconnecting — blue until the channel is live.
  if (phase === 'resolving' || phase === 'connecting' || phase === 'encoding') {
    return {
      particlePhase: 'connecting',
      level: 0.25,
      label: elapsedMs > 0 ? 'Reconnecting…' : 'Connecting…',
    };
  }

  // Linked but still bringing uplink up — keep connecting (blue).
  const uplinkLive =
    comms.commsReady
    && (comms.session.state === 'ready'
      || comms.session.state === 'listening'
      || comms.session.state === 'speaking'
      || comms.session.state === 'processing'
      || (!comms.isDuplex && comms.session.pttReady)
      || comms.agentActive || comms.operatorActive);
  if (!uplinkLive || comms.session.state === 'connecting' || comms.commsPhase === 'boot' || comms.commsPhase === 'link') {
    return { particlePhase: 'connecting', level: 0.2, label: 'Connecting…' };
  }

  // Greeting / agent audio — purple speaking.
  if (comms.agentActive || comms.commsPhase === 'agent_tx' || comms.session.state === 'speaking') {
    return {
      particlePhase: 'speaking',
      level: Math.max(0.2, comms.session.playbackLevel),
      label: 'Speaking…',
    };
  }

  // Thinking only after the operator has spoken this call — not on bare connect.
  const operatorHasSpoken = Boolean((comms.session.finalTranscript || '').trim())
    || Boolean((comms.session.partialTranscript || '').trim());
  if (
    operatorHasSpoken
    && (
      comms.session.state === 'processing'
      || comms.commsPhase === 'relay_process'
      || comms.commsPhase === 'operator_stt'
      || comms.commsPhase === 'agent_prep'
      || (comms.relayBusy && comms.session.state !== 'listening' && comms.session.state !== 'ready')
    )
  ) {
    return { particlePhase: 'thinking', level: 0.4, label: 'Thinking…' };
  }

  if (comms.operatorActive) {
    return {
      particlePhase: 'listening',
      level: Math.max(0.15, comms.session.audioLevel),
      label: 'Listening…',
    };
  }

  // Live channel waiting for speech — green listening state.
  return {
    particlePhase: 'listening',
    level: 0.12,
    label: comms.isDuplex ? 'Listening…' : 'Ready',
  };
}
